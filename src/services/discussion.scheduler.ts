import type { Server as IOServer } from "socket.io";
import { config, intervalToMs } from "../config.js";
import { getRedis } from "../db/redis.js";
import { roomMembers } from "./runs.service.js";
import { runSession } from "./discussion.orchestrator.js";

function lockKey(roomId: string): string {
  return `session:lock:${roomId}`;
}

function uniqueAgentCount(members: string[]): number {
  const names = new Set<string>();
  for (const member of members) {
    const name = member.includes("|") ? member.split("|")[1] : member;
    if (name) names.add(name);
  }
  return names.size;
}

async function tick(io: IOServer, roomId: string, lockTtlMs: number): Promise<void> {
  let acquired = false;
  try {
    const members = await roomMembers(roomId);
    if (uniqueAgentCount(members) < 2) return;

    const redis = getRedis();
    const result = await redis.set(
      lockKey(roomId),
      String(Date.now()),
      "PX",
      lockTtlMs,
      "NX",
    );
    if (result !== "OK") return;
    acquired = true;

    await runSession(io, roomId);
  } catch (err) {
    console.error(
      `[discussion] tick failed room=${roomId}: ${(err as Error).message}`,
    );
  } finally {
    if (acquired) {
      try {
        await getRedis().del(lockKey(roomId));
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
