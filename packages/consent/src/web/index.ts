/**
 * @vespeneventures/consent/web — SSR-safe consent gating and preference
 * management, built entirely on the root package's pure functions.
 *
 * `react`/`react-dom` are OPTIONAL peers of this subpath specifically (see
 * package.json's `peerDependenciesMeta`) — importing
 * `@vespeneventures/consent` (the root) never pulls in React; only
 * importing `@vespeneventures/consent/web` does. This module asserts the
 * installed `react` version against this package's declared range at
 * import time, so an absent or incompatible React fails loudly here
 * instead of crashing later inside a component with no version named as
 * the cause. See `internal/peer-version.ts` for the guard itself.
 */
import { version as reactVersion } from "react";
import { assertPeerVersion } from "./internal/peer-version.js";

/** Must match package.json's `peerDependencies.react` exactly — `peer-guard.test.ts` asserts that directly. */
export const REACT_DECLARED_RANGE = ">=18";
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { ConsentGate } from "./ConsentGate.js";
export type { ConsentGateProps } from "./ConsentGate.js";
export { useConsentPreferences } from "./useConsentPreferences.js";
export type { ConsentPreferencesClient, UseConsentPreferencesOptions, UseConsentPreferencesResult } from "./useConsentPreferences.js";
