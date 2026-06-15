import { Router, type Request, type Response } from "express";
import { getFloorSnapshot } from "../services/floor.service.js";

export const floorRouter: Router = Router();

floorRouter.get("/floor", async (_req: Request, res: Response) => {
  try {
    const snapshot = await getFloorSnapshot();
    res.json(snapshot);
  } catch (err) {
    console.error(`[floor] snapshot failed: ${(err as Error).message}`);
    res.status(500).json({ error: "Failed to read floor." });
  }
});
