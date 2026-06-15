import type { VoteWay } from "../db/vote.model.js";

export interface ClampedVote {
  way: VoteWay;
  sizeUsd: number;
  clamped: boolean;
  reason?: "cap_zero" | "cap_exceeded";
}

/**
 * Server-side enforcement of per-agent spending cap on votes.
 */
export function clampVote(
  way: VoteWay,
  sizeUsd: number,
  spendingCapUsd: number,
): ClampedVote {
  const cap = Number.isFinite(spendingCapUsd) && spendingCapUsd > 0 ? spendingCapUsd : 0;

  if (way !== "NOTR" && cap === 0) {
    return { way: "NOTR", sizeUsd: 0, clamped: true, reason: "cap_zero" };
  }

  if (sizeUsd > cap) {
    return { way, sizeUsd: cap, clamped: true, reason: "cap_exceeded" };
  }

  return { way, sizeUsd: Math.max(0, sizeUsd), clamped: false };
}
