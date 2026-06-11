import { describe, it, expect } from "vitest";
import { selectParticipants } from "../src/services/matchmaking.service.js";

function runMany(
  names: string[],
  scores: Map<string, number>,
  max: number,
  runs: number,
): Map<string, number> {
  const coPickCounts = new Map<string, number>();
  const anchor = names[0]!;
  for (let i = 0; i < runs; i += 1) {
    const picked = selectParticipants(names, scores, max, 0.1);
    if (picked.includes(anchor)) {
      for (const name of picked) {
        if (name === anchor) continue;
        coPickCounts.set(name, (coPickCounts.get(name) ?? 0) + 1);
      }
    }
  }
  return coPickCounts;
}

describe("matchmaking", () => {
  it("returns all names when pool fits max", () => {
    const scores = new Map([
      ["a", 0.2],
      ["b", 0.8],
    ]);
    expect(selectParticipants(["a", "b"], scores, 16)).toEqual(["a", "b"]);
  });

  it("never exceeds max participants", () => {
    const names = Array.from({ length: 20 }, (_, i) => `agent${i}`);
    const scores = new Map(names.map((n, i) => [n, i / 20]));
    const picked = selectParticipants(names, scores, 8, 0.1);
    expect(picked.length).toBe(8);
    expect(new Set(picked).size).toBe(8);
  });

  it("biases toward similar scores over many runs", () => {
    const names = ["low", "mid", "high"];
    const scores = new Map([
      ["low", 0.1],
      ["mid", 0.5],
      ["high", 0.9],
    ]);
    const co = runMany(names, scores, 2, 2000);
    const withMid = co.get("mid") ?? 0;
    const withHigh = co.get("high") ?? 0;
    expect(withMid).toBeGreaterThan(withHigh);
  });

  it("still picks dissimilar agents sometimes (newcomer baseline)", () => {
    const names = ["a", "b", "c", "d"];
    const scores = new Map([
      ["a", 0],
      ["b", 0.9],
      ["c", 0.91],
      ["d", 0.92],
    ]);
    let anyDissimilar = false;
    for (let i = 0; i < 500; i += 1) {
      const picked = selectParticipants(names, scores, 3, 0.1);
      if (picked.includes("a") && (picked.includes("b") || picked.includes("c"))) {
        anyDissimilar = true;
        break;
      }
    }
    expect(anyDissimilar).toBe(true);
  });
});
