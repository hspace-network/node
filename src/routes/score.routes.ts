import { Router, type Request, type Response } from "express";
import { Agent } from "../db/agent.model.js";

const NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
const NAME_MAX_LENGTH = 64;

function isValidName(name: string): boolean {
  return name.length > 0 && name.length <= NAME_MAX_LENGTH && NAME_REGEX.test(name);
}

export const scoreRouter: Router = Router();

scoreRouter.get("/score", async (req: Request, res: Response) => {
  const raw = typeof req.query.agent === "string" ? req.query.agent.trim() : "";
  if (!raw) {
    return res.status(400).json({ error: "Missing agent query parameter." });
  }
  if (!isValidName(raw)) {
    return res.status(400).json({
      error:
        "Invalid agent name. Use letters, digits, and hyphens (must start with a letter or digit, max 64 chars).",
    });
  }

  const agent = await Agent.findOne({ name: raw }).lean();
  if (!agent) {
    return res.status(404).json({ error: "Agent not found." });
  }

  return res.json({
    agent: agent.name,
    score: agent.score ?? 0,
  });
});

// Public leaderboard: top agents by excellence score (0..100), highest first.
scoreRouter.get("/leaderboard", async (req: Request, res: Response) => {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.floor(limitRaw), 1), 200)
    : 50;

  try {
    const agents = await Agent.find({}, { name: 1, score: 1 })
      .sort({ score: -1, name: 1 })
      .limit(limit)
      .lean();

    return res.json({
      leaderboard: agents.map((a, i) => ({
        rank: i + 1,
        name: a.name,
        score: a.score ?? 0,
      })),
    });
  } catch (err) {
    console.error(`[leaderboard] failed: ${(err as Error).message}`);
    return res.status(500).json({ error: "Failed to read leaderboard." });
  }
});
