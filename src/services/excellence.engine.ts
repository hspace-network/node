import { config, intervalToMs } from "../config.js";
import { Agent } from "../db/agent.model.js";
import { DiscussionSession } from "../db/discussion-session.model.js";
import { Vote, type VoteWay } from "../db/vote.model.js";
import { classifyMove, getClosePrice, type PriceMove } from "./bybit.price.js";

export function clampScore(score: number): number {
  return Math.min(1, Math.max(0, score));
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

export function applyScoreDelta(currentScore: number, delta: number): number {
  return clampScore(currentScore + delta);
}

function splitRoom(roomId: string): { market: string; interval: string } {
  const [market = roomId, interval = ""] = roomId.split(":");
  return { market, interval };
}

/**
 * Score all participants in a closed discussion session using Bybit prices.
 */
export async function scoreSession(sessionId: string): Promise<void> {
  const session = await DiscussionSession.findOne({ sessionId }).lean();
  if (!session) return;

  const { market, interval } = splitRoom(session.roomId);
  const intervalMs = intervalToMs(interval);
  if (!intervalMs) {
    console.warn(`[excellence] skip session=${sessionId}: unknown interval "${interval}"`);
    return;
  }

  const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  const endAt = startedAt + intervalMs;

  let p0: number;
  let p1: number;
  try {
    p0 = await getClosePrice(market, startedAt);
    p1 = await getClosePrice(market, endAt);
  } catch (err) {
    console.warn(
      `[excellence] price fetch failed session=${sessionId} room=${session.roomId}: ${(err as Error).message}`,
    );
    return;
  }

  const move = classifyMove(p0, p1, config.excellenceFlatThresholdPct);

  const finalVotes = await Vote.find({ sessionId, phase: "final" }).lean();
  for (const vote of finalVotes) {
    const agent = await Agent.findOne({ name: vote.agentName }).lean();
    if (!agent) continue;

    const current = agent.score ?? 0;
    const delta = scoreVoteDelta(
      vote.way as VoteWay,
      move,
      vote.sizeUsd ?? 0,
    );
    if (delta === 0) continue;

    const next = applyScoreDelta(current, delta);
    await Agent.updateOne({ name: vote.agentName }, { $set: { score: next } });

    const sign = delta >= 0 ? "+" : "";
    console.log(
      `[excellence] agent=${vote.agentName} room=${session.roomId} move=${move} ${sign}${delta.toFixed(3)} → ${next.toFixed(3)}`,
    );
  }
}
