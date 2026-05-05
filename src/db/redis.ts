import { Redis } from "ioredis";
import type { Redis as RedisClient } from "ioredis";
import { config } from "../config.js";

let client: RedisClient | null = null;

export async function connectRedis(): Promise<RedisClient> {
  if (client && client.status === "ready") return client;

  const url = config.redisUrl;
  const next = new Redis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    enableReadyCheck: true,
  });

  next.on("error", (err: Error) => {
    console.error(`[redis] error: ${err.message}`);
  });

  await next.connect();
  client = next;
  console.log(`[redis] connected: ${url}`);
  return next;
}

export function getRedis(): RedisClient {
  if (!client) {
    throw new Error(
      "Redis is not connected. Call connectRedis() during startup.",
    );
  }
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (!client) return;
  await client.quit();
  client = null;
}
