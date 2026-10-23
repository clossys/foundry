import { ATOM_COMPARISON } from "@clossys/designer/atoms";

type ComparisonKey = keyof typeof ATOM_COMPARISON;

function isComparisonKey(key: string): key is ComparisonKey {
  return Object.hasOwn(ATOM_COMPARISON, key);
}

function findComparison(atomId: string) {
  if (isComparisonKey(atomId)) {
    return ATOM_COMPARISON[atomId];
  }
  return undefined; // No represented comparison for this atom.
}
export { findComparison };
