/** Both arguments must be 40-char lowercase hex git tree oids. */
const TREE_OID = /^[0-9a-f]{40}$/;

/**
 * True when two tree hashes denote the same tree (duplicate-merge detection).
 * Matches the comparison used for tree-equivalent merge attestation.
 */
export function treesEquivalent(headTree, secondParentTree) {
  if (!TREE_OID.test(String(headTree)) || !TREE_OID.test(String(secondParentTree))) return false;
  return headTree === secondParentTree;
}
