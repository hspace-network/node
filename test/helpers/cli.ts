import type { TestWallet } from "./wallet.js";

export interface CliResponse<T = unknown> {
  status: number;
  body: T;
}

export interface CliOptions {
  token?: string;
  body?: unknown;
}

export async function cliFetch<T = unknown>(
  baseUrl: string,
  method: string,
  path: string,
  options: CliOptions = {},
): Promise<CliResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }

  return { status: res.status, body: body as T };
}

export interface RegisterResult {
  ok: boolean;
  agent: { name: string; address: string; score: number; createdAt: string };
}

export async function registerAgent(
  baseUrl: string,
  wallet: TestWallet,
  name: string,
): Promise<CliResponse<RegisterResult>> {
  const challenge = await cliFetch<{ message: string; nonce: string }>(
    baseUrl,
    "POST",
    "/agents/challenge",
    { body: { name, address: wallet.address } },
  );
  if (challenge.status !== 200) {
    return challenge as unknown as CliResponse<RegisterResult>;
  }

  const signature = await wallet.sign(challenge.body.message);

  return cliFetch<RegisterResult>(baseUrl, "POST", "/agents/register", {
    body: {
      name,
      address: wallet.address,
      nonce: challenge.body.nonce,
      signature,
    },
  });
}

export interface SignInResult {
  token: string;
  expiresAt: number;
  agent: { name: string; address: string; score: number };
}

export async function signIn(
  baseUrl: string,
  wallet: TestWallet,
): Promise<CliResponse<SignInResult>> {
  const challenge = await cliFetch<{ message: string; nonce: string }>(
    baseUrl,
    "POST",
    "/auth/challenge",
    { body: { address: wallet.address } },
  );
  if (challenge.status !== 200) {
    return challenge as unknown as CliResponse<SignInResult>;
  }

  const signature = await wallet.sign(challenge.body.message);

  return cliFetch<SignInResult>(baseUrl, "POST", "/auth/verify", {
    body: {
      address: wallet.address,
      nonce: challenge.body.nonce,
      signature,
    },
  });
}

export async function registerAndSignIn(
  baseUrl: string,
  wallet: TestWallet,
  name: string,
): Promise<{ token: string; expiresAt: number }> {
  const reg = await registerAgent(baseUrl, wallet, name);
  if (reg.status !== 200) {
    throw new Error(
      `Failed to register agent ${name}: ${reg.status} ${JSON.stringify(reg.body)}`,
    );
  }
  const session = await signIn(baseUrl, wallet);
  if (session.status !== 200) {
    throw new Error(
      `Failed to sign in for ${name}: ${session.status} ${JSON.stringify(session.body)}`,
    );
  }
  return { token: session.body.token, expiresAt: session.body.expiresAt };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
