/**
 * The one judgment vocabulary this whole package is built on.
 *
 * A gate, a subject, or a landed change is either seen ("observed" — real
 * telemetry or run history was read, and it says something definite),
 * confirmed absent ("unobserved" — the read succeeded and there is
 * genuinely nothing there), or "could-not-read" — the read itself failed or
 * was never possible with the credential this run holds.
 *
 * `could-not-read` is load-bearing, not a fallback. Run history and
 * telemetry stores are frequently unreadable by script without a credential
 * the plane does not have. A check that collapses "I could not look" into
 * either "observed" or "unobserved" reports a fact it does not have —
 * manufacturing confidence is worse than reporting none, the same lesson
 * issue #255's `declared-but-not-verifiable` finding kind draws for
 * schedules and routines. A gate that cannot see is not a gate that saw
 * nothing.
 *
 * Every read in this package returns an `Observation<T>` rather than a bare
 * `T | undefined`, so the distinction is enforced in the type, not left to a
 * caller's discipline: the `"could-not-read"` branch REQUIRES a `note`
 * explaining why, and the `"observed"` branch is the only one carrying the
 * observed payload. A caller cannot construct a narrower result — e.g. a
 * `could-not-read` with the payload already attached, or an `observed` with
 * no payload at all — without a type error. See `observation.check.ts` for
 * the compiled proof.
 */

/** The three-state read result every observation in this package produces. */
export type ObservationState = "observed" | "unobserved" | "could-not-read";

/**
 * A read result carrying `TObserved` when — and only when — the read
 * actually observed something. `"could-not-read"` requires `note`: a
 * caller-facing explanation of why the read failed, because an unexplained
 * `could-not-read` reads as a bug in this package rather than a fact about
 * the plane's own readability. `source` is optional on every branch and
 * names where the read was attempted, for the report.
 */
export type Observation<TObserved extends object> =
  | ({ readonly state: "observed"; readonly source?: string } & TObserved)
  | { readonly state: "unobserved"; readonly source?: string }
  | { readonly state: "could-not-read"; readonly note: string; readonly source?: string };

/** Type guard narrowing an `Observation<T>` to its `"observed"` branch. */
export function isObserved<TObserved extends object>(
  observation: Observation<TObserved>,
): observation is { readonly state: "observed"; readonly source?: string } & TObserved {
  return observation.state === "observed";
}

/** Type guard narrowing an `Observation<T>` to its `"could-not-read"` branch. */
export function isCouldNotRead<TObserved extends object>(
  observation: Observation<TObserved>,
): observation is { readonly state: "could-not-read"; readonly note: string; readonly source?: string } {
  return observation.state === "could-not-read";
}

/** Type guard narrowing an `Observation<T>` to its `"unobserved"` branch. */
export function isUnobserved<TObserved extends object>(
  observation: Observation<TObserved>,
): observation is { readonly state: "unobserved"; readonly source?: string } {
  return observation.state === "unobserved";
}
