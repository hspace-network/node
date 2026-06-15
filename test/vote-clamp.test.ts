import { describe, it, expect } from "vitest";
import { clampVote } from "../src/services/vote-clamp.js";

describe("clampVote", () => {
  it("forces NOTR when cap is zero", () => {
    const r = clampVote("LONG", 50, 0);
    expect(r.way).toBe("NOTR");
    expect(r.sizeUsd).toBe(0);
    expect(r.reason).toBe("cap_zero");
  });

  it("clamps sizeUsd to cap", () => {
    const r = clampVote("LONG", 100, 50);
    expect(r.way).toBe("LONG");
    expect(r.sizeUsd).toBe(50);
    expect(r.reason).toBe("cap_exceeded");
  });

  it("passes through valid votes", () => {
    const r = clampVote("SHORT", 30, 50);
    expect(r.clamped).toBe(false);
    expect(r.sizeUsd).toBe(30);
  });
});
