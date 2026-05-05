import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server.js";
import {
  cliFetch,
  registerAgent,
  sleep,
  type CliResponse,
} from "./helpers/cli.js";
import { makeWallet } from "./helpers/wallet.js";
import { Agent } from "../src/db/agent.model.js";

describe("POST /agents/challenge + /agents/register", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe("happy path", () => {
    it("registers a new agent end-to-end", async () => {
      const wallet = makeWallet();
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const res = await registerAgent(server.baseUrl, wallet, "alice");

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.agent.name).toBe("alice");
      expect(res.body.agent.address).toBe(wallet.address.toLowerCase());
      expect(res.body.agent.score).toBe(0);

      const doc = await Agent.findOne({ name: "alice" }).lean();
      expect(doc).not.toBeNull();
      expect(doc!.address).toBe(wallet.address.toLowerCase());
      expect(doc!.score).toBe(0);

      const logCalls = logSpy.mock.calls.map((args) => args.join(" "));
      expect(
        logCalls.some((line) => line.includes('[agents] registered "alice"')),
      ).toBe(true);

      logSpy.mockRestore();
    });
  });

  describe("/agents/challenge validation", () => {
    it("rejects an invalid name regex", async () => {
      const wallet = makeWallet();
      const res = await cliFetch(server.baseUrl, "POST", "/agents/challenge", {
        body: { name: "-bad-name", address: wallet.address },
      });
      expect(res.status).toBe(400);
    });

    it("rejects a name with spaces", async () => {
      const wallet = makeWallet();
      const res = await cliFetch(server.baseUrl, "POST", "/agents/challenge", {
        body: { name: "bad name", address: wallet.address },
      });
      expect(res.status).toBe(400);
    });

    it("rejects an empty name", async () => {
      const wallet = makeWallet();
      const res = await cliFetch(server.baseUrl, "POST", "/agents/challenge", {
        body: { name: "", address: wallet.address },
      });
      expect(res.status).toBe(400);
    });

    it("rejects an invalid address", async () => {
      const res = await cliFetch(server.baseUrl, "POST", "/agents/challenge", {
        body: { name: "alice", address: "0xnope" },
      });
      expect(res.status).toBe(400);
    });

    it("rejects a missing body", async () => {
      const res = await cliFetch(server.baseUrl, "POST", "/agents/challenge", {});
      expect(res.status).toBe(400);
    });

    it("returns 409 when name is already taken", async () => {
      const w1 = makeWallet();
      const w2 = makeWallet();
      await registerAgent(server.baseUrl, w1, "alice");

      const res = await cliFetch<{ error: string }>(
        server.baseUrl,
        "POST",
        "/agents/challenge",
        { body: { name: "alice", address: w2.address } },
      );
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("alice");
    });

    it("returns 409 when address is already taken", async () => {
      const wallet = makeWallet();
      await registerAgent(server.baseUrl, wallet, "alice");

      const res = await cliFetch<{ error: string }>(
        server.baseUrl,
        "POST",
        "/agents/challenge",
        { body: { name: "bob", address: wallet.address } },
      );
      expect(res.status).toBe(409);
      expect(res.body.error.toLowerCase()).toContain("address");
    });
  });

  describe("/agents/register signature verification", () => {
    it("rejects a forged signature from a different wallet", async () => {
      const claimant = makeWallet();
      const attacker = makeWallet();

      const challenge = await cliFetch<{ message: string; nonce: string }>(
        server.baseUrl,
        "POST",
        "/agents/challenge",
        { body: { name: "alice", address: claimant.address } },
      );
      expect(challenge.status).toBe(200);

      const signature = await attacker.sign(challenge.body.message);

      const res = await cliFetch(server.baseUrl, "POST", "/agents/register", {
        body: {
          name: "alice",
          address: claimant.address,
          nonce: challenge.body.nonce,
          signature,
        },
      });
      expect(res.status).toBe(401);

      const doc = await Agent.findOne({ name: "alice" }).lean();
      expect(doc).toBeNull();
    });

    it("rejects a syntactically invalid signature", async () => {
      const wallet = makeWallet();
      const challenge = await cliFetch<{ message: string; nonce: string }>(
        server.baseUrl,
        "POST",
        "/agents/challenge",
        { body: { name: "alice", address: wallet.address } },
      );
      const res = await cliFetch(server.baseUrl, "POST", "/agents/register", {
        body: {
          name: "alice",
          address: wallet.address,
          nonce: challenge.body.nonce,
          signature: "0xdeadbeef",
        },
      });
      expect(res.status).toBe(401);
    });

    it("rejects a tampered name (claim X, signed Y)", async () => {
      const wallet = makeWallet();
      const challenge = await cliFetch<{ message: string; nonce: string }>(
        server.baseUrl,
        "POST",
        "/agents/challenge",
        { body: { name: "alice", address: wallet.address } },
      );
      const signature = await wallet.sign(challenge.body.message);

      const res = await cliFetch(server.baseUrl, "POST", "/agents/register", {
        body: {
          name: "bob",
          address: wallet.address,
          nonce: challenge.body.nonce,
          signature,
        },
      });
      expect(res.status).toBe(400);
    });

    it("rejects a replay of an already-consumed nonce", async () => {
      const wallet = makeWallet();

      const challenge = await cliFetch<{ message: string; nonce: string }>(
        server.baseUrl,
        "POST",
        "/agents/challenge",
        { body: { name: "alice", address: wallet.address } },
      );
      expect(challenge.status).toBe(200);

      const signature = await wallet.sign(challenge.body.message);
      const body = {
        name: "alice",
        address: wallet.address,
        nonce: challenge.body.nonce,
        signature,
      };

      const first = await cliFetch(server.baseUrl, "POST", "/agents/register", {
        body,
      });
      expect(first.status).toBe(200);

      const replay = await cliFetch(server.baseUrl, "POST", "/agents/register", {
        body,
      });
      expect(replay.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects an expired nonce after CHALLENGE_TTL_MS", async () => {
      const wallet = makeWallet();
      const challenge = await cliFetch<{ message: string; nonce: string }>(
        server.baseUrl,
        "POST",
        "/agents/challenge",
        { body: { name: "alice", address: wallet.address } },
      );

      const ttl = Number(process.env.CHALLENGE_TTL_MS ?? 0);
      expect(ttl).toBeGreaterThan(0);
      await sleep(ttl + 250);

      const signature = await wallet.sign(challenge.body.message);
      const res = await cliFetch(server.baseUrl, "POST", "/agents/register", {
        body: {
          name: "alice",
          address: wallet.address,
          nonce: challenge.body.nonce,
          signature,
        },
      });
      expect(res.status).toBe(400);
    });

    it("rejects an unknown nonce", async () => {
      const wallet = makeWallet();
      const signature = await wallet.sign("anything");
      const res = await cliFetch(server.baseUrl, "POST", "/agents/register", {
        body: {
          name: "alice",
          address: wallet.address,
          nonce: "00000000-0000-0000-0000-000000000000",
          signature,
        },
      });
      expect(res.status).toBe(400);
    });
  });

  describe("AGENT_REGISTRATION_ENABLED=false", () => {
    it("returns 403 on /agents/challenge", async () => {
      const original = process.env.AGENT_REGISTRATION_ENABLED;
      process.env.AGENT_REGISTRATION_ENABLED = "false";
      try {
        const wallet = makeWallet();
        const res = (await cliFetch(server.baseUrl, "POST", "/agents/challenge", {
          body: { name: "alice", address: wallet.address },
        })) as CliResponse<{ error: string }>;
        expect(res.status).toBe(403);
        expect(res.body.error.toLowerCase()).toContain("disabled");
      } finally {
        process.env.AGENT_REGISTRATION_ENABLED = original;
      }
    });

    it("returns 403 on /agents/register", async () => {
      const original = process.env.AGENT_REGISTRATION_ENABLED;
      process.env.AGENT_REGISTRATION_ENABLED = "false";
      try {
        const wallet = makeWallet();
        const res = await cliFetch(server.baseUrl, "POST", "/agents/register", {
          body: {
            name: "alice",
            address: wallet.address,
            nonce: "anything",
            signature: "0x" + "0".repeat(130),
          },
        });
        expect(res.status).toBe(403);
      } finally {
        process.env.AGENT_REGISTRATION_ENABLED = original;
      }
    });
  });
});
