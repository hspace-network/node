import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server.js";
import { cliFetch, registerAndSignIn } from "./helpers/cli.js";
import { makeWallet } from "./helpers/wallet.js";
import { Agent } from "../src/db/agent.model.js";

describe("Agent CRUD (authed)", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe("GET /agents/me", () => {
    it("returns only the caller's agents", async () => {
      const walletA = makeWallet();
      const walletB = makeWallet();
      const { token: tokenA } = await registerAndSignIn(server.baseUrl, walletA, "alice");
      await registerAndSignIn(server.baseUrl, walletB, "bob");

      const res = await cliFetch<{
        agents: { name: string; address: string }[];
      }>(server.baseUrl, "GET", "/agents/me", { token: tokenA });

      expect(res.status).toBe(200);
      expect(res.body.agents.length).toBe(1);
      expect(res.body.agents[0]!.name).toBe("alice");
      expect(res.body.agents[0]!.address).toBe(walletA.address.toLowerCase());
    });

    it("returns 401 when logged out", async () => {
      const res = await cliFetch(server.baseUrl, "GET", "/agents/me");
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /agents/:name", () => {
    it("renames the caller's own agent", async () => {
      const wallet = makeWallet();
      const { token } = await registerAndSignIn(server.baseUrl, wallet, "alice");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const res = await cliFetch<{ name: string; address: string }>(
        server.baseUrl,
        "PATCH",
        "/agents/alice",
        { token, body: { name: "alice2" } },
      );

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("alice2");

      const fresh = await Agent.findOne({ name: "alice2" }).lean();
      expect(fresh).not.toBeNull();
      const stale = await Agent.findOne({ name: "alice" }).lean();
      expect(stale).toBeNull();

      const logCalls = logSpy.mock.calls.map((args) => args.join(" "));
      expect(
        logCalls.some(
          (l) => l.includes('renamed "alice" -> "alice2"') && l.includes(wallet.address.toLowerCase()),
        ),
      ).toBe(true);

      logSpy.mockRestore();
    });

    it("is a no-op when the new name equals the current name", async () => {
      const wallet = makeWallet();
      const { token } = await registerAndSignIn(server.baseUrl, wallet, "alice");

      const res = await cliFetch<{ name: string }>(
        server.baseUrl,
        "PATCH",
        "/agents/alice",
        { token, body: { name: "alice" } },
      );
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("alice");
    });

    it("returns 400 on empty body", async () => {
      const wallet = makeWallet();
      const { token } = await registerAndSignIn(server.baseUrl, wallet, "alice");
      const res = await cliFetch(server.baseUrl, "PATCH", "/agents/alice", {
        token,
        body: {},
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 on an invalid new name", async () => {
      const wallet = makeWallet();
      const { token } = await registerAndSignIn(server.baseUrl, wallet, "alice");
      const res = await cliFetch(server.baseUrl, "PATCH", "/agents/alice", {
        token,
        body: { name: "-bad-" },
      });
      expect(res.status).toBe(400);
    });

    it("returns 409 when renaming to a name owned by another wallet", async () => {
      const walletA = makeWallet();
      const walletB = makeWallet();
      const { token: tokenA } = await registerAndSignIn(server.baseUrl, walletA, "alice");
      await registerAndSignIn(server.baseUrl, walletB, "bob");

      const res = await cliFetch(server.baseUrl, "PATCH", "/agents/alice", {
        token: tokenA,
        body: { name: "bob" },
      });
      expect(res.status).toBe(409);
    });

    it("returns 404 (not 403) when targeting another user's agent", async () => {
      const walletA = makeWallet();
      const walletB = makeWallet();
      await registerAndSignIn(server.baseUrl, walletA, "alice");
      const { token: tokenB } = await registerAndSignIn(server.baseUrl, walletB, "bob");

      const res = await cliFetch(server.baseUrl, "PATCH", "/agents/alice", {
        token: tokenB,
        body: { name: "alice2" },
      });
      expect(res.status).toBe(404);

      const stillThere = await Agent.findOne({ name: "alice" }).lean();
      expect(stillThere).not.toBeNull();
    });

    it("returns 401 when logged out", async () => {
      const wallet = makeWallet();
      await registerAndSignIn(server.baseUrl, wallet, "alice");

      const res = await cliFetch(server.baseUrl, "PATCH", "/agents/alice", {
        body: { name: "alice2" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 for a non-existent agent name", async () => {
      const wallet = makeWallet();
      const { token } = await registerAndSignIn(server.baseUrl, wallet, "alice");

      const res = await cliFetch(server.baseUrl, "PATCH", "/agents/ghost", {
        token,
        body: { name: "ghost2" },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /agents/:name", () => {
    it("deletes the caller's own agent", async () => {
      const wallet = makeWallet();
      const { token } = await registerAndSignIn(server.baseUrl, wallet, "alice");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const res = await cliFetch<{ ok: boolean }>(
        server.baseUrl,
        "DELETE",
        "/agents/alice",
        { token },
      );
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const doc = await Agent.findOne({ name: "alice" }).lean();
      expect(doc).toBeNull();

      const logCalls = logSpy.mock.calls.map((args) => args.join(" "));
      expect(
        logCalls.some(
          (l) => l.includes('deleted "alice"') && l.includes(wallet.address.toLowerCase()),
        ),
      ).toBe(true);

      logSpy.mockRestore();
    });

    it("returns 404 (not 403) when targeting another user's agent", async () => {
      const walletA = makeWallet();
      const walletB = makeWallet();
      await registerAndSignIn(server.baseUrl, walletA, "alice");
      const { token: tokenB } = await registerAndSignIn(server.baseUrl, walletB, "bob");

      const res = await cliFetch(server.baseUrl, "DELETE", "/agents/alice", {
        token: tokenB,
      });
      expect(res.status).toBe(404);

      const stillThere = await Agent.findOne({ name: "alice" }).lean();
      expect(stillThere).not.toBeNull();
    });

    it("returns 404 for a non-existent agent", async () => {
      const wallet = makeWallet();
      const { token } = await registerAndSignIn(server.baseUrl, wallet, "alice");

      const res = await cliFetch(server.baseUrl, "DELETE", "/agents/ghost", {
        token,
      });
      expect(res.status).toBe(404);
    });

    it("returns 401 when logged out", async () => {
      const wallet = makeWallet();
      await registerAndSignIn(server.baseUrl, wallet, "alice");

      const res = await cliFetch(server.baseUrl, "DELETE", "/agents/alice");
      expect(res.status).toBe(401);
    });
  });
});
