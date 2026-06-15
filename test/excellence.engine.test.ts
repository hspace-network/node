import { describe, it, expect } from "vitest";
import {
  scoreVoteDelta,
  applyScoreDelta,
  clampScore,
  convictionMultiplier,
  deltaSkipReason,
} from "../src/services/excellence.engine.js";

describe("excellence engine", () => {
  const delta = 0.05;
  const ref = 50;

  it("LONG correct on up move", () => {
    expect(scoreVoteDelta("LONG", "up", 0, delta, ref)).toBeCloseTo(0.025);
    expect(scoreVoteDelta("LONG", "up", 50, delta, ref)).toBeCloseTo(0.05);
  });

  it("LONG wrong on down move", () => {
    expect(scoreVoteDelta("LONG", "down", 50, delta, ref)).toBeCloseTo(-0.05);
  });

  it("SHORT correct on down move", () => {
    expect(scoreVoteDelta("SHORT", "down", 50, delta, ref)).toBeCloseTo(0.05);
  });

  it("SHORT wrong on up move", () => {
    expect(scoreVoteDelta("SHORT", "up", 50, delta, ref)).toBeCloseTo(-0.05);
  });

  it("NOTR and flat moves yield zero", () => {
    expect(scoreVoteDelta("NOTR", "up", 50, delta, ref)).toBe(0);
    expect(scoreVoteDelta("LONG", "flat", 50, delta, ref)).toBe(0);
    expect(scoreVoteDelta("SHORT", "flat", 50, delta, ref)).toBe(0);
  });

  it("deltaSkipReason explains zero-delta cases", () => {
    expect(deltaSkipReason("NOTR", "up")).toBe("NOTR");
    expect(deltaSkipReason("LONG", "flat")).toBe("flat market");
    expect(deltaSkipReason("LONG", "up")).toBeNull();
  });

  it("clamps score to [0, 100]", () => {
    expect(applyScoreDelta(98, 5)).toBe(100);
    expect(applyScoreDelta(2, -5)).toBe(0);
    expect(clampScore(150)).toBe(100);
    expect(clampScore(-10)).toBe(0);
  });

  it("scales conviction with sizeUsd", () => {
    expect(convictionMultiplier(0, ref)).toBeCloseTo(0.5);
    expect(convictionMultiplier(25, ref)).toBeCloseTo(0.75);
    expect(convictionMultiplier(50, ref)).toBeCloseTo(1);
    expect(convictionMultiplier(100, ref)).toBeCloseTo(1);
  });
});
