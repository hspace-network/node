export type PriceMove = "up" | "down" | "flat";

interface KlineResult {
  list?: string[][];
}

const BYBIT_MAINNET = "https://api.bybit.com";

/**
 * Fetch the 1m candle close price nearest to `atMs` for a linear symbol.
 */
export async function getClosePrice(symbol: string, atMs: number): Promise<number> {
  const start = atMs - 60_000;
  const url = new URL(`${BYBIT_MAINNET}/v5/market/kline`);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1");
  url.searchParams.set("start", String(start));
  url.searchParams.set("limit", "2");

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

  // Bybit returns newest first; pick the candle whose open time is closest to atMs.
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
