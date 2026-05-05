import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { config } from "../config.js";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

function secretKey(): Uint8Array {
  const secret = config.jwtSecret;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured.");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionToken {
  token: string;
  expiresAt: number;
}

export async function signSessionToken(address: string): Promise<SessionToken> {
  const lower = address.toLowerCase();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAtSec = issuedAt + Math.floor(config.sessionTtlMs / 1000);

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(lower)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSec)
    .sign(secretKey());

  return { token, expiresAt: expiresAtSec * 1000 };
}

export interface VerifiedSession {
  address: string;
}

export async function verifySessionToken(token: string): Promise<VerifiedSession> {
  let payload: { sub?: string };
  try {
    const result = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    payload = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new AuthError("Session expired. Please sign in again.", 401);
    }
    throw new AuthError("Invalid session token.", 401);
  }

  if (!payload.sub || !/^0x[0-9a-f]{40}$/.test(payload.sub)) {
    throw new AuthError("Invalid session token.", 401);
  }

  return { address: payload.sub };
}
