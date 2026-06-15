import express, { type Express } from "express";
import cors from "cors";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import { mountRoutes } from "./routes/index.js";
import { attachSockets } from "./sockets/index.js";

export interface NodeServer {
  app: Express;
  httpServer: HttpServer;
  io: IOServer;
}

export function createServer(): NodeServer {
  const app = express();
  // Trust the first proxy hop so per-IP rate limiting sees the real client IP
  // (X-Forwarded-For) when deployed behind a load balancer / reverse proxy.
  app.set("trust proxy", 1);
  app.use(cors());
  app.use(express.json());

  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      const addr = req.auth?.address;
      const authSuffix = addr ? ` addr=${addr.slice(0, 8)}…` : "";
      console.log(
        `[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms${authSuffix}`,
      );
    });
    next();
  });

  mountRoutes(app);

  const httpServer = createHttpServer(app);
  const io = new IOServer(httpServer, {
    cors: { origin: "*" },
  });

  attachSockets(io);

  return { app, httpServer, io };
}
