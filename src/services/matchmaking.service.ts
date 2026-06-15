import { config } from "../config.js";
import { Agent } from "../db/agent.model.js";

export type ScoreMap = Map<string, number>;

function meanDistanceToSelected(
  candidate: string,
  selected: string[],
  scores: ScoreMap,
  epsilon: number,
): number {
  if (selected.length === 0) return epsilon;
  const candidateScore = scores.get(candidate) ?? 0;
  let sum = 0;
  for (const name of selected) {
    const s = scores.get(name) ?? 0;
    sum += Math.abs(candidateScore - s);
  }
  return sum / selected.length + epsilon;
}

function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return items[Math.floor(Math.random() * items.length)]!;
  }
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/**
 * Select up to `max` participants biased toward similar excellence scores.
 * First pick is uniform; subsequent picks weight by inverse mean distance.
 */
export function selectParticipants(
  names: string[],
  scores: ScoreMap,
  max: number,
  epsilon = config.matchmakingEpsilon,
): string[] {
  const pool = [...new Set(names)];
  if (pool.length <= max) return pool;
  if (max <= 0) return [];

  const selected: string[] = [];
  const remaining = new Set(pool);

  const seedIdx = Math.floor(Math.random() * pool.length);
  const seed = pool[seedIdx]!;
  selected.push(seed);
  remaining.delete(seed);

  while (selected.length < max && remaining.size > 0) {
    const candidates = [...remaining];
    const weights = candidates.map((c) => {
      const dist = meanDistanceToSelected(c, selected, scores, epsilon);
      return 1 / dist;
    });
    const pick = weightedPick(candidates, weights);
    selected.push(pick);
    remaining.delete(pick);
  }

  return selected;
}

export async function selectParticipantsForRoom(
  candidateNames: string[],
  max: number,
): Promise<string[]> {
  const unique = [...new Set(candidateNames)];
  if (unique.length <= max) return unique;

  const agents = await Agent.find({ name: { $in: unique } }).lean();
  const scores: ScoreMap = new Map();
  for (const name of unique) {
    const agent = agents.find((a) => a.name === name);
    // Normalize the [0,100] excellence score to [0,1] so the tuned epsilon
    // (a 0..1 distance) keeps its intended weighting behavior.
    scores.set(name, (agent?.score ?? 0) / 100);
  }

  return selectParticipants(unique, scores, max, config.matchmakingEpsilon);
}
