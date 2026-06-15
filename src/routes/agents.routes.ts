import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { Agent } from "../db/agent.model.js";
import {
  createChallenge,
  verifyAndConsume,
  ChallengeError,
} from "../services/challenge.service.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  listRunsForAddress,
  listRoomsForAgent,
  removeRun,
} from "../services/runs.service.js";
import { sponsorGasForAddress, type SponsorResult } from "../services/onboarding.service.js";
import { rateLimit } from "../middleware/rateLimit.js";

const NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const NAME_MAX_LENGTH = 64;

const REGISTRATION_DISABLED = "Agent registration is currently disabled on this node.";

const registrationLimiter = rateLimit({ windowMs: 60_000, max: 10, name: "registration" });

function isValidName(name: string): boolean {
  return name.length > 0 && name.length <= NAME_MAX_LENGTH && NAME_REGEX.test(name);
}

export const agentsRouter: Router = Router();

agentsRouter.post("/agents/challenge", registrationLimiter, async (req: Request, res: Response) => {
  if (!config.agentRegistrationEnabled) {
    return res.status(403).json({ error: REGISTRATION_DISABLED });
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";

  if (!isValidName(name)) {
    return res.status(400).json({
      error:
        "Invalid agent name. Use letters, digits, and hyphens (must start with a letter or digit, max 64 chars).",
    });
  }
  if (!ADDRESS_REGEX.test(address)) {
    return res.status(400).json({ error: "Invalid wallet address." });
  }

  const lowerAddress = address.toLowerCase();
  const existing = await Agent.findOne({
    $or: [{ name }, { address: lowerAddress }],
  }).lean();
  if (existing) {
    if (existing.name === name) {
      return res.status(409).json({ error: `Agent name "${name}" is already taken.` });
    }
    return res.status(409).json({ error: "An agent with that wallet address already exists." });
  }

  const challenge = createChallenge({ purpose: "register", address: lowerAddress, name });
  return res.json(challenge);
});

agentsRouter.post("/agents/register", registrationLimiter, async (req: Request, res: Response) => {
  if (!config.agentRegistrationEnabled) {
    return res.status(403).json({ error: REGISTRATION_DISABLED });
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const address = typeof req.body?.address === "string" ? req.body.address.trim() : "";
  const nonce = typeof req.body?.nonce === "string" ? req.body.nonce : "";
  const signature = typeof req.body?.signature === "string" ? req.body.signature : "";

  if (!isValidName(name) || !ADDRESS_REGEX.test(address) || !nonce || !signature) {
    return res.status(400).json({ error: "Missing or invalid registration fields." });
  }

  try {
    await verifyAndConsume({
      nonce,
      signature: signature as `0x${string}`,
      expectPurpose: "register",
      expectAddress: address,
      expectName: name,
    });
  } catch (err) {
    if (err instanceof ChallengeError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "Registration verification failed." });
  }

  const lowerAddress = address.toLowerCase();
  const collision = await Agent.findOne({
    $or: [{ name }, { address: lowerAddress }],
  }).lean();
  if (collision) {
    if (collision.name === name) {
      return res.status(409).json({ error: `Agent name "${name}" is already taken.` });
    }
    return res.status(409).json({ error: "An agent with that wallet address already exists." });
  }

  let agent;
  try {
    agent = await Agent.create({ name, address: lowerAddress });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 11000) {
      return res.status(409).json({ error: "Agent already registered." });
    }
    return res.status(500).json({ error: "Failed to persist agent." });
  }

  console.log(`[agents] registered "${agent.name}" ${agent.address}`);

  let sponsorship: SponsorResult | undefined;
  if (config.gasSponsorEnabled) {
    try {
      sponsorship = await sponsorGasForAddress(lowerAddress);
    } catch (err) {
      console.error(`[agents] sponsor error: ${(err as Error).message}`);
    }
  }

  return res.json({
    ok: true,
    agent: {
      name: agent.name,
      address: agent.address,
      score: agent.score,
      createdAt: (agent as unknown as { createdAt: Date }).createdAt,
    },
    sponsorship:
      sponsorship?.sponsored && sponsorship.txHash
        ? {
            txHash: sponsorship.txHash,
            amountMnt: sponsorship.amountMnt,
            chain: sponsorship.chain,
          }
        : undefined,
  });
});

agentsRouter.get("/agents/me", requireAuth, async (req: Request, res: Response) => {
  const address = req.auth!.address;
  const agents = await Agent.find({ address }).lean();
  return res.json({
    agents: agents.map((a) => ({
      name: a.name,
      address: a.address,
      score: a.score ?? 0,
      createdAt: (a as unknown as { createdAt: Date }).createdAt,
    })),
  });
});

agentsRouter.get(
  "/agents/me/runs",
  requireAuth,
  async (req: Request, res: Response) => {
    const address = req.auth!.address;
    try {
      const runs = await listRunsForAddress(address);
      return res.json({ runs });
    } catch (err) {
      console.error(`[agents] failed to read runs: ${(err as Error).message}`);
      return res.status(500).json({ error: "Failed to read runs." });
    }
  },
);

function agentJson(agent: {
  name: string;
  address: string;
  score?: number | null;
  spendingCapUsd?: number | null;
  createdAt?: Date;
}) {
  return {
    name: agent.name,
    address: agent.address,
    score: agent.score ?? 0,
    spendingCapUsd: agent.spendingCapUsd ?? 0,
    createdAt: agent.createdAt,
  };
}

agentsRouter.patch("/agents/:name", requireAuth, async (req: Request, res: Response) => {
  const address = req.auth!.address;
  const currentName = req.params.name;

  const newName =
    typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
  const capRaw = req.body?.spendingCapUsd;
  const hasCap = capRaw !== undefined && capRaw !== null;

  if (newName === undefined && !hasCap) {
    return res.status(400).json({
      error: "Nothing to update. Provide 'name' and/or 'spendingCapUsd'.",
    });
  }

  if (newName !== undefined && !isValidName(newName)) {
    return res.status(400).json({
      error:
        "Invalid agent name. Use letters, digits, and hyphens (must start with a letter or digit, max 64 chars).",
    });
  }

  if (hasCap) {
    const cap = Number(capRaw);
    if (!Number.isFinite(cap) || cap < 0) {
      return res.status(400).json({ error: "spendingCapUsd must be a non-negative number." });
    }
  }

  const agent = await Agent.findOne({ name: currentName, address });
  if (!agent) {
    return res.status(404).json({ error: `Agent "${currentName}" not found.` });
  }

  if (newName !== undefined && newName !== currentName) {
    const collision = await Agent.findOne({ name: newName }).lean();
    if (collision) {
      return res.status(409).json({ error: `Agent name "${newName}" is already taken.` });
    }
    const oldName = agent.name;
    agent.name = newName;
    console.log(`[agents] renamed "${oldName}" -> "${newName}" (${address})`);
  }

  if (hasCap) {
    agent.spendingCapUsd = Number(capRaw);
    console.log(
      `[agents] cap "${agent.name}" spendingCapUsd=${agent.spendingCapUsd} (${address})`,
    );
  }

  try {
    await agent.save();
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 11000) {
      return res.status(409).json({ error: "Agent name already taken." });
    }
    return res.status(500).json({ error: "Failed to update agent." });
  }

  return res.json(agentJson(agent));
});

agentsRouter.delete("/agents/:name", requireAuth, async (req: Request, res: Response) => {
  const address = req.auth!.address;
  const name = String(req.params.name);

  const agent = await Agent.findOne({ name, address });
  if (!agent) {
    return res.status(404).json({ error: `Agent "${name}" not found.` });
  }

  try {
    const rooms = await listRoomsForAgent(address, name);
    for (const roomId of rooms) {
      await removeRun(address, name, roomId);
    }
  } catch (err) {
    console.error(
      `[agents] failed to clear runs for ${name}: ${(err as Error).message}`,
    );
  }

  await agent.deleteOne();
  console.log(`[agents] deleted "${name}" (${address})`);

  return res.json({ ok: true });
});
