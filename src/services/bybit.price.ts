import { intervalToMs, intervalToBybitKline } from "../config.js";

export type PriceMove = "up" | "down" | "flat";

interface KlineResult {
  list?: string[][];
}

const BYBIT_MAINNET = "https://api.bybit.com";

function lookbackMs(roomInterval: string): number {
  const ms = intervalToMs(roomInterval);
  if (ms && ms > 0) return ms;
  return 60_000;
}

/**
 * Fetch the candle close price nearest to `atMs` for a linear symbol.
 * Uses the room interval's Bybit kline granularity (1m → "1", 4h → "240", etc.).
 */
export async function getClosePrice(
  symbol: string,
  atMs: number,
  roomInterval: string,
): Promise<number> {
  const klineInterval = intervalToBybitKline(roomInterval);
  if (!klineInterval) {
    throw new Error(`Unknown room interval "${roomInterval}" for price fetch`);
  }

  const back = lookbackMs(roomInterval);
  const start = atMs - back;
  const url = new URL(`${BYBIT_MAINNET}/v5/market/kline`);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", klineInterval);
  url.searchParams.set("start", String(start));
  url.searchParams.set("limit", "3");

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`Bybit kline HTTP ${res.status} for ${symbol}`);
  }

  const body = (await res.json()) as {
    retCode?: number;
    retMsg?: string;
    result?: KlineResult;
  };

  if (body.retCode !== 0) {
    throw new Error(body.retMsg ?? `Bybit kline error for ${symbol}`);
  }

  const rows = body.result?.list ?? [];
  if (rows.length === 0) {
    throw new Error(`No kline data for ${symbol} at ${new Date(atMs).toISOString()}`);
  }

  let bestClose = Number(rows[0]![4]);
  let bestDist = Infinity;
  for (const row of rows) {
    const openMs = Number(row[0]);
    const close = Number(row[4]);
    if (!Number.isFinite(openMs) || !Number.isFinite(close)) continue;
    const dist = Math.abs(openMs - atMs);
    if (dist < bestDist) {
      bestDist = dist;
      bestClose = close;
    }
  }

  if (!Number.isFinite(bestClose) || bestClose <= 0) {
    throw new Error(`Invalid close price for ${symbol}`);
  }

  return bestClose;
}

export function classifyMove(
  p0: number,
  p1: number,
  flatThresholdPct: number,
): PriceMove {
  if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0) {
    return "flat";
  }
  const pct = ((p1 - p0) / p0) * 100;
  if (Math.abs(pct) < flatThresholdPct) return "flat";
  return pct > 0 ? "up" : "down";
}
