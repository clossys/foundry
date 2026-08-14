import type { ReactElement, ReactNode } from "react";
import type { ConsentCategory, ConsentEvaluation } from "../types.js";

export interface ConsentGateProps {
  /**
   * Informational only. `ConsentGate` never uses this to look anything up —
   * `evaluation` alone determines what renders — but it documents at the
   * call site which category this gate is gating, and a host may use it for
   * its own logging/telemetry around the rendered element.
   */
  category: ConsentCategory;
  /**
   * Resolved by the host, before first render — server-side for an SSR
   * page, or synchronously from already-loaded state on the client.
   * `ConsentGate` never fetches, reads, or resolves this itself; there is
   * no default and no loading state. See "SSR contract" below.
   */
  evaluation: ConsentEvaluation;
  /** Rendered for every status other than `"granted"`, including `"absent"` — there is no separate loading-only render path. */
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * Renders `children` only when `evaluation.status === "granted"`, and
 * `fallback` for every other status (`"absent"`, `"denied"`, `"stale"`).
 *
 * ## SSR contract
 *
 * `evaluation` is an INJECTED PROP, never something this component fetches,
 * reads, or resolves on its own. That is what makes the following
 * guarantee hold: for a given `evaluation` value, this component's server
 * render and its first client render always produce byte-identical output,
 * because both renders are pure functions of the exact same prop — there is
 * no client-only effect, no client-only storage read, and no intermediate
 * loading state that could render differently before/after hydration. A
 * host is responsible for resolving `evaluation` identically on the server
 * and for the first client render (e.g. by embedding the server-resolved
 * evaluation into the page and reading it back on the client instead of
 * re-deriving it) — this component cannot enforce that half on its own, but
 * it never introduces a mismatch of its own regardless. See
 * `ConsentGate.test.tsx`'s SSR-contract test, which asserts this directly
 * with `renderToString` and `hydrateRoot` for every `ConsentEvaluation`
 * status, rather than only claiming it in prose.
 *
 * Renders via a `Fragment` (`<>...</>`), never a wrapping DOM element, so
 * gating never changes the markup shape of whatever it wraps.
 */
export function ConsentGate({ evaluation, fallback, children }: ConsentGateProps): ReactElement {
  return <>{evaluation.status === "granted" ? children : fallback}</>;
}
