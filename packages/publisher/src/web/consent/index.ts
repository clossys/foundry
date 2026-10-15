"use client";

/**
 * The browser consent assembly. Client-only: the export map refuses this
 * subpath under the `react-server` condition. It declares its lifecycle and
 * transport ports structurally and imports no consent or analytics
 * implementation; the host composes those and passes them in.
 */
export { ConsentExperience } from "./ConsentExperience.client.js";
export type { ConsentExperienceProps } from "./ConsentExperience.client.js";
export { bindTransport } from "./bind-transport.js";
export { useAnalyticsAllowed, useConsentStatus } from "./hooks.js";
export type {
  AnalyticsPermissionPort,
  ConsentLifecycleInput,
  ConsentLifecyclePort,
  ConsentRegimeView,
  ConsentReviewValue,
  ConsentSnapshotView,
  ConsentStatusView,
  ConsentStoragePortView,
  EffectiveChoiceView,
  EvidenceStatusView,
} from "./ports.js";
export type { ResolvedConsentCopy, ResolvedConsentStatusCopy, ResolvedCopyField } from "../../consent-copy/types.js";
