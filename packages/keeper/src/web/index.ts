/**
 * @vespeneventures/keeper/web — the showing step, built entirely on the root
 * package's pure functions.
 *
 * `react`/`react-dom` are OPTIONAL peers of this subpath specifically (see
 * package.json's `peerDependenciesMeta`) — importing
 * `@vespeneventures/keeper` (the root) or running the `keeper-check` gates
 * never pulls in React; only importing `@vespeneventures/keeper/web` does.
 * This module asserts the installed `react` version against this package's
 * declared range at import time, so an absent or incompatible React fails
 * loudly here instead of crashing later inside a hook with no version named
 * as the cause. See `internal/peer-version.ts` for the guard itself.
 *
 * This subpath ships no rendering and no copy. What a "here is everything we
 * hold about you" surface says, and what it looks like, are the consumer's
 * own values; what is offered here is the state machine underneath it —
 * including the structural half of the correction step, where being forgotten
 * is reachable through the same call shape as being shown.
 */
import { version as reactVersion } from "react";
import { assertPeerVersion } from "./internal/peer-version.js";

/** Must match package.json's `peerDependencies.react` exactly — `index.test.ts` asserts that directly. */
export const REACT_DECLARED_RANGE = ">=18";
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { useHeldRecord } from "./useHeldRecord.js";
export type { HeldRecordClient, HeldRecordEntry, HeldRecordRow, UseHeldRecordOptions, UseHeldRecordResult } from "./useHeldRecord.js";
