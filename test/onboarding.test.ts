import { describe, it, expect } from "vitest";
import { parseEther } from "viem";
import { sponsorshipDecision } from "../src/services/onboarding.service.js";

const base = {
  recipientBalanceWei: 0n,
  alreadySponsored: false,
  dayTotalWei: 0n,
  amountWei: parseEther("0.05"),
  dailyBudgetWei: parseEther("5"),
  minBalanceWei: parseEther("0.05"),
};

describe("sponsorshipDecision", () => {
  it("sponsors a fresh, empty wallet within budget", () => {
    expect(sponsorshipDecision(base)).toEqual({ sponsor: true });
  });

  it("refuses when the amount is zero", () => {
    const r = sponsorshipDecision({ ...base, amountWei: 0n });
    expect(r).toEqual({ sponsor: false, reason: "amount_zero" });
  });

  it("refuses a wallet that was already sponsored", () => {
    const r = sponsorshipDecision({ ...base, alreadySponsored: true });
    expect(r).toEqual({ sponsor: false, reason: "already_sponsored" });
  });

  it("refuses a wallet that already holds enough gas", () => {
    const r = sponsorshipDecision({
      ...base,
      recipientBalanceWei: parseEther("0.1"),
    });
    expect(r).toEqual({ sponsor: false, reason: "sufficient_balance" });
  });

  it("refuses once the daily budget would be exceeded", () => {
    const r = sponsorshipDecision({
      ...base,
      dayTotalWei: parseEther("4.98"),
    });
    expect(r).toEqual({ sponsor: false, reason: "daily_budget_exhausted" });
  });

  it("allows a drip that lands exactly on the budget", () => {
    const r = sponsorshipDecision({
      ...base,
      dayTotalWei: parseEther("4.95"),
    });
    expect(r).toEqual({ sponsor: true });
  });
});
