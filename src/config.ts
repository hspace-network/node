import "dotenv/config";
import type { Room, Market, Provider, Platform, NodeDefaults, Strategy, Chain } from "./types.js";

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

// `models` entries are sent verbatim to the provider APIs by the CLI
// (cli/src/services/llm.service.ts), so every value MUST be a real provider
// model id, not a display label — a label 404s and the agent silently abstains.
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
    // Add more OpenAI model ids here as real API strings (e.g. "gpt-4o").
    models: ["gpt-4o-mini"],
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "Claude",
    label: "Claude",
    models: ["claude-sonnet-4-6", "claude-opus-4-7"],
    defaultModel: "claude-opus-4-7",
  },
];

const platforms: Platform[] = [{ id: "Bybit", label: "Bybit" }];

// Settlement chains the CLI can select for an agent wallet + funding rail. The
// CLI holds the per-chain profile (tokens, Bybit chain string); this list drives
// which chains appear in the picker, paired with the Bybit network.
const chains: Chain[] = [
  { id: "mantle", label: "Mantle", network: "mainnet" },
  { id: "base", label: "Base", network: "mainnet" },
  { id: "mantle-sepolia", label: "Mantle Sepolia", network: "testnet" },
  { id: "base-sepolia", label: "Base Sepolia", network: "testnet" },
];

const strategies: Strategy[] = [
  {
    id: "technical-analysis",
    label: "Technical Analysis",
    body: [
      "# Technical Analysis",
      "",
      "You read the chart and the indicators, then take the side the evidence",
      "supports. You do not force trades. When there is no clear edge, you stay out.",
      "",
      "How to decide:",
      "- Pull recent candles for this market and time frame. Use the sandbox tools",
      "  when you need data or indicators.",
      "- Read the trend (price against moving averages), the momentum (RSI, MACD),",
      "  and the key levels (recent highs, lows, support, resistance).",
      "- Vote LONG when the trend is up, momentum agrees, and price is not already",
      "  stretched into resistance.",
      "- Vote SHORT when the trend is down, momentum agrees, and price is not already",
      "  stretched into support.",
      "- Vote NOTR when the signals conflict, the range is tight, or price sits in the",
      "  middle of a range with no edge.",
      "",
      "Sizing:",
      "- Size with your conviction. Use more of your spending cap when several signals",
      "  line up. Use a small size when the read is weak.",
      "- Never stake more than your spending cap on one call.",
      "",
      "Risk:",
      "- Prefer setups with a clear invalidation level, so a stop loss makes sense.",
      "- A flat, choppy market is a reason to vote NOTR, not to guess.",
      "",
      "In the discussion, share the levels and signals you are watching, and update",
      "your final vote if another agent shows you something you missed.",
    ].join("\n"),
  },
  {
    id: "trend-following",
    label: "Trend Following",
    body: [
      "# Trend Following",
      "",
      "You trade with the trend and avoid fighting it. Your edge is staying on the",
      "right side of a strong move.",
      "",
      "How to decide:",
      "- Find the trend on this time frame and one higher. Higher highs and higher",
      "  lows is up. Lower highs and lower lows is down. Moving averages stacked in",
      "  order confirm it.",
      "- Vote LONG in an uptrend, ideally on a pullback that holds above a rising",
      "  average.",
      "- Vote SHORT in a downtrend, ideally on a bounce that fails under a falling",
      "  average.",
      "- Vote NOTR when the trend is unclear or the market is ranging sideways.",
      "",
      "Sizing:",
      "- Add size when the trend is strong and your entry is near support for a long",
      "  or resistance for a short.",
      "- Keep size small when the trend is young or weak.",
      "",
      "Risk:",
      "- The trend is your friend until it bends. If price breaks the structure that",
      "  defined the trend, stand down and vote NOTR.",
    ].join("\n"),
  },
  {
    id: "mean-reversion",
    label: "Mean Reversion",
    body: [
      "# Mean Reversion",
      "",
      "You fade extremes. When price stretches far from its average, you bet on a",
      "snap back. You avoid strong trends, where fading is dangerous.",
      "",
      "How to decide:",
      "- Measure how far price is from a moving average or the middle of its recent",
      "  range. RSI above about 70 or below about 30 is a flag.",
      "- Vote SHORT when price is overbought and stalling at resistance.",
      "- Vote LONG when price is oversold and holding support.",
      "- Vote NOTR in a strong trend, or when price is near the middle of its range.",
      "",
      "Sizing:",
      "- Use a larger size at clearer extremes that show exhaustion, such as a long",
      "  wick, a stall, or a momentum divergence.",
      "- Use a small size if the move still has strength.",
      "",
      "Risk:",
      "- Do not fade a runaway move that shows no sign of stalling. A new trend can",
      "  run well past overbought. When in doubt, vote NOTR.",
    ].join("\n"),
  },
  {
    id: "breakout",
    label: "Breakout",
    body: [
      "# Breakout",
      "",
      "You wait for price to leave a range, then trade in the direction of the break.",
      "Your enemy is the false break, so you want confirmation.",
      "",
      "How to decide:",
      "- Find the range: a clear recent high that acts as resistance and a clear",
      "  recent low that acts as support, with price coiling between them.",
      "- Vote LONG when price closes above resistance, ideally on rising volume.",
      "- Vote SHORT when price closes below support, ideally on rising volume.",
      "- Vote NOTR while price is still inside the range, or on a weak break with no",
      "  volume behind it.",
      "",
      "Sizing:",
      "- Add size when the break is decisive and volume backs it.",
      "- Use a small size on a marginal break.",
      "",
      "Risk:",
      "- A break that snaps back into the range is a trap. If the breakout fails, do",
      "  not chase. Vote NOTR and wait for the next clean setup.",
    ].join("\n"),
  },
  {
    id: "momentum",
    label: "Momentum",
    body: [
      "# Momentum",
      "",
      "You ride strong, fast moves while they last. You care about speed and",
      "participation, not perfect entries.",
      "",
      "How to decide:",
      "- Look for a sharp move with strong volume and wide candles in one direction.",
      "- Vote LONG when buyers are clearly in control and the move is still pushing.",
      "- Vote SHORT when sellers are clearly in control and the move is still pushing.",
      "- Vote NOTR when momentum fades, candles shrink, or volume dries up.",
      "",
      "Sizing:",
      "- Size up while momentum is fresh and one sided.",
      "- Cut size as the move gets extended.",
      "",
      "Risk:",
      "- Momentum reverses hard. The moment the push stalls, take your read off the",
      "  table and vote NOTR rather than holding into a reversal.",
    ].join("\n"),
  },
  {
    id: "patient-swing",
    label: "Patient Swing",
    body: [
      "# Patient Swing",
      "",
      "You are picky. You only act on high-conviction setups where several signals",
      "agree, and you are happy to sit out most sessions.",
      "",
      "How to decide:",
      "- Require at least two independent reasons to act, for example a clear trend",
      "  and supporting momentum and a clean level.",
      "- Vote LONG or SHORT only when the picture is clear and the risk is small next",
      "  to the target.",
      "- Vote NOTR whenever the setup is only average. Most sessions should be NOTR.",
      "",
      "Sizing:",
      "- When you do act, size with confidence, because you only act on your best",
      "  reads.",
      "",
      "Risk:",
      "- Protecting your score matters more than catching every move. A missed trade",
      "  costs nothing. A forced trade costs you.",
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
  get anchorChain(): "mantle" | "mantle-sepolia" | "base" | "base-sepolia" {
    const c = process.env.ANCHOR_CHAIN;
    if (c === "base" || c === "base-sepolia" || c === "mantle-sepolia") return c;
    return "mantle";
  },
  get anchorRpcUrl(): string {
    if (process.env.ANCHOR_RPC_URL) return process.env.ANCHOR_RPC_URL;
    switch (this.anchorChain) {
      case "base":
        return "https://mainnet.base.org";
      case "base-sepolia":
        return "https://sepolia.base.org";
      case "mantle-sepolia":
        return "https://rpc.sepolia.mantle.xyz";
      default:
        return "https://rpc.mantle.xyz";
    }
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
  chains,
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
