// Type-level conformance fixture for C-53 (proof P-31). It is compiled with
// no emit by scripts/consent-port-conformance.test.mjs against the BUILT
// declarations of the four Butler and Observer subpaths and Publisher's
// structural ports, each imported by package name exactly as a host would.
//
// Every check below is a plain annotated assignment: no cast, no `any`, no
// compiler directive. The test refuses any of those in this directory, so a
// mismatch can only be fixed in the packages, never papered over here.

import {
  createConsentLifecycle,
  type ConsentEvidencePort,
  type ConsentLifecycle,
  type ConsentLifecycleOptions,
  type ConsentSnapshot,
  type ConsentStoragePort,
} from "@clossys/butler/browser-consent";
import { createLocalStorageConsentPort } from "@clossys/butler/browser-consent/local-storage";
import { createAnalyticsTransport, type AnalyticsTransport } from "@clossys/observer/browser-analytics";
import { createPostHogProvider, type PostHogLike } from "@clossys/observer/browser-analytics/posthog";
import type {
  AnalyticsPermissionPort,
  ConsentExperienceProps,
  ConsentLifecycleInput,
  ConsentLifecyclePort,
  ConsentSnapshotView,
  ConsentStoragePortView,
} from "@clossys/publisher/web/consent";

// Butler's lifecycle and snapshot assign to Publisher's mirrors.
declare const lifecycle: ConsentLifecycle;
export const lifecycleAsPort: ConsentLifecyclePort = lifecycle;

declare const snapshot: ConsentSnapshot;
export const snapshotAsView: ConsentSnapshotView = snapshot;

// Butler's storage port and Publisher's view assign to each other.
declare const butlerStorage: ConsentStoragePort;
export const storageAsView: ConsentStoragePortView = butlerStorage;

declare const viewStorage: ConsentStoragePortView;
export const viewAsStorage: ConsentStoragePort = viewStorage;

// The isolated storage adapter produces Butler's port.
declare const storageKey: string;
const hostStorage: ConsentStoragePort = createLocalStorageConsentPort({ key: storageKey });

// Observer's transport, fed by the isolated provider adapter, assigns to
// Publisher's permission port and to the assembly's `transport` prop.
declare const sdk: PostHogLike;
declare const providerKey: string;
declare const providerHost: string;
const transport: AnalyticsTransport = createAnalyticsTransport({
  loadProvider: async () => createPostHogProvider(sdk, { key: providerKey, apiHost: providerHost }),
  allowedConversions: [],
});
export const transportAsPort: AnalyticsPermissionPort = transport;
export const transportProp: ConsentExperienceProps["transport"] = transport;

// The reference host factory from C-53, with no cast.
declare const hostEvidence: ConsentEvidencePort;
declare const hostOptions: Omit<ConsentLifecycleOptions, "storage" | "evidence" | "signals" | "simulated">;

export const createLifecycle: ConsentExperienceProps["createLifecycle"] = (input) =>
  createConsentLifecycle({
    ...hostOptions,
    signals: input.signals,
    storage: input.storage ?? hostStorage,
    evidence: input.evidence ?? hostEvidence,
    simulated: input.simulated,
  });

// The same factory written against the input type directly.
export function referenceFactory(input: ConsentLifecycleInput): ConsentLifecyclePort {
  return createConsentLifecycle({
    ...hostOptions,
    signals: input.signals,
    storage: input.storage ?? hostStorage,
    evidence: input.evidence ?? hostEvidence,
    simulated: input.simulated,
  });
}
