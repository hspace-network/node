import { config, intervalToMs } from "../config.js";
import { Agent } from "../db/agent.model.js";
import { DiscussionSession } from "../db/discussion-session.model.js";
import { Vote, type VoteWay } from "../db/vote.model.js";
import { classifyMove, getClosePrice, type PriceMove } from "./bybit.price.js";

/** Excellence scores are normalized to a [0, 100] scale. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

export function clampScore(score: number): number {
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, score));
}

export function convictionMultiplier(sizeUsd: number, referenceUsd: number): number {
  const ref = referenceUsd > 0 ? referenceUsd : 50;
  const t = Math.min(Math.max(sizeUsd, 0) / ref, 1);
  return 0.5 + 0.5 * t;
}

/**
 * Pure scoring rule for a single final vote. Returns the score delta (not clamped).
 */
export function scoreVoteDelta(
  way: VoteWay,
  move: PriceMove,
  sizeUsd: number,
  scoreDelta = config.excellenceScoreDelta,
  referenceUsd = config.excellenceReferenceUsd,
): number {
  if (way === "NOTR" || move === "flat") return 0;

  const mult = convictionMultiplier(sizeUsd, referenceUsd);
  const delta = scoreDelta * mult;

  if (way === "LONG") {
    if (move === "up") return delta;
    if (move === "down") return -delta;
  }
  if (way === "SHORT") {
    if (move === "down") return delta;
    if (move === "up") return -delta;
  }
  return 0;
}

export function deltaSkipReason(
  way: VoteWay,
  move: PriceMove,
): string | null {
  if (way === "NOTR") return "NOTR";
  if (move === "flat") return "flat market";
  return null;
}

export function applyScoreDelta(currentScore: number, delta: number): number {
  return clampScore(currentScore + delta);
}

function splitRoom(roomId: string): { market: string; interval: string } {
  const [market = roomId, interval = ""] = roomId.split(":");
  return { market, interval };
}

function formatPct(p0: number, p1: number): string {
  if (!Number.isFinite(p0) || p0 <= 0) return "?";
  const pct = ((p1 - p0) / p0) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(3)}%`;
}

async function waitUntilEndAt(endAt: number, intervalMs: number): Promise<void> {
  const maxWait = intervalMs * 2;
  const deadline = Date.now() + maxWait;

  while (Date.now() < endAt) {
    const remainingMs = endAt - Date.now();
    if (remainingMs <= 0) break;
    const waitSec = Math.ceil(remainingMs / 1000);
    console.log(
      `[excellence] waiting ${waitSec}s for interval window to complete before pricing`,
    );
    const sleepMs = Math.min(remainingMs, 5000);
    await new Promise((r) => setTimeout(r, sleepMs));
    if (Date.now() > deadline) {
      console.warn(`[excellence] wait timeout after ${maxWait}ms — pricing anyway`);
      break;
    }
  }
}

/**
 * Score all participants in a closed discussion session using Bybit prices.
 */
export async function scoreSession(sessionId: string): Promise<void> {
  const session = await DiscussionSession.findOne({ sessionId }).lean();
  if (!session) {
    console.warn(`[excellence] skip session=${sessionId} reason=session_not_found`);
    return;
  }

  const { market, interval } = splitRoom(session.roomId);
  const intervalMs = intervalToMs(interval);
  if (!intervalMs) {
    console.warn(
      `[excellence] skip session=${sessionId} reason=unknown_interval interval="${interval}"`,
    );
    return;
  }

  const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  const endAt = startedAt + intervalMs;

  console.log(
    `[excellence] scoring session=${sessionId} room=${session.roomId} market=${market} interval=${interval}`,
  );
  console.log(
    `[excellence] window t0=${new Date(startedAt).toISOString()} t1=${new Date(endAt).toISOString()} (${Math.round(intervalMs / 1000)}s)`,
  );

  let p0: number;
  let p1: number;
  try {
    p0 = await getClosePrice(market, startedAt, interval);
    await waitUntilEndAt(endAt, intervalMs);
    p1 = await getClosePrice(market, endAt, interval);
  } catch (err) {
    console.warn(
      `[excellence] skip session=${sessionId} reason=price_fetch_failed error=${(err as Error).message}`,
    );
    return;
  }

  const move = classifyMove(p0, p1, config.excellenceFlatThresholdPct);
  console.log(
    `[excellence] prices p0=${p0} p1=${p1} move=${move} (${formatPct(p0, p1)})`,
  );

  await DiscussionSession.updateOne(
    { sessionId },
    { $set: { priceP0: p0, priceP1: p1, priceMove: move } },
  );

  const finalVotes = await Vote.find({ sessionId, phase: "final" }).lean();
  if (finalVotes.length === 0) {
    console.log(`[excellence] no final votes for session=${sessionId}`);
    return;
  }

  for (const vote of finalVotes) {
    if (vote.responded === false) {
      console.log(
        `[excellence] skip agent=${vote.agentName} reason=abstained_offline_or_timeout`,
      );
      continue;
    }

    const agent = await Agent.findOne({ name: vote.agentName }).lean();
    if (!agent) {
      console.log(
        `[excellence] skip agent=${vote.agentName} reason=not_registered_on_node`,
      );
      continue;
    }

    const current = agent.score ?? 0;
    const way = vote.way as VoteWay;
    const sizeUsd = vote.sizeUsd ?? 0;
    const delta = scoreVoteDelta(way, move, sizeUsd);
    const skip = deltaSkipReason(way, move);

    if (delta === 0) {
      console.log(
        `[excellence] agent=${vote.agentName} vote=${way} sizeUsd=${sizeUsd} delta=0${skip ? ` (${skip})` : ""} score=${current.toFixed(3)}`,
      );
      continue;
    }

    const next = applyScoreDelta(current, delta);
    await Agent.updateOne({ name: vote.agentName }, { $set: { score: next } });

    const sign = delta >= 0 ? "+" : "";
    console.log(
      `[excellence] agent=${vote.agentName} vote=${way} sizeUsd=${sizeUsd} delta=${sign}${delta.toFixed(3)} ${current.toFixed(3)}→${next.toFixed(3)}`,
    );
  }
}
