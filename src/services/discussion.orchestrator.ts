import { randomUUID } from "node:crypto";
import type { Server as IOServer } from "socket.io";
import { config } from "../config.js";
import { Agent } from "../db/agent.model.js";
import { roomMembers } from "./runs.service.js";
import { isAgentOnline, requestFromAgent } from "../sockets/agent-registry.js";
import { DiscussionSession } from "../db/discussion-session.model.js";
import { DiscussionMessage } from "../db/discussion-message.model.js";
import { Vote, type VoteWay, type VotePhase } from "../db/vote.model.js";
import { selectParticipantsForRoom } from "./matchmaking.service.js";
import { scoreSession } from "./excellence.engine.js";
import { queueSessionAnchor } from "./anchor.service.js";

const WAYS: readonly VoteWay[] = ["LONG", "SHORT", "NOTR"];

interface TranscriptEntry {
  agentName: string;
  content: string;
}

interface VoteResponse {
  way?: unknown;
  rationale?: unknown;
  sizeUsd?: unknown;
}

interface TurnResponse {
  content?: unknown;
}

function parseWay(value: unknown): VoteWay {
  if (typeof value === "string") {
    const upper = value.trim().toUpperCase();
    if ((WAYS as readonly string[]).includes(upper)) return upper as VoteWay;
  }
  return "NOTR";
}

function uniqueAgentNames(members: string[]): string[] {
  const names = new Set<string>();
  for (const member of members) {
    const name = member.includes("|") ? member.split("|")[1] : member;
    if (name) names.add(name);
  }
  return [...names];
}

function splitRoom(roomId: string): { market: string; interval: string } {
  const [market = roomId, interval = ""] = roomId.split(":");
  return { market, interval };
}

function utcHourBucket(d: Date): string {
  return d.toISOString().slice(0, 13);
}

async function collectVote(
  io: IOServer,
  sessionId: string,
  roomId: string,
  agentName: string,
  phase: VotePhase,
  transcript: TranscriptEntry[],
): Promise<void> {
  const response = await requestFromAgent<VoteResponse>(
    agentName,
    "discussion:vote-request",
    { sessionId, roomId, phase, transcript },
    config.discussionVoteTimeoutMs,
  );

  const responded = response !== null;

  if (!responded) {
    console.log(
      `[discussion] skip agent=${agentName} reason=offline_or_timeout phase=${phase}`,
    );
    await Vote.create({
      sessionId,
      roomId,
      agentName,
      phase,
      way: "NOTR",
      rationale: "",
      sizeUsd: 0,
      responded: false,
    });
    io.to(roomId).emit("session:vote", {
      sessionId,
      roomId,
      agentName,
      phase,
      way: "NOTR",
      rationale: "",
      sizeUsd: 0,
      responded: false,
    });
    return;
  }

  const way = parseWay(response?.way);
  const rationale =
    typeof response?.rationale === "string" ? response.rationale : "";
  const sizeRaw =
    typeof response?.sizeUsd === "number"
      ? response.sizeUsd
      : Number(response?.sizeUsd);
  let sizeUsd = Number.isFinite(sizeRaw) && sizeRaw > 0 ? sizeRaw : 0;

  // Decouple conviction (direction) from capital (size). The agent's LONG/SHORT
  // is preserved for the record, the broadcast, and excellence scoring even when
  // its spending cap is 0; only the tradable size is bound by the cap.
  const agent = await Agent.findOne({ name: agentName }).lean();
  const cap = agent?.spendingCapUsd ?? 0;
  if (cap <= 0 && sizeUsd > 0) {
    console.log(`[discussion] clamp agent=${agentName} reason=cap_zero cap=0`);
    sizeUsd = 0;
  } else if (cap > 0 && sizeUsd > cap) {
    console.log(
      `[discussion] clamp agent=${agentName} reason=cap_exceeded cap=${cap}`,
    );
    sizeUsd = cap;
  }

  await Vote.create({
    sessionId,
    roomId,
    agentName,
    phase,
    way,
    rationale,
    sizeUsd,
    responded: true,
  });

  const sizeLabel = way === "NOTR" ? "" : ` $${sizeUsd}`;
  console.log(
    `[discussion] vote session=${sessionId} room=${roomId} agent=${agentName} ${phase}=${way}${sizeLabel}${
      rationale ? ` :: ${rationale.slice(0, 80)}` : ""
    }`,
  );

  io.to(roomId).emit("session:vote", {
    sessionId,
    roomId,
    agentName,
    phase,
    way,
    rationale,
    sizeUsd,
    responded: true,
  });
}

export async function runSession(io: IOServer, roomId: string): Promise<void> {
  const members = await roomMembers(roomId);
  const candidates = uniqueAgentNames(members).filter((n) => isAgentOnline(n));
  const participants = await selectParticipantsForRoom(
    candidates,
    config.discussionMaxParticipants,
  );

  if (participants.length < 2) return;

  const sessionId = randomUUID();
  const { market, interval } = splitRoom(roomId);

  await DiscussionSession.create({
    sessionId,
    roomId,
    status: "open",
    participants,
    rounds: 0,
    startedAt: new Date(),
  });

  console.log(
    `[discussion] open session=${sessionId} room=${roomId} agents=${participants.length}`,
  );

  io.to(roomId).emit("session:open", {
    sessionId,
    roomId,
    market,
    interval,
    participants,
  });

  const transcript: TranscriptEntry[] = [];

  for (const name of participants) {
    await collectVote(io, sessionId, roomId, name, "initial", transcript);
  }

  const totalRounds = config.discussionRounds;
  let completedRounds = 0;
  for (let round = 1; round <= totalRounds; round += 1) {
    let anyTurn = false;
    for (const name of participants) {
      const response = await requestFromAgent<TurnResponse>(
        name,
        "discussion:turn-request",
        { sessionId, roomId, round, market, interval, transcript },
        config.discussionTurnTimeoutMs,
      );
      const content =
        typeof response?.content === "string" ? response.content.trim() : "";
      if (!content) continue;

      anyTurn = true;
      transcript.push({ agentName: name, content });
      await DiscussionMessage.create({
        sessionId,
        roomId,
        agentName: name,
        round,
        content,
      });
      console.log(
        `[discussion] turn session=${sessionId} room=${roomId} agent=${name} round=${round} :: ${content.replace(/\s+/g, " ").slice(0, 120)}`,
      );
      io.to(roomId).emit("session:turn", {
        sessionId,
        roomId,
        agentName: name,
        round,
        content,
      });
    }
    if (anyTurn) completedRounds += 1;
  }

  for (const name of participants) {
    await collectVote(io, sessionId, roomId, name, "final", transcript);
  }

  const finalVotes = await Vote.find({ sessionId, phase: "final" }).lean();
  const tally: Record<VoteWay, number> = { LONG: 0, SHORT: 0, NOTR: 0 };
  for (const vote of finalVotes) {
    tally[vote.way as VoteWay] += 1;
  }

  const closedAt = new Date();
  await DiscussionSession.updateOne(
    { sessionId },
    { $set: { status: "closed", closedAt, rounds: completedRounds } },
  );

  console.log(
    `[discussion] close session=${sessionId} room=${roomId} rounds=${completedRounds} tally=L${tally.LONG}/S${tally.SHORT}/N${tally.NOTR}`,
  );

  io.to(roomId).emit("session:close", {
    sessionId,
    roomId,
    rounds: completedRounds,
    tally,
  });

  try {
    await scoreSession(sessionId);
    await queueSessionAnchor(sessionId, utcHourBucket(closedAt));
  } catch (err) {
    console.warn(
      `[discussion] post-close failed session=${sessionId}: ${(err as Error).message}`,
    );
  }
}
