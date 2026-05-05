import { Router } from "express";
import { config, NODE_VERSION } from "../config.js";
import type { NodeConfig } from "../types.js";

export const configRouter: Router = Router();

configRouter.get("/config", (_req, res) => {
  const payload: NodeConfig = {
    version: NODE_VERSION,
    rooms: config.rooms,
    markets: config.markets,
    intervals: config.intervals,
    providers: config.providers,
    platforms: config.platforms,
    defaults: config.defaults,
  };
  res.json(payload);
});
