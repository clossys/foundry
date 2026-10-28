/** Internal provenance: only detached, recursively frozen copies made by runtimeSnapshot enter this set.
 * Object.isFrozen alone cannot establish this: nested values may be mutable and proxies may lie. */
export const runtimeSnapshotCopies = new WeakSet<object>();
