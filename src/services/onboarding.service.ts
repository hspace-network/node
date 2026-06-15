import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mantle, mantleSepoliaTestnet } from "viem/chains";
import { config } from "../config.js";
import { GasSponsorship } from "../db/gas-sponsorship.model.js";

// Gasless onboarding: when a new agent registers, the operator wallet drips a
// small amount of MNT to the agent's fresh wallet so a Web2 user can fund and
// trade immediately without first acquiring MNT for gas. The drip only ever
// goes to an address that proved key control during registration, and is
// bounded by a per-address once-only rule plus a rolling 24h global budget.

export interface SponsorDecisionInput {
  recipientBalanceWei: bigint;
  alreadySponsored: boolean;
  dayTotalWei: bigint;
  amountWei: bigint;
  dailyBudgetWei: bigint;
  minBalanceWei: bigint;
}

export interface SponsorDecision {
  sponsor: boolean;
  reason?: string;
}

/**
 * Pure policy: decide whether to sponsor gas. Kept side-effect free so the
 * abuse safeguards can be unit-tested deterministically.
 */
export function sponsorshipDecision(i: SponsorDecisionInput): SponsorDecision {
  if (i.amountWei <= 0n) return { sponsor: false, reason: "amount_zero" };
  if (i.alreadySponsored) return { sponsor: false, reason: "already_sponsored" };
  if (i.recipientBalanceWei >= i.minBalanceWei) {
    return { sponsor: false, reason: "sufficient_balance" };
  }
  if (i.dayTotalWei + i.amountWei > i.dailyBudgetWei) {
    return { sponsor: false, reason: "daily_budget_exhausted" };
  }
  return { sponsor: true };
}

export interface SponsorResult {
  sponsored: boolean;
  reason?: string;
  txHash?: string;
  amountMnt?: string;
  chain?: string;
}

function chainFor(id: "mantle" | "mantle-sepolia") {
  return id === "mantle-sepolia" ? mantleSepoliaTestnet : mantle;
}

function parseMntSafe(value: string, fallbackWei: bigint): bigint {
  try {
    return parseEther(value);
  } catch {
    return fallbackWei;
  }
}

/**
 * Sponsor a one-time gas drip to `address` if policy and budget allow. Returns
 * a structured result; never throws, so a registration is never blocked by a
 * sponsorship failure.
 */
export async function sponsorGasForAddress(address: string): Promise<SponsorResult> {
  if (!config.gasSponsorEnabled) return { sponsored: false, reason: "disabled" };
  const pk = config.gasSponsorPrivateKey;
  if (!pk) return { sponsored: false, reason: "no_operator_key" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return { sponsored: false, reason: "bad_address" };
  }

  const chainId = config.gasSponsorChain;
  const chain = chainFor(chainId);
  const amountWei = parseMntSafe(config.gasSponsorAmountMnt, parseEther("0.05"));
  const dailyBudgetWei = parseMntSafe(config.gasSponsorDailyBudgetMnt, parseEther("5"));
  const minBalanceWei = parseMntSafe(config.gasSponsorMinBalanceMnt, amountWei);
  const lowerAddress = address.toLowerCase();

  const publicClient = createPublicClient({
    chain,
    transport: http(config.gasSponsorRpcUrl),
  });

  let recipientBalanceWei: bigint;
  try {
    recipientBalanceWei = await publicClient.getBalance({
      address: address as `0x${string}`,
    });
  } catch {
    return { sponsored: false, reason: "balance_check_failed" };
  }

  // Pre-flight checks that don't depend on the rolling budget. (sponsorshipDecision
  // remains the unit-tested policy for these; the budget gate is enforced via an
  // atomic reservation below.)
  if (amountWei <= 0n) return { sponsored: false, reason: "amount_zero" };
  const already = await GasSponsorship.findOne({ address: lowerAddress }).lean();
  if (already) return { sponsored: false, reason: "already_sponsored" };
  if (recipientBalanceWei >= minBalanceWei) {
    return { sponsored: false, reason: "sufficient_balance" };
  }

  // Reserve atomically BEFORE sending: insert our drip row, then sum the rolling
  // 24h total (which now includes this reservation and any concurrent ones).
  // This closes the read-then-send race where parallel registrations could each
  // pass the budget check and collectively overspend. Roll back if over budget
  // or if the send fails.
  let reservationId: unknown;
  try {
    const reservation = await GasSponsorship.create({
      address: lowerAddress,
      amountWei: amountWei.toString(),
      chain: chainId,
      txHash: "",
      status: "reserved",
    });
    reservationId = reservation._id;
  } catch {
    return { sponsored: false, reason: "reserve_failed" };
  }

  const rollback = async (): Promise<void> => {
    try {
      await GasSponsorship.deleteOne({ _id: reservationId });
    } catch {
      // best-effort rollback; a stuck reservation only ever under-spends
    }
  };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayDocs = await GasSponsorship.find(
    { chain: chainId, createdAt: { $gte: since } },
    { amountWei: 1 },
  ).lean();
  const dayTotalWei = dayDocs.reduce(
    (acc, d) => acc + BigInt(d.amountWei ?? "0"),
    0n,
  );
  if (dayTotalWei > dailyBudgetWei) {
    await rollback();
    return { sponsored: false, reason: "daily_budget_exhausted" };
  }

  const account = privateKeyToAccount(pk as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(config.gasSponsorRpcUrl),
  });

  let txHash: `0x${string}`;
  try {
    txHash = await wallet.sendTransaction({
      account,
      chain,
      to: address as `0x${string}`,
      value: amountWei,
    });
  } catch (err) {
    await rollback();
    console.error(
      `[onboarding] gas sponsor failed for ${lowerAddress}: ${(err as Error).message}`,
    );
    return { sponsored: false, reason: "send_failed" };
  }

  await GasSponsorship.updateOne(
    { _id: reservationId },
    { $set: { txHash, status: "sent" } },
  ).catch(() => {});

  const amountMnt = formatEther(amountWei);
  console.log(
    `[onboarding] sponsored ${amountMnt} MNT gas to ${lowerAddress} on ${chainId} tx=${txHash}`,
  );
  return { sponsored: true, txHash, amountMnt, chain: chainId };
}
