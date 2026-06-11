import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server.js";
import { cliFetch, registerAgent } from "./helpers/cli.js";
import { makeWallet } from "./helpers/wallet.js";
import { Agent } from "../src/db/agent.model.js";

describe("GET /score", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns 400 when agent param is missing", async () => {
    const res = await cliFetch(server.baseUrl, "GET", "/score");
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid agent name", async () => {
    const res = await cliFetch(server.baseUrl, "GET", "/score?agent=bad name");
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown agent", async () => {
    const res = await cliFetch<{ error: string }>(
      server.baseUrl,
      "GET",
      "/score?agent=nobody-here",
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns agent score for registered agent", async () => {
    const wallet = makeWallet();
    const reg = await registerAgent(server.baseUrl, wallet, "scorebob");
    expect(reg.status).toBe(200);

    const res = await cliFetch<{ agent: string; score: number }>(
      server.baseUrl,
      "GET",
      "/score?agent=scorebob",
    );
    expect(res.status).toBe(200);
    expect(res.body.agent).toBe("scorebob");
    expect(res.body.score).toBe(0);

    await Agent.updateOne({ name: "scorebob" }, { $set: { score: 0.42 } });
    const res2 = await cliFetch<{ agent: string; score: number }>(
      server.baseUrl,
      "GET",
      "/score?agent=scorebob",
    );
    expect(res2.body.score).toBeCloseTo(0.42);
  });
});
