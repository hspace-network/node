import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server.js";
import { cliFetch } from "./helpers/cli.js";

describe("GET /config", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns rooms, markets, intervals, providers, platforms, defaults", async () => {
    const res = await cliFetch<{
      version: string;
      rooms: { id: string; market: string; interval: string }[];
      markets: { id: string }[];
      intervals: string[];
      providers: unknown[];
      platforms: unknown[];
      defaults: { provider?: string; model?: string; platform?: string };
    }>(server.baseUrl, "GET", "/config");

    expect(res.status).toBe(200);
    expect(typeof res.body.version).toBe("string");
    expect(Array.isArray(res.body.rooms)).toBe(true);
    expect(res.body.rooms.length).toBeGreaterThan(0);
    expect(res.body.rooms[0]!.id).toMatch(/^[A-Z0-9]+:[0-9]+[mhdw]$/);
    expect(typeof res.body.rooms[0]!.market).toBe("string");
    expect(typeof res.body.rooms[0]!.interval).toBe("string");
    expect(Array.isArray(res.body.markets)).toBe(true);
    expect(res.body.markets.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.intervals)).toBe(true);
    expect(res.body.intervals.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.providers)).toBe(true);
    expect(Array.isArray(res.body.platforms)).toBe(true);
    expect(res.body.defaults.provider).toBeDefined();
  });

  it("never leaks server-only fields", async () => {
    const res = await cliFetch<Record<string, unknown>>(
      server.baseUrl,
      "GET",
      "/config",
    );

    expect(res.body).not.toHaveProperty("agentRegistrationEnabled");
    expect(res.body).not.toHaveProperty("mongodbUri");
    expect(res.body).not.toHaveProperty("jwtSecret");
    expect(res.body).not.toHaveProperty("port");
    expect(res.body).not.toHaveProperty("challengeTtlMs");
    expect(res.body).not.toHaveProperty("sessionTtlMs");
  });

  it("/health responds", async () => {
    const res = await cliFetch(server.baseUrl, "GET", "/health");
    expect(res.status).toBe(200);
  });
});
