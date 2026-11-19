/**
 * Equal integer weights that always sum to 100.
 * Remainder goes to the first slot (stable order).
 * Examples: 1 → [100]; 2 → [50, 50]; 3 → [34, 33, 33]
 */
export function equalWeights(activeCount: number): number[] {
  if (activeCount < 1) return [];
  if (activeCount === 1) return [100];

  const base = Math.floor(100 / activeCount);
  const remainder = 100 - base * activeCount;
  return Array.from({ length: activeCount }, (_, index) =>
    index === 0 ? base + remainder : base,
  );
}
