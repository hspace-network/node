import { Router } from "express";
import { config } from "../config.js";

export const roomsRouter: Router = Router();

roomsRouter.get("/rooms", (_req, res) => {
  res.json(config.rooms);
});
