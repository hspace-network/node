import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { decodeJwt, SignJWT } from "jose";
import { startTestServer, type TestServer } from "./helpers/server.js";
import {
  cliFetch,
  registerAgent,
  signIn,
  registerAndSignIn,
  sleep,
} from "./helpers/cli.js";
import { makeWallet } from "./helpers/wallet.js";

describe("Auth challenge + verify + token", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe("/auth/challenge", () => {
    it("rejects an invalid address", async () => {
      const res = await cliFetch(server.baseUrl, "POST", "/auth/challenge", {
        body: { address: "not-an-address" },
      });
      expect(res.status).toBe(400);
    });

    it("rejects a missing address", async () => {
      const res = await cliFetch(server.baseUrl, "POST", "/auth/challenge", {
        body: {},
      });
      expect(res.status).toBe(400);
    });

    it("issues a challenge for a valid address even if no agent exists", async () => {
      const wallet = makeWallet();
      const res = await cliFetch<{ message: string; nonce: string }>(
        server.baseUrl,
        "POST",
        "/auth/challenge",
        { body: { address: wallet.address } },
      );
      expect(res.status).toBe(200);
      expect(res.body.nonce).toBeTruthy();
      expect(res.body.message).toContain("hspace sign-in");
    });
  });

  describe("/auth/verify", () => {
    it("issues a JWT after a successful challenge -> sign -> verify", async () => {
      const wallet = makeWallet();
      const reg = await registerAgent(server.baseUrl, wallet, "alice");
      expect(reg.status).toBe(200);

      const session = await signIn(server.baseUrl, wallet);
      expect(session.status).toBe(200);
      expect(session.body.token).toBeTruthy();

      const decoded = decodeJwt(session.body.token);
      expect(decoded.sub).toBe(wallet.address.toLowerCase());
      expect(typeof decoded.exp).toBe("number");
    });

    it("returns 404 when signing in for an address with no agent", async () => {
      const wallet = makeWallet();
      const res = await signIn(server.baseUrl, wallet);
      expect(res.status).toBe(404);
    });

    it("rejects a forged signature", async () => {
      const claimant = makeWallet();
      const attacker = makeWallet();
      await registerAgent(server.baseUrl, claimant, "alice");

      const challenge = await cliFetch<{ message: string; nonce: string }>(
        server.baseUrl,
        "POST",
        "/auth/challenge",
        { body: { address: claimant.address } },
      );
      const signature = await attacker.sign(challenge.body.message);
      const res = await cliFetch(server.baseUrl, "POST", "/auth/verify", {
        body: {
          address: claimant.address,
          nonce: challenge.body.nonce,
          signature,
        },
      });
      expect(res.status).toBe(401);
    });

    it("rejects nonce reuse", async () => {
      const wallet = makeWallet();
      await registerAgent(server.baseUrl, wallet, "alice");

      const challenge = await cliFetch<{ message: string; nonce: string }>(
        server.baseUrl,
        "POST",
        "/auth/challenge",
        { body: { address: wallet.address } },
      );
      const signature = await wallet.sign(challenge.body.message);
      const body = {
        address: wallet.address,
        nonce: challenge.body.nonce,
        signature,
      };

      const first = await cliFetch(server.baseUrl, "POST", "/auth/verify", { body });
      expect(first.status).toBe(200);

      const replay = await cliFetch(server.baseUrl, "POST", "/auth/verify", { body });
      expect(replay.status).toBe(400);
    });

    it("rejects an expired challenge nonce", async () => {
      const wallet = makeWallet();
      await registerAgent(server.baseUrl, wallet, "alice");

      const challenge = await cliFetch<{ message: string; nonce: string }>(
        server.baseUrl,
        "POST",
        "/auth/challenge",
        { body: { address: wallet.address } },
      );

      const ttl = Number(process.env.CHALLENGE_TTL_MS ?? 0);
      expect(ttl).toBeGreaterThan(0);
      await sleep(ttl + 250);

      const signature = await wallet.sign(challenge.body.message);
      const res = await cliFetch(server.baseUrl, "POST", "/auth/verify", {
        body: {
          address: wallet.address,
          nonce: challenge.body.nonce,
          signature,
        },
      });
      expect(res.status).toBe(400);
    });

    it("rejects a sign-in challenge attempted as a register-purpose verify", async () => {
      const wallet = makeWallet();
      await registerAgent(server.baseUrl, wallet, "alice");

      const challenge = await cliFetch<{ message: string; nonce: string }>(
        server.baseUrl,
        "POST",
        "/auth/challenge",
        { body: { address: wallet.address } },
      );
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
  });

  describe("Bearer token middleware", () => {
    it("rejects requests with no Authorization header", async () => {
      const res = await cliFetch(server.baseUrl, "GET", "/agents/me");
      expect(res.status).toBe(401);
    });

    it("rejects malformed Bearer headers", async () => {
      const res = await cliFetch(server.baseUrl, "GET", "/agents/me", {
        token: "",
      });
      expect(res.status).toBe(401);
    });

    it("rejects gibberish tokens", async () => {
      const res = await cliFetch(server.baseUrl, "GET", "/agents/me", {
        token: "definitely-not-a-jwt",
      });
      expect(res.status).toBe(401);
    });

    it("rejects tokens signed with a different secret", async () => {
      const wallet = makeWallet();
      await registerAgent(server.baseUrl, wallet, "alice");

      const wrongSecret = new TextEncoder().encode("wrong-secret-wrong-secret-wrong");
      const forged = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(wallet.address.toLowerCase())
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(wrongSecret);

      const res = await cliFetch(server.baseUrl, "GET", "/agents/me", {
        token: forged,
      });
      expect(res.status).toBe(401);
    });

    it("rejects expired tokens after SESSION_TTL_MS", async () => {
      const wallet = makeWallet();
      const { token } = await registerAndSignIn(server.baseUrl, wallet, "alice");

      const ttl = Number(process.env.SESSION_TTL_MS ?? 0);
      expect(ttl).toBeGreaterThan(0);
      await sleep(ttl + 1500);

      const res = await cliFetch(server.baseUrl, "GET", "/agents/me", { token });
      expect(res.status).toBe(401);
    });

    it("accepts a freshly issued valid token", async () => {
      const wallet = makeWallet();
      const { token } = await registerAndSignIn(server.baseUrl, wallet, "alice");

      const res = await cliFetch(server.baseUrl, "GET", "/agents/me", { token });
      expect(res.status).toBe(200);
    });
  });
});
