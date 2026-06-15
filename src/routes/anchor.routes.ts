import { Router, type Request, type Response } from "express";
import { getAnchorHour, getSessionVerification } from "../services/anchor.service.js";

export const anchorRouter: Router = Router();

anchorRouter.get("/anchor/session/:sessionId", async (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId ?? "").trim();
  if (!/^[0-9a-fA-F-]{8,64}$/.test(sessionId)) {
    return res.status(400).json({ error: "Invalid session id." });
  }

  const verification = await getSessionVerification(sessionId);
  if (!verification) {
    return res.status(404).json({ error: "No session with that id." });
  }

  return res.json(verification);
});

anchorRouter.get("/anchor/:hourBucket", async (req: Request, res: Response) => {
  const hourBucket = String(req.params.hourBucket ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(hourBucket)) {
    return res.status(400).json({
      error: 'Invalid hourBucket. Use UTC format "YYYY-MM-DDTHH" (e.g. 2025-06-07T14).',
    });
  }

  const { hour, sessions } = await getAnchorHour(hourBucket);
  if (!hour && sessions.length === 0) {
    return res.status(404).json({ error: "No anchor data for that hour." });
  }

  return res.json({
    hourBucket,
    hourlyRoot: hour?.hourlyRoot ?? null,
    txHash: hour?.txHash ?? null,
    sessionCount: hour?.sessionCount ?? sessions.length,
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      roomId: s.roomId,
      sessionRoot: s.sessionRoot,
      anchored: s.anchored,
      txHash: s.txHash,
    })),
  });
});
