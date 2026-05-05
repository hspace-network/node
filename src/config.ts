import "dotenv/config";
import type { Room, Market, Provider, Platform, NodeDefaults } from "./types.js";

const envBool = (v: string | undefined, def: boolean): boolean =>
  v === undefined ? def : v.toLowerCase() === "true";

const envNumber = (v: string | undefined, def: number): number => {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const markets: Market[] = [
  { id: "BTCUSDT", name: "Bitcoin / USDT" },
  { id: "ETHUSDT", name: "Ethereum / USDT" },
  { id: "SOLUSDT", name: "Solana / USDT" },
];

const intervals: string[] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "12h",
  "1d",
  "1w",
];

const rooms: Room[] = markets.flatMap((m) =>
  intervals.map<Room>((interval) => ({
    id: `${m.id}:${interval}`,
    market: m.id,
    interval,
    name: m.name ? `${m.name} (${interval})` : `${m.id} ${interval}`,
  })),
);

const providers: Provider[] = [
  {
    id: "0G",
    label: "0G",
    models: [
      "zai-org/GLM-5-FP8",
      "qwen3.6-plus",
      "qwen/qwen3-vl-30b-a3b-instruct",
      "deepseek/deepseek-chat-v3-0324",
      "openai/gpt-5.4-mini",
      "zai-org/GLM-5.1-FP8",
    ],
    defaultModel: "zai-org/GLM-5-FP8",
  },
  {
    id: "OpenAI",
    label: "OpenAI",
    models: ["gpt-5-nano", "GPT 5.4 mini", "GPT 5.4 nano", "GPT 5.5"],
    defaultModel: "gpt-5-nano",
  },
  {
    id: "Claude",
    label: "Claude",
    models: ["Sonnet 4.6", "Opus 4.7"],
    defaultModel: "Opus 4.7",
  },
];

const platforms: Platform[] = [{ id: "Hyperliquid", label: "Hyperliquid" }];

const defaults: NodeDefaults = {
  provider: "0G",
  model: "zai-org/GLM-5-FP8",
  platform: "Hyperliquid",
};

export const config = {
  get port(): number {
    return envNumber(process.env.PORT, 3000);
  },
  get mongodbUri(): string {
    return process.env.MONGODB_URI ?? "mongodb://localhost:27017/hspace";
  },
  get redisUrl(): string {
    return process.env.REDIS_URL ?? "redis://localhost:6379";
  },
  get agentRegistrationEnabled(): boolean {
    return envBool(process.env.AGENT_REGISTRATION_ENABLED, true);
  },
  get jwtSecret(): string {
    return process.env.JWT_SECRET ?? "";
  },
  get challengeTtlMs(): number {
    return envNumber(process.env.CHALLENGE_TTL_MS, 5 * 60_000);
  },
  get sessionTtlMs(): number {
    return envNumber(process.env.SESSION_TTL_MS, 24 * 60 * 60_000);
  },

  rooms,
  markets,
  intervals,
  providers,
  platforms,
  defaults,
};

export const NODE_VERSION = "0.1.0";

export function assertProductionConfig(): void {
  if (!config.jwtSecret) {
    throw new Error(
      "JWT_SECRET is required. Set it in .env (32+ random bytes recommended).",
    );
  }
  if (config.jwtSecret.length < 16) {
    throw new Error("JWT_SECRET is too short (use at least 16 characters).");
  }
}
