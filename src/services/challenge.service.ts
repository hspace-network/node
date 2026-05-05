import { randomUUID } from "node:crypto";
import { recoverMessageAddress } from "viem";
import { config } from "../config.js";

export type ChallengePurpose = "register" | "signin";

interface ChallengeEntry {
  purpose: ChallengePurpose;
  address: string;
  name?: string;
  message: string;
  expiresAt: number;
}

const challenges = new Map<string, ChallengeEntry>();

function sweep(): void {
  const now = Date.now();
  for (const [nonce, entry] of challenges) {
    if (entry.expiresAt <= now) challenges.delete(nonce);
  }
}

function buildMessage(args: {
  purpose: ChallengePurpose;
  address: string;
  name?: string;
  nonce: string;
  issued: string;
  expires: string;
}): string {
  const heading =
    args.purpose === "register" ? "hspace agent registration" : "hspace sign-in";
  const lines = [heading, "", `Address: ${args.address}`];
  if (args.purpose === "register" && args.name) {
    lines.push(`Name: ${args.name}`);
  }
  lines.push(
    `Nonce: ${args.nonce}`,
    `Issued At: ${args.issued}`,
    `Expiration Time: ${args.expires}`,
  );
  return lines.join("\n");
}

export class ChallengeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface Challenge {
  message: string;
  nonce: string;
}

export function createChallenge(args: {
  purpose: ChallengePurpose;
  address: string;
  name?: string;
}): Challenge {
  sweep();
  const nonce = randomUUID();
  const lowerAddress = args.address.toLowerCase();
  const issuedDate = new Date();
  const expiresDate = new Date(issuedDate.getTime() + config.challengeTtlMs);
  const message = buildMessage({
    purpose: args.purpose,
    address: lowerAddress,
    name: args.name,
    nonce,
    issued: issuedDate.toISOString(),
    expires: expiresDate.toISOString(),
  });

  challenges.set(nonce, {
    purpose: args.purpose,
    address: lowerAddress,
    name: args.name,
    message,
    expiresAt: expiresDate.getTime(),
  });

  return { message, nonce };
}

export async function verifyAndConsume(args: {
  nonce: string;
  signature: `0x${string}`;
  expectPurpose: ChallengePurpose;
  expectAddress: string;
  expectName?: string;
}): Promise<{ address: string; name?: string }> {
  sweep();
  const entry = challenges.get(args.nonce);
  if (!entry) {
    throw new ChallengeError("Challenge not found or expired. Please retry.", 400);
  }

  if (entry.purpose !== args.expectPurpose) {
    challenges.delete(args.nonce);
    throw new ChallengeError("Challenge purpose mismatch.", 400);
  }

  const claimed = args.expectAddress.toLowerCase();
  if (entry.address !== claimed) {
    throw new ChallengeError("Challenge does not match the provided address.", 400);
  }
  if (args.expectName !== undefined && entry.name !== args.expectName) {
    throw new ChallengeError("Challenge does not match the provided agent name.", 400);
  }

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: entry.message,
      signature: args.signature,
    });
  } catch {
    throw new ChallengeError("Invalid signature.", 401);
  }

  if (recovered.toLowerCase() !== claimed) {
    throw new ChallengeError("Signature does not match the provided address.", 401);
  }

  challenges.delete(args.nonce);
  return { address: claimed, name: entry.name };
}

export function __resetChallenges(): void {
  challenges.clear();
}
