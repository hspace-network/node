import { config } from "../config.js";
import { getRedis } from "../db/redis.js";

export class RunsError extends Error {
  constructor(
    public code:
      | "invalid_room"
      | "unknown_room"
      | "invalid_agent_name"
      | "redis_error",
    message: string,
  ) {
    super(message);
    this.name = "RunsError";
  }
}

const ROOM_ID_REGEX = /^[A-Z0-9]+:[0-9]+[mhdw]$/;
const AGENT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

function agentRoomsKey(address: string, agentName: string): string {
  return `agent:${address}:${agentName}:rooms`;
}

function roomMembersKey(roomId: string): string {
  return `room:${roomId}:agents`;
}

function memberValue(address: string, agentName: string): string {
  return `${address}|${agentName}`;
}

function assertValidRoom(roomId: string): void {
  if (!ROOM_ID_REGEX.test(roomId)) {
    throw new RunsError(
      "invalid_room",
      `Invalid room id "${roomId}". Expected format MARKET:INTERVAL (e.g. BTCUSDT:1m).`,
    );
  }
  const known = config.rooms.some((r) => r.id === roomId);
  if (!known) {
    throw new RunsError(
      "unknown_room",
      `Unknown room "${roomId}". Use one of the rooms exposed by /config.`,
    );
  }
}

function assertValidAgentName(agentName: string): void {
  if (!AGENT_NAME_REGEX.test(agentName)) {
    throw new RunsError(
      "invalid_agent_name",
      `Invalid agent name "${agentName}".`,
    );
  }
}

export async function addRun(
  address: string,
  agentName: string,
  roomId: string,
): Promise<void> {
  assertValidAgentName(agentName);
  assertValidRoom(roomId);
  const redis = getRedis();
  const lower = address.toLowerCase();
  await redis
    .multi()
    .sadd(agentRoomsKey(lower, agentName), roomId)
    .sadd(roomMembersKey(roomId), memberValue(lower, agentName))
    .exec();
}

export async function removeRun(
  address: string,
  agentName: string,
  roomId: string,
): Promise<void> {
  assertValidAgentName(agentName);
  assertValidRoom(roomId);
  const redis = getRedis();
  const lower = address.toLowerCase();
  await redis
    .multi()
    .srem(agentRoomsKey(lower, agentName), roomId)
    .srem(roomMembersKey(roomId), memberValue(lower, agentName))
    .exec();
}

export async function listRoomsForAgent(
  address: string,
  agentName: string,
): Promise<string[]> {
  const redis = getRedis();
  const lower = address.toLowerCase();
  const rooms = await redis.smembers(agentRoomsKey(lower, agentName));
  return rooms.sort();
}

export async function listRunsForAddress(
  address: string,
): Promise<{ name: string; rooms: string[] }[]> {
  const redis = getRedis();
  const lower = address.toLowerCase();
  const pattern = `agent:${lower}:*:rooms`;

  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "100",
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");

  if (keys.length === 0) return [];

  const out: { name: string; rooms: string[] }[] = [];
  for (const key of keys) {
    const segments = key.split(":");
    const agentName = segments[2];
    if (!agentName) continue;
    const rooms = await redis.smembers(key);
    if (rooms.length === 0) continue;
    out.push({ name: agentName, rooms: rooms.sort() });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function roomMembers(roomId: string): Promise<string[]> {
  assertValidRoom(roomId);
  const redis = getRedis();
  return await redis.smembers(roomMembersKey(roomId));
}

export async function clearAllRuns(): Promise<void> {
  const redis = getRedis();
  let cursor = "0";
  const keys: string[] = [];
  do {
    const [next, batch] = await redis.scan(
      cursor,
      "MATCH",
      "agent:*:rooms",
      "COUNT",
      "200",
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");

  cursor = "0";
  do {
    const [next, batch] = await redis.scan(
      cursor,
      "MATCH",
      "room:*:agents",
      "COUNT",
      "200",
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");

  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
