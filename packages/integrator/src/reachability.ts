/**
 * Probes a registry for the latest published version of each entitled
 * package, through an injected transport -- never a real `fetch`, in this
 * module or in its tests. The caller supplies the registry base URL and the
 * transport; this module has no default of either, so it never assumes which
 * registry a consuming plane authenticates against.
 *
 * THE CORE PROBLEM THIS SOLVES
 * -----------------------------
 * An install that fails for want of a credential must never read as "not
 * entitled" or "not published". Some registries answer 404, not 403, for a
 * package the calling credential cannot see -- deliberately, so as not to
 * confirm a private package's existence to an unauthenticated caller. That
 * makes a single 404 genuinely ambiguous: it could mean the package was never
 * published, or it could mean the credential is blind to it.
 *
 * `scripts/check-package-visibility.mjs` in this repository solves the same
 * ambiguity for the opposite direction (publisher-side visibility, not
 * installer-side reachability) with the same reasoning: resolved per package
 * it is unrecoverable, but resolved in AGGREGATE across a whole probed batch
 * it is not -- if EVERY lookup in the batch 404s, a token that lost its read
 * scope is a far more likely explanation than an entire entitled slice of the
 * catalogue having never been published. `resolveReachability` below applies
 * that exact reasoning to installer-side probing.
 */

export type Transport = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** The raw, per-package result of one registry lookup -- before ambiguity is resolved. */
export type ProbeOutcome =
  | { readonly kind: "known"; readonly latestVersion: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "denied" }
  | { readonly kind: "unreachable" };

export interface ReachabilityProbeOptions {
  readonly transport: Transport;
  readonly registryBaseUrl: string;
  readonly signal?: AbortSignal;
}

/** The resolved verdict a caller actually reasons about -- see `resolveReachability`. */
/**
 * Why a reachability read could not be decided. One value today, drawn from a
 * closed vocabulary rather than a freeform string, for the same reason
 * `CurrencyIndeterminateReason` is: a caller must be able to branch on WHY,
 * and a sentence cannot be branched on.
 */
export type ReachabilityIndeterminateReason = "not-found-with-working-credential";

export type ReachabilityVerdict =
  | { readonly kind: "known"; readonly latestVersion: string }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "unreachable" }
  /**
   * The registry answered, definitively, that it does not have this name --
   * and the credential is proven to work for other names in the same batch,
   * so "never published", "deliberately retired", and "not visible to this
   * credential" remain indistinguishable.
   *
   * This used to resolve to `unreachable`, which is a FALSE STATEMENT about
   * what happened: the registry was reached and it answered. The comment
   * above that branch already said the case was "genuinely undecidable" --
   * the defect was that the vocabulary had no word for undecidable, so the
   * nearest neighbour was borrowed and a caller could no longer tell a
   * transport failure from a definitive 404. This is that word.
   */
  | { readonly kind: "indeterminate"; readonly reason: ReachabilityIndeterminateReason };

function registryPath(name: string): string {
  // A scoped package's registry metadata path keeps the leading `@` literal
  // and encodes only the slash -- `@scope%2Fname` -- which is the convention
  // every npm-compatible registry (npm itself, GitHub Packages, a private
  // Verdaccio) shares. `encodeURIComponent` on the scope substring INCLUDING
  // the leading `@` would also encode the `@` itself (to `%40`), which none
  // of them expect, so the `@` is re-added literally after encoding the rest
  // of the scope name.
  const slash = name.indexOf("/");
  if (slash === -1) return encodeURIComponent(name);
  return `@${encodeURIComponent(name.slice(1, slash))}%2F${encodeURIComponent(name.slice(slash + 1))}`;
}

async function probeOne(name: string, options: ReachabilityProbeOptions): Promise<ProbeOutcome> {
  const base = options.registryBaseUrl.endsWith("/") ? options.registryBaseUrl : `${options.registryBaseUrl}/`;
  let response: Response;
  try {
    response = await options.transport(new URL(registryPath(name), base), options.signal ? { signal: options.signal } : {});
  } catch {
    return { kind: "unreachable" };
  }

  if (response.status === 404) return { kind: "not-found" };
  if (response.status === 401 || response.status === 403) return { kind: "denied" };
  if (response.status < 200 || response.status >= 300) return { kind: "unreachable" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "unreachable" };
  }
  if (typeof body !== "object" || body === null) return { kind: "unreachable" };
  const distTags = (body as Record<string, unknown>)["dist-tags"];
  const latest = typeof distTags === "object" && distTags !== null ? (distTags as Record<string, unknown>)["latest"] : undefined;
  if (typeof latest !== "string" || latest.length === 0) return { kind: "unreachable" };
  return { kind: "known", latestVersion: latest };
}

/** Probe the registry for every named package. Every name is probed independently; one failure never skips the rest. */
export async function probeReachability(names: readonly string[], options: ReachabilityProbeOptions): Promise<ReadonlyMap<string, ProbeOutcome>> {
  const entries = await Promise.all(names.map(async (name) => [name, await probeOne(name, options)] as const));
  return new Map(entries);
}

/**
 * Resolve each raw outcome into the verdict `judgeCurrency` actually consumes.
 *
 * `denied` (an explicit 401/403) and `unreachable` (a transport failure, a
 * server error, a malformed body) are never reclassified -- those ARE the two
 * distinctions this package exists to keep apart, so they pass straight
 * through. Only `not-found` is ambiguous, and it is resolved once, over the
 * whole batch: if nothing in the batch came back `known`, a blind credential
 * explains every 404 in it better than an entire entitled slice never having
 * been published, so every `not-found` in that batch resolves to
 * `unauthenticated`. That half is unchanged and is right.
 *
 * If at least one lookup came back `known`, the credential is proven to work
 * FOR THE NAMES IT WORKED FOR -- which is not the same as proving visibility
 * of the one that 404'd, because GitHub Packages access control is per
 * package. `scripts/select-publishable-packages.mjs` reached this conclusion
 * independently and states it: "GitHub returns 404 identically for a package
 * that was never published and for one this credential cannot see."
 *
 * So that case is undecidable, and now SAYS undecidable. It previously
 * resolved to `unreachable`, which asserts a transport failure that did not
 * occur -- the registry was reached and answered. A caller acting on
 * `unreachable` waits and retries; the retry never succeeds for a name that
 * is deliberately gone, and the correct response (drop the stale entitlement)
 * is indistinguishable from the wrong one.
 */
export function resolveReachability(outcomes: ReadonlyMap<string, ProbeOutcome>): ReadonlyMap<string, ReachabilityVerdict> {
  const hasKnown = [...outcomes.values()].some((outcome) => outcome.kind === "known");

  const resolved = new Map<string, ReachabilityVerdict>();
  for (const [name, outcome] of outcomes) {
    switch (outcome.kind) {
      case "known":
        resolved.set(name, { kind: "known", latestVersion: outcome.latestVersion });
        break;
      case "denied":
        resolved.set(name, { kind: "unauthenticated" });
        break;
      case "unreachable":
        resolved.set(name, { kind: "unreachable" });
        break;
      case "not-found":
        resolved.set(
          name,
          hasKnown ? { kind: "indeterminate", reason: "not-found-with-working-credential" } : { kind: "unauthenticated" },
        );
        break;
      default:
        assertNeverOutcome(outcome);
    }
  }
  return resolved;
}

function assertNeverOutcome(value: never): never {
  throw new Error(`Unhandled probe outcome: ${JSON.stringify(value)}`);
}
