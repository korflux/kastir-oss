import { COLD_START_THRESHOLD } from "@/lib/Modules/SplitTests/constants";

export type SelectableDestination = {
  id: string;
  weight: number;
  hits: number;
  sortOrder: number;
};

export type SelectDestinationOptions = {
  destinations: readonly SelectableDestination[];
  totalHits: number;
  threshold?: number;
  /** Returns a number in [0, 1). Inject for tests. */
  random?: () => number;
};

/**
 * Cold start: weighted random by theoretical weight.
 * After threshold: pick max deficit (weight/100 - hits/total); tie → lower sortOrder.
 */
export function selectDestination(options: SelectDestinationOptions): string {
  const {
    destinations,
    totalHits,
    threshold = COLD_START_THRESHOLD,
    random = Math.random,
  } = options;

  if (destinations.length === 0) {
    throw new Error("No destinations to select");
  }

  if (destinations.length === 1) {
    return destinations[0].id;
  }

  if (totalHits < threshold) {
    return pickWeightedRandom(destinations, random);
  }

  return pickMaxDeficit(destinations, totalHits);
}

function pickWeightedRandom(
  destinations: readonly SelectableDestination[],
  random: () => number,
): string {
  const totalWeight = destinations.reduce((sum, d) => sum + d.weight, 0);
  if (totalWeight <= 0) {
    return destinations[0].id;
  }

  let roll = random() * totalWeight;
  for (const destination of destinations) {
    roll -= destination.weight;
    if (roll < 0) {
      return destination.id;
    }
  }

  return destinations[destinations.length - 1].id;
}

function pickMaxDeficit(
  destinations: readonly SelectableDestination[],
  totalHits: number,
): string {
  const total = Math.max(totalHits, 1);
  let best = destinations[0];
  let bestDeficit = best.weight / 100 - best.hits / total;

  for (let i = 1; i < destinations.length; i += 1) {
    const candidate = destinations[i];
    const deficit = candidate.weight / 100 - candidate.hits / total;
    if (
      deficit > bestDeficit ||
      (deficit === bestDeficit && candidate.sortOrder < best.sortOrder)
    ) {
      best = candidate;
      bestDeficit = deficit;
    }
  }

  return best.id;
}
