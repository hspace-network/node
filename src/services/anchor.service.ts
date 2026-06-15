import { keccak256, encodeAbiParameters, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { mantle } from "viem/chains";
import { config } from "../config.js";
import { AnchorPending } from "../db/anchor-pending.model.js";
import { AnchorHour } from "../db/anchor-hour.model.js";
import { DiscussionSession } from "../db/discussion-session.model.js";
import { Vote } from "../db/vote.model.js";

const ANCHOR_ABI = [
  {
    type: "function",
    name: "anchorHour",
    inputs: [
      { name: "hourBucket", type: "bytes32" },
      { name: "root", type: "bytes32" },
      { name: "count", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

function hashRationale(rationale: string): `0x${string}` {
  return keccak256(toBytes(rationale));
}

function voteLeaf(
  sessionId: string,
  agentName: string,
  way: string,
  sizeUsd: number,
  rationale: string,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [sessionId, agentName, way, BigInt(Math.round(sizeUsd * 1000)), hashRationale(rationale)],
    ),
  );
}

function merkleRoot(leaves: `0x${string}`[]): `0x${string}` {
  if (leaves.length === 0) {
    return keccak256(toBytes("empty"));
  }
  let layer = [...leaves].sort(cmpHex);
  while (layer.length > 1) {
    const next: `0x${string}`[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = i + 1 < layer.length ? layer[i + 1]! : left;
      next.push(hashPair(left, right));
    }
    layer = next;
  }
  return layer[0]!;
}

const cmpHex = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function hashPair(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      a < b ? [a, b] : [b, a],
    ),
  );
}

/**
 * Sorted-pair Merkle inclusion proof for `target` among `leaves`. Returns the
 * ordered sibling hashes a verifier folds into the root, or null if `target`
 * is not present. An empty array means `target` is itself the root.
 */
function merkleProof(
  leaves: `0x${string}`[],
  target: `0x${string}`,
): `0x${string}`[] | null {
  let layer = [...leaves].sort(cmpHex);
  let index = layer.indexOf(target);
  if (index < 0) return null;
  const proof: `0x${string}`[] = [];
  while (layer.length > 1) {
    const isRight = index % 2 === 1;
    const pairIndex = isRight ? index - 1 : index + 1;
    const sibling = pairIndex < layer.length ? layer[pairIndex]! : layer[index]!;
    proof.push(sibling);
    const next: `0x${string}`[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = i + 1 < layer.length ? layer[i + 1]! : left;
      next.push(hashPair(left, right));
    }
    index = Math.floor(index / 2);
    layer = next;
  }
  return proof;
}

/** Bind the vote Merkle root to the priced outcome of the session. */
function sessionRootFrom(
  voteRoot: `0x${string}`,
  move: string,
  p0: number,
  p1: number,
  sessionId: string,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "string" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "string" },
      ],
      [voteRoot, move, BigInt(Math.round(p0 * 1e8)), BigInt(Math.round(p1 * 1e8)), sessionId],
    ),
  );
}

export async function computeSessionRoot(sessionId: string): Promise<`0x${string}`> {
  const session = await DiscussionSession.findOne({ sessionId }).lean();
  const votes = await Vote.find({
    sessionId,
    phase: "final",
    responded: { $ne: false },
  }).lean();

  const leaves = votes.map((v) =>
    voteLeaf(
      sessionId,
      v.agentName,
      v.way,
      v.sizeUsd ?? 0,
      v.rationale ?? "",
    ),
  );

  const voteRoot = merkleRoot(leaves);
  const p0 = session?.priceP0 ?? 0;
  const p1 = session?.priceP1 ?? 0;
  const move = session?.priceMove ?? "flat";

  return sessionRootFrom(voteRoot, move, p0, p1, sessionId);
}

export async function queueSessionAnchor(
  sessionId: string,
  hourBucket: string,
): Promise<void> {
  if (!config.anchorEnabled) return;

  const session = await DiscussionSession.findOne({ sessionId }).lean();
  if (!session) return;

  const sessionRoot = await computeSessionRoot(sessionId);
  await AnchorPending.findOneAndUpdate(
    { sessionId },
    {
      sessionId,
      roomId: session.roomId,
      closedAt: session.closedAt ?? new Date(),
      hourBucket,
      sessionRoot,
      anchored: false,
      txHash: null,
    },
    { upsert: true },
  );
  console.log(
    `[anchor] queued session=${sessionId} hour=${hourBucket} root=${sessionRoot.slice(0, 18)}…`,
  );
}

function hourBucketToBytes32(hourBucket: string): `0x${string}` {
  return keccak256(toBytes(hourBucket));
}

export async function anchorHourBucket(hourBucket: string): Promise<void> {
  if (!config.anchorEnabled) return;
  if (!config.anchorPrivateKey || !config.anchorContractAddress) {
    console.warn("[anchor] skip: ANCHOR_PRIVATE_KEY or ANCHOR_CONTRACT_ADDRESS not set");
    return;
  }

  const pending = await AnchorPending.find({
    hourBucket,
    anchored: false,
  }).lean();
  if (pending.length === 0) return;

  const roots = pending
    .map((p) => p.sessionRoot as `0x${string}`)
    .sort();
  const hourlyRoot = merkleRoot(roots);
  const hourKey = hourBucketToBytes32(hourBucket);

  const account = privateKeyToAccount(config.anchorPrivateKey as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: mantle,
    transport: http(config.anchorRpcUrl),
  });

  let txHash: `0x${string}`;
  try {
    txHash = await client.writeContract({
      address: config.anchorContractAddress as `0x${string}`,
      abi: ANCHOR_ABI,
      functionName: "anchorHour",
      args: [hourKey, hourlyRoot, BigInt(pending.length)],
      chain: mantle,
    });
  } catch (err) {
    console.error(
      `[anchor] on-chain failed hour=${hourBucket}: ${(err as Error).message}`,
    );
    return;
  }

  await AnchorPending.updateMany(
    { hourBucket, anchored: false },
    { $set: { anchored: true, txHash } },
  );
  await AnchorHour.findOneAndUpdate(
    { hourBucket },
    {
      hourBucket,
      hourlyRoot,
      sessionCount: pending.length,
      txHash,
      anchoredAt: new Date(),
    },
    { upsert: true },
  );

  console.log(
    `[anchor] anchored hour=${hourBucket} sessions=${pending.length} tx=${txHash}`,
  );
}

export async function getAnchorHour(hourBucket: string) {
  const hour = await AnchorHour.findOne({ hourBucket }).lean();
  const sessions = await AnchorPending.find({ hourBucket }).lean();
  return { hour, sessions };
}

export interface VerificationVote {
  agentName: string;
  way: string;
  sizeUsd: number;
  rationale: string;
}

export interface SessionVerification {
  sessionId: string;
  roomId: string;
  priceP0: number;
  priceP1: number;
  priceMove: string;
  votes: VerificationVote[];
  voteRoot: `0x${string}`;
  sessionRoot: `0x${string}`;
  hourBucket: string | null;
  hourlyRoot: string | null;
  /** Sorted-pair Merkle proof from sessionRoot up to hourlyRoot. */
  proof: `0x${string}`[];
  anchored: boolean;
  txHash: string | null;
  sessionCount: number;
  contractAddress: string | null;
  chainId: number;
  explorerTxUrl: string | null;
}

/**
 * Everything a third party needs to independently verify a session: the raw
 * vote inputs (to recompute the leaf hashes), the Merkle proof up to the hourly
 * root, and the on-chain pointers (contract + tx) to confirm that root was
 * actually anchored on Mantle. Returns null when the session is unknown.
 */
export async function getSessionVerification(
  sessionId: string,
): Promise<SessionVerification | null> {
  const session = await DiscussionSession.findOne({ sessionId }).lean();
  if (!session) return null;

  const voteDocs = await Vote.find({
    sessionId,
    phase: "final",
    responded: { $ne: false },
  }).lean();

  const votes: VerificationVote[] = voteDocs.map((v) => ({
    agentName: v.agentName,
    way: v.way,
    sizeUsd: v.sizeUsd ?? 0,
    rationale: v.rationale ?? "",
  }));

  const leaves = votes.map((v) =>
    voteLeaf(sessionId, v.agentName, v.way, v.sizeUsd, v.rationale),
  );
  const voteRoot = merkleRoot(leaves);
  const p0 = session.priceP0 ?? 0;
  const p1 = session.priceP1 ?? 0;
  const move = session.priceMove ?? "flat";
  const sessionRoot = sessionRootFrom(voteRoot, move, p0, p1, sessionId);

  const pending = await AnchorPending.findOne({ sessionId }).lean();
  let hourBucket: string | null = null;
  let hourlyRoot: string | null = null;
  let proof: `0x${string}`[] = [];
  let anchored = false;
  let txHash: string | null = null;
  let sessionCount = 0;

  if (pending) {
    hourBucket = pending.hourBucket;
    anchored = !!pending.anchored;
    const hour = await AnchorHour.findOne({ hourBucket }).lean();
    hourlyRoot = hour?.hourlyRoot ?? null;
    txHash = hour?.txHash ?? pending.txHash ?? null;

    const all = await AnchorPending.find({ hourBucket }).lean();
    sessionCount = all.length;
    const roots = all
      .map((p) => p.sessionRoot as `0x${string}`)
      .sort(cmpHex);
    proof = merkleProof(roots, pending.sessionRoot as `0x${string}`) ?? [];
  }

  return {
    sessionId,
    roomId: session.roomId,
    priceP0: p0,
    priceP1: p1,
    priceMove: move,
    votes,
    voteRoot,
    sessionRoot,
    hourBucket,
    hourlyRoot,
    proof,
    anchored,
    txHash,
    sessionCount,
    contractAddress: config.anchorContractAddress || null,
    chainId: 5000,
    explorerTxUrl: txHash ? `https://explorer.mantle.xyz/tx/${txHash}` : null,
  };
}
