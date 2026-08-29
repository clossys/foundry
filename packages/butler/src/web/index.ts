/**
 * @clossys/butler/web — preference-surface state, built entirely on
 * the root package's pure functions.
 *
 * `react`/`react-dom` are OPTIONAL peers of this subpath specifically (see
 * package.json's `peerDependenciesMeta`) — importing
 * `@clossys/butler` (the root) or `@clossys/butler/inbound`
 * never pulls in React; only importing `@clossys/butler/web` does.
 * This module asserts the installed `react` version against this package's
 * declared range at import time, so an absent or incompatible React fails
 * loudly here instead of crashing later inside a hook with no version named
 * as the cause. See `internal/peer-version.ts` for the guard itself.
 *
 * This subpath ships no rendering and no copy. What a preference surface
 * says to a person, and what it looks like, are the consumer's own values;
 * what is offered here is the state machine underneath it, including the
 * structural half of withdrawal parity — see `useStandingWants`.
 */
import { version as reactVersion } from "react";
import { assertPeerVersion } from "./internal/peer-version.js";

/** Must match package.json's `peerDependencies.react` exactly — `peer-guard.test.ts` asserts that directly. */
export const REACT_DECLARED_RANGE = ">=18";
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { useStandingWants } from "./useStandingWants.js";
export type { StandingWantsClient, UseStandingWantsOptions, UseStandingWantsResult } from "./useStandingWants.js";
