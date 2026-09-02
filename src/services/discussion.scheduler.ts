import { randomUUID } from "node:crypto";
import type { Server as IOServer } from "socket.io";
import { config, intervalToMs } from "../config.js";
import { getRedis } from "../db/redis.js";
import { roomMembers } from "./runs.service.js";
import { runSession } from "./discussion.orchestrator.js";

function lockKey(roomId: string): string {
  return `session:lock:${roomId}`;
}

// Rooms with a session in flight in THIS process. runSession holds through
// scoring, which can outlive the Redis lock's TTL; once the TTL expires the NX
// lock would let the next tick start a second, concurrent session for the same
// room — which reconciles the same Bybit position twice (double-trade). Since
// the node is single-instance (the socket registry and this set are in-memory),
// this guard reliably prevents same-room overlap regardless of the Redis TTL.
const activeRooms = new Set<string>();

// Compare-and-delete: release the Redis lock only if we still hold it. Stops a
// tick whose lock already expired from deleting a lock a later tick now owns.
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

function uniqueAgentCount(members: string[]): number {
  const names = new Set<string>();
  for (const member of members) {
    const name = member.includes("|") ? member.split("|")[1] : member;
    if (name) names.add(name);
  }
  return names.size;
}

async function tick(io: IOServer, roomId: string, lockTtlMs: number): Promise<void> {
  // Fast in-process guard: never overlap two sessions for one room.
  if (activeRooms.has(roomId)) return;

  let acquired = false;
  const token = randomUUID();
  try {
    const members = await roomMembers(roomId);
    if (uniqueAgentCount(members) < 2) return;

    const redis = getRedis();
    const result = await redis.set(lockKey(roomId), token, "PX", lockTtlMs, "NX");
    if (result !== "OK") return;
    acquired = true;
    activeRooms.add(roomId);

    await runSession(io, roomId);
  } catch (err) {
    console.error(
      `[discussion] tick failed room=${roomId}: ${(err as Error).message}`,
    );
  } finally {
    if (acquired) {
      activeRooms.delete(roomId);
      try {
        await getRedis().eval(RELEASE_LOCK_SCRIPT, 1, lockKey(roomId), token);
      } catch {
        // lock will expire on its own via PX TTL
      }
    }
  }
}

export function startDiscussionScheduler(io: IOServer): () => void {
  if (!config.discussionsEnabled) {
    console.log("[discussion] scheduler disabled (DISCUSSIONS_ENABLED=false)");
    return () => undefined;
  }

  const timers: NodeJS.Timeout[] = [];
  let scheduled = 0;

  for (const room of config.rooms) {
    const ms = intervalToMs(room.interval);
    if (ms === null) continue;
    const lockTtlMs = Math.min(Math.max(ms * 2, 5 * 60_000), 30 * 60_000);
    const timer = setInterval(() => {
      void tick(io, room.id, lockTtlMs);
    }, ms);
    timer.unref?.();
    timers.push(timer);
    scheduled += 1;
  }

  console.log(
    `[discussion] scheduler started for ${scheduled} room(s); rounds=${config.discussionRounds}, maxAgents=${config.discussionMaxParticipants}`,
  );

  return () => {
    for (const timer of timers) clearInterval(timer);
  };
}
