import { Router, type Request, type Response } from "express";
import { Agent } from "../db/agent.model.js";
import {
  createChallenge,
  verifyAndConsume,
  ChallengeError,
} from "../services/challenge.service.js";
import { signSessionToken } from "../services/auth.service.js";
import { rateLimit } from "../middleware/rateLimit.js";

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

const authLimiter = rateLimit({ windowMs: 60_000, max: 20, name: "auth" });

export const authRouter: Router = Router();

authRouter.post("/auth/challenge", authLimiter, (req: Request, res: Response) => {
  const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";
  if (!ADDRESS_REGEX.test(address)) {
    return res.status(400).json({ error: "Invalid wallet address." });
  }

  const challenge = createChallenge({ purpose: "signin", address });
  return res.json(challenge);
});

authRouter.post("/auth/verify", authLimiter, async (req: Request, res: Response) => {
  const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";
  const nonce = typeof req.body?.nonce === "string" ? req.body.nonce : "";
  const signature = typeof req.body?.signature === "string" ? req.body.signature : "";

  if (!ADDRESS_REGEX.test(address) || !nonce || !signature) {
    return res.status(400).json({ error: "Missing or invalid sign-in fields." });
  }

  try {
    await verifyAndConsume({
      nonce,
      signature: signature as `0x${string}`,
      expectPurpose: "signin",
      expectAddress: address,
    });
  } catch (err) {
    if (err instanceof ChallengeError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "Sign-in verification failed." });
  }

  const lowerAddress = address.toLowerCase();
  const agent = await Agent.findOne({ address: lowerAddress }).lean();
  if (!agent) {
    return res.status(404).json({
      error: 'No agent registered for this address. Run "create" first.',
    });
  }

  const session = await signSessionToken(lowerAddress);
  return res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    agent: {
      name: agent.name,
      address: agent.address,
      score: agent.score ?? 0,
    },
  });
});
