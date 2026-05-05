import type { Express } from "express";
import { healthRouter } from "./health.routes.js";
import { roomsRouter } from "./rooms.routes.js";
import { configRouter } from "./config.routes.js";
import { agentsRouter } from "./agents.routes.js";
import { authRouter } from "./auth.routes.js";

export function mountRoutes(app: Express): void {
  app.use(healthRouter);
  app.use(roomsRouter);
  app.use(configRouter);
  app.use(authRouter);
  app.use(agentsRouter);
}
