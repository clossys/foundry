/**
 * Eager evaluation of a client-only stock module, guarded for an omitted optional peer.
 *
 * `components/server` re-exports the stock LinkButton and Spinner through deferred
 * boundaries (`stock-link-button`, `stock-spinner`). Where React has `createContext`
 * those boundaries evaluate the stock module while they evaluate, so markup stays
 * synchronous. The stock modules import optional peers (react-aria-components, and
 * through it react-dom and @internationalized/date; lucide-react), so an unguarded
 * eager load made the server-safe subset reject at import whenever one of them was
 * omitted. A missing package now leaves the deferred boundary in place: the entry
 * imports, and the boundary reports the absent peer only if that control renders.
 * Any other failure (a missing shipped file, a throwing module) still propagates.
 */
export function isAbsentPackage(error: unknown): boolean {
  return error instanceof Error
    && (error as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND"
    && /^Cannot find package '/.test(error.message);
}

/** Load the module now, or `undefined` when an optional package it imports is not installed. */
export async function loadUnlessPeerAbsent<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    if (isAbsentPackage(error)) return undefined;
    throw error;
  }
}
