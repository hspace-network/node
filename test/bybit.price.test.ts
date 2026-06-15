import { describe, it, expect, vi, afterEach } from "vitest";
import { intervalToBybitKline } from "../src/config.js";
import { getClosePrice } from "../src/services/bybit.price.js";

describe("intervalToBybitKline", () => {
  it("maps room intervals to Bybit kline params", () => {
    expect(intervalToBybitKline("1m")).toBe("1");
    expect(intervalToBybitKline("5m")).toBe("5");
    expect(intervalToBybitKline("1h")).toBe("60");
    expect(intervalToBybitKline("4h")).toBe("240");
    expect(intervalToBybitKline("12h")).toBe("720");
    expect(intervalToBybitKline("1d")).toBe("D");
    expect(intervalToBybitKline("1w")).toBe("W");
    expect(intervalToBybitKline("bogus")).toBeNull();
  });
});

describe("getClosePrice", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the mapped kline interval", async () => {
    const atMs = 1_700_000_000_000;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        retCode: 0,
        result: {
          list: [[String(atMs), "1", "2", "3", "42000", "0", "0"]],
        },
      }),
    } as Response);

    const price = await getClosePrice("BTCUSDT", atMs, "4h");
    expect(price).toBe(42000);

    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain("interval=240");
    expect(calledUrl).toContain("symbol=BTCUSDT");
  });
});
