import { Agent } from "../db/agent.model.js";
import { Vote, type VoteWay } from "../db/vote.model.js";
import { DiscussionMessage } from "../db/discussion-message.model.js";
import { DiscussionSession } from "../db/discussion-session.model.js";
import { getRedis } from "../db/redis.js";
import { isAgentInRoom } from "../sockets/agent-registry.js";
import { intervalToMs } from "../config.js";

// Public, read-only view of the trading floor for the web bubble map.
// Clusters come from live room membership (Redis), scores/volume from Mongo.

export interface FloorAgent {
  id: string; // unique per running instance: `${name}@${roomId}`
  name: string;
  room: string;
  score: number; // excellence score, 0..1
  way: VoteWay | null; // latest stance in that room, if any
  live: boolean; // currently socket-connected in this room
}

export interface FloorRoom {
  id: string;
  market: string;
  interval: string;
}

export interface FloorMessage {
  from: string;
  room: string;
  ts: number;
}

export interface FloorSnapshot {
  stats: { agents: number; rooms: number; volumeUsd: number };
  rooms: FloorRoom[];
  agents: FloorAgent[];
  messages: FloorMessage[];
}

async function scanKeys(pattern: string): Promise<string[]> {
  const redis = getRedis();
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", "200");
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

export async function getFloorSnapshot(): Promise<FloorSnapshot> {
  const redis = getRedis();

  // Cluster membership = who is ACTUALLY on the floor of each room right now. An
  // agent only counts for a room when a connected socket is actively joined to
  // THAT room (isAgentInRoom). This is per-room, so stale Redis membership or an
  // orphaned open session for some OTHER room can never light an agent up in a
  // room it isn't really running. Two sources are unioned (live room membership
  // + still-open discussion participants), both gated by the same per-room check.
  const byRoom = new Map<string, Set<string>>();

  const addMember = (roomId: string, name: string | undefined): void => {
    if (!name || !isAgentInRoom(name, roomId)) return;
    (byRoom.get(roomId) ?? byRoom.set(roomId, new Set()).get(roomId)!).add(name);
  };

  const roomKeys = await scanKeys("room:*:agents");
  for (const key of roomKeys) {
    const roomId = key.slice("room:".length, key.length - ":agents".length);
    const members = await redis.smembers(key);
    for (const m of members) addMember(roomId, m.split("|")[1]);
  }

  const openSessions = await DiscussionSession.find(
    { status: "open" },
    { roomId: 1, participants: 1 },
  ).lean();
  for (const s of openSessions) {
    for (const name of s.participants ?? []) addMember(s.roomId, name);
  }

  const membership: { roomId: string; name: string }[] = [];
  for (const [roomId, set] of byRoom) {
    for (const name of set) membership.push({ roomId, name });
  }
  const names = [...new Set(membership.map((m) => m.name))];

  // 2. excellence scores for the agents currently on the floor
  const scoreByName = new Map<string, number>();
  if (names.length) {
    const docs = await Agent.find({ name: { $in: names } }, { name: 1, score: 1 }).lean();
    for (const d of docs) scoreByName.set(d.name, d.score ?? 0);
  }

  // 3. latest stance per (agent, room) — but ONLY when it is fresh for that
  // room's cadence. A vote older than max(2x interval, 1h) is treated as no
  // current stance (null), so a long-closed SHORT never shows on the floor.
  const wayByKey = new Map<string, VoteWay>();
  if (names.length) {
    const votes = await Vote.find(
      { agentName: { $in: names } },
      { agentName: 1, roomId: 1, way: 1, ts: 1 },
    )
      .sort({ ts: -1 })
      .limit(1000)
      .lean();
    const now = Date.now();
    const seen = new Set<string>();
    for (const v of votes) {
      const k = `${v.agentName}|${v.roomId}`;
      if (seen.has(k)) continue; // newest vote per (agent, room) wins
      seen.add(k);
      const intervalMs = intervalToMs(v.roomId.split(":")[1] ?? "") ?? 60 * 60_000;
      const maxAge = Math.max(2 * intervalMs, 60 * 60_000);
      const ts = new Date(v.ts as unknown as string).getTime();
      if (now - ts <= maxAge) wayByKey.set(k, v.way as VoteWay);
    }
  }

  const rooms: FloorRoom[] = [...byRoom.keys()].map((id) => {
    const [market, interval] = id.split(":");
    return { id, market, interval };
  });

  const liveAgents: FloorAgent[] = membership.map((m) => ({
    id: `${m.name}@${m.roomId}`,
    name: m.name,
    room: m.roomId,
    score: scoreByName.get(m.name) ?? 0,
    way: wayByKey.get(`${m.name}|${m.roomId}`) ?? null,
    live: true, // only currently-connected agents are included above
  }));

  // Inactive agents: the top 100 by excellence score that are NOT currently on
  // the floor. Surfaced as ambient nodes (room "", live false) so the map always
  // shows the population; the web scatters them as gray background dots.
  const liveNames = new Set(membership.map((m) => m.name));
  const inactiveDocs = await Agent.find(
    { name: { $nin: [...liveNames] } },
    { name: 1, score: 1 },
  )
    .sort({ score: -1 })
    .limit(100)
    .lean();
  const inactiveAgents: FloorAgent[] = inactiveDocs.map((d) => ({
    id: `inactive:${d.name}`,
    name: d.name,
    room: "",
    score: d.score ?? 0,
    way: null,
    live: false,
  }));

  const agents: FloorAgent[] = [...liveAgents, ...inactiveAgents];

  // 4. recent discussion messages drive the information-exchange pulses
  const msgDocs = await DiscussionMessage.find({}, { agentName: 1, roomId: 1, ts: 1 })
    .sort({ ts: -1 })
    .limit(60)
    .lean();
  const messages: FloorMessage[] = msgDocs.map((d) => ({
    from: d.agentName,
    room: d.roomId,
    ts: new Date(d.ts as unknown as string).getTime(),
  }));

  // 5. platform totals. Volume is bounded to a rolling 24h window so it
  // reflects recent activity instead of growing monotonically forever.
  const totalAgents = await Agent.countDocuments();
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const volAgg = await Vote.aggregate<{ v: number }>([
    { $match: { ts: { $gte: since } } },
    { $group: { _id: null, v: { $sum: "$sizeUsd" } } },
  ]);
  const volumeUsd = volAgg[0]?.v ?? 0;

  return {
    stats: { agents: totalAgents, rooms: rooms.length, volumeUsd },
    rooms,
    agents,
    messages,
  };
}
