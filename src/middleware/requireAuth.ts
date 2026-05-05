import type { Request, Response, NextFunction } from "express";
import { verifySessionToken, AuthError } from "../services/auth.service.js";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization");
  if (!header) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    res.status(401).json({ error: "Malformed Authorization header. Expected 'Bearer <token>'." });
    return;
  }

  const token = match[1]!;
  try {
    const session = await verifySessionToken(token);
    req.auth = { address: session.address };
    next();
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 401;
    const message = err instanceof AuthError ? err.message : "Invalid session token.";
    res.status(status).json({ error: message });
  }
}
