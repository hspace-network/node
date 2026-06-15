import "dotenv/config";
import type { Room, Market, Provider, Platform, NodeDefaults, Strategy } from "./types.js";

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
    id: "z.ai",
    label: "z.ai",
    models: ["glm-5.1", "glm-5", "glm-4.6", "glm-4.5-air"],
    defaultModel: "glm-5.1",
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

const platforms: Platform[] = [{ id: "Bybit", label: "Bybit" }];

const strategies: Strategy[] = [
  {
    id: "always-long",
    label: "Always LONG",
    body: [
      "# Always LONG",
      "",
      "Testing strategy — always vote LONG.",
      "",
      "Rules:",
      "- On every final vote, set way to LONG.",
      "- Set sizeUsd to your full spending cap (maximum conviction).",
      "- Ignore discussion that suggests otherwise.",
    ].join("\n"),
  },
  {
    id: "always-short",
    label: "Always SHORT",
    body: [
      "# Always SHORT",
      "",
      "Testing strategy — always vote SHORT.",
      "",
      "Rules:",
      "- On every final vote, set way to SHORT.",
      "- Set sizeUsd to your full spending cap (maximum conviction).",
      "- Ignore discussion that suggests otherwise.",
    ].join("\n"),
  },
  {
    id: "always-notr",
    label: "Always NOTR",
    body: [
      "# Always NOTR",
      "",
      "Testing strategy — never trade.",
      "",
      "Rules:",
      "- On every final vote, set way to NOTR.",
      "- Always set sizeUsd to 0.",
      "- Do not open or adjust positions.",
    ].join("\n"),
  },
];

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

export function intervalToMs(interval: string): number | null {
  return INTERVAL_MS[interval] ?? null;
}

const INTERVAL_BYBIT_KLINE: Record<string, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "4h": "240",
  "12h": "720",
  "1d": "D",
  "1w": "W",
};

/** Bybit v5 kline interval param for a room interval label. */
export function intervalToBybitKline(interval: string): string | null {
  return INTERVAL_BYBIT_KLINE[interval] ?? null;
}

const defaults: NodeDefaults = {
  provider: "z.ai",
  model: "glm-5.1",
  platform: "Bybit",
};

export const config = {
  get port(): number {
    return envNumber(process.env.PORT, 6161);
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
  get discussionsEnabled(): boolean {
    return envBool(process.env.DISCUSSIONS_ENABLED, true);
  },
  get discussionRounds(): number {
    return envNumber(process.env.DISCUSSION_ROUNDS, 2);
  },
  get discussionMaxParticipants(): number {
    return envNumber(process.env.DISCUSSION_MAX_PARTICIPANTS, 16);
  },
  get discussionVoteTimeoutMs(): number {
    return envNumber(process.env.DISCUSSION_VOTE_TIMEOUT_MS, 30_000);
  },
  get discussionTurnTimeoutMs(): number {
    return envNumber(process.env.DISCUSSION_TURN_TIMEOUT_MS, 45_000);
  },
  // Base score move per correct/incorrect call, on the [0,100] excellence scale
  // (multiplied by the conviction factor 0.5..1).
  get excellenceScoreDelta(): number {
    return envNumber(process.env.EXCELLENCE_SCORE_DELTA, 5);
  },
  get excellenceFlatThresholdPct(): number {
    return envNumber(process.env.EXCELLENCE_FLAT_THRESHOLD_PCT, 0.05);
  },
  get excellenceReferenceUsd(): number {
    return envNumber(process.env.EXCELLENCE_REFERENCE_USD, 50);
  },
  get matchmakingEpsilon(): number {
    return envNumber(process.env.MATCHMAKING_EPSILON, 0.1);
  },
  get anchorEnabled(): boolean {
    return envBool(process.env.ANCHOR_ENABLED, false);
  },
  /** Operator wallet for hourly on-chain session anchors (Mantle gas). */
  get anchorPrivateKey(): string {
    return process.env.ANCHOR_PRIVATE_KEY ?? "";
  },
  get anchorContractAddress(): string {
    return process.env.ANCHOR_CONTRACT_ADDRESS ?? "";
  },
  get anchorRpcUrl(): string {
    return process.env.ANCHOR_RPC_URL ?? "https://rpc.mantle.xyz";
  },

  // --- Gasless onboarding: operator-sponsored Mantle gas drip for new agents.
  get gasSponsorEnabled(): boolean {
    return envBool(process.env.GAS_SPONSOR_ENABLED, false);
  },
  /** Operator wallet that pays the onboarding gas drip (falls back to the anchor wallet). */
  get gasSponsorPrivateKey(): string {
    return process.env.GAS_SPONSOR_PRIVATE_KEY ?? process.env.ANCHOR_PRIVATE_KEY ?? "";
  },
  get gasSponsorChain(): "mantle" | "mantle-sepolia" {
    return process.env.GAS_SPONSOR_CHAIN === "mantle-sepolia" ? "mantle-sepolia" : "mantle";
  },
  get gasSponsorRpcUrl(): string {
    if (process.env.GAS_SPONSOR_RPC_URL) return process.env.GAS_SPONSOR_RPC_URL;
    return process.env.GAS_SPONSOR_CHAIN === "mantle-sepolia"
      ? "https://rpc.sepolia.mantle.xyz"
      : "https://rpc.mantle.xyz";
  },
  /** MNT sent to each new agent wallet so it can pay its own deposit gas. */
  get gasSponsorAmountMnt(): string {
    return process.env.GAS_SPONSOR_AMOUNT_MNT ?? "0.05";
  },
  /** Global anti-abuse cap on total MNT sponsored per rolling 24h. */
  get gasSponsorDailyBudgetMnt(): string {
    return process.env.GAS_SPONSOR_DAILY_BUDGET_MNT ?? "5";
  },
  /** Skip the drip if the recipient already holds at least this much MNT. */
  get gasSponsorMinBalanceMnt(): string {
    return process.env.GAS_SPONSOR_MIN_BALANCE_MNT ?? "0.05";
  },

  rooms,
  markets,
  intervals,
  providers,
  platforms,
  strategies,
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
