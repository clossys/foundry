export type PresenceActionKind = "configure-presence" | "publish" | "reply";
export type PresenceSubjectKind = "organization" | "product";

export interface PresenceChannelBinding {
  id: string;
  accountRef: string;
  readinessEvidenceSource: string;
}

/** Every value that turns the durable role into one consumer's installed position. */
export interface PresenceInstallation {
  id: string;
  subjectId: string;
  /** Deliberately excludes a person: this role never manufactures or impersonates one. */
  subjectKind: PresenceSubjectKind;
  businessMetricNode: string;
  causalHypothesis: string;
  audienceRef: string;
  strategyRevision: string;
  channels: readonly PresenceChannelBinding[];
  qualifiedActionKinds: readonly string[];
  metric: {
    setpointPerThousand: number;
    minimumExposureCount: number;
    attributionWindowSeconds: number;
    evaluationCadence: string;
    exposureEvidenceSource: string;
    responseEvidenceSource: string;
  };
  authoritySource: string;
  allowedActions: readonly PresenceActionKind[];
  /** V1 has no paid distribution path. No positive value is representable. */
  paidSpendCeiling: 0;
  guardrails: {
    maxActionsPerCadence: number;
    contentPolicyRefs: readonly string[];
    impersonationProhibited: true;
  };
  durableStores: {
    experiments: string;
    actions: string;
    outcomes: string;
  };
  escalation: {
    ownerId: string;
    route: string;
  };
}

/** A versioned consumer-authored test of audience, channel, content, and cadence. */
export interface PresenceExperiment {
  id: string;
  installationId: string;
  revision: string;
  hypothesis: string;
  audienceRef: string;
  channelId: string;
  contentId: string;
  actionKind: "publish" | "reply";
  cadenceSeconds: number;
  windowOpensAt: string;
  windowClosesAt: string;
  status: "planned" | "running" | "closed" | "escalated";
  supersedes?: string;
}

/** Durable evidence binding current delegated authority to one exact action intent. */
export interface PresenceAuthorityEvidence {
  id: string;
  intentId: string;
  subjectId: string;
  actorId: string;
  humanOwnerId: string;
  allowedActions: readonly PresenceActionKind[];
  channelIds: readonly string[];
  issuedAt: string;
  expiresAt: string;
  paidSpendCeiling: 0;
}

interface PresenceActionIntentBase {
  id: string;
  installationId: string;
  subjectId: string;
  experimentId: string;
  channelId: string;
  requestedAt: string;
  authority: PresenceAuthorityEvidence;
}

export interface ConfigurePresenceIntent extends PresenceActionIntentBase {
  actionKind: "configure-presence";
  presenceRevision: string;
}

export interface PublishIntent extends PresenceActionIntentBase {
  actionKind: "publish";
  contentId: string;
  publicationId: string;
}

export interface ReplyIntent extends PresenceActionIntentBase {
  actionKind: "reply";
  contentId: string;
  publicationId: string;
  inReplyToId: string;
  /** Opaque proof that the inbound event passed the consumer's admission boundary. */
  admissionEvidenceId: string;
}

export type PresenceActionIntent = ConfigurePresenceIntent | PublishIntent | ReplyIntent;

export type PresenceAuthorityDecision =
  | { state: "authorized" }
  | { state: "denied"; reason: string }
  | { state: "unverifiable"; reason: string };

export type PresenceAuthorityPolicy = (
  intent: PresenceActionIntent,
) => PresenceAuthorityDecision | Promise<PresenceAuthorityDecision>;

/** Provider-neutral proof that the injected actuator applied the requested action. */
export interface PresenceActionReceipt {
  provider: string;
  remoteActionId: string;
  observedAt: string;
}

export interface PresenceActuator {
  execute(intent: PresenceActionIntent): Promise<PresenceActionReceipt>;
}

export interface PresenceActionFailure {
  code: string;
  message: string;
  retryable: boolean;
  provider?: string;
}

interface PresenceActionResultBase {
  intentId: string;
  experimentId: string;
  channelId: string;
  actionKind: PresenceActionKind;
}

export type CompletedPresenceActionResult =
  | (PresenceActionResultBase & { state: "applied"; receipt: PresenceActionReceipt })
  | (PresenceActionResultBase & { state: "failed"; failure: PresenceActionFailure })
  | (PresenceActionResultBase & { state: "skipped"; reason: string });

export type PresenceActionResult =
  | CompletedPresenceActionResult
  | (PresenceActionResultBase & { state: "duplicate"; reason: "duplicate" })
  | (PresenceActionResultBase & { state: "unverifiable"; reason: string });

export interface PresenceActionClaim {
  state: "claimed";
  leaseId: string;
}

export interface PresenceActionDuplicate {
  state: "duplicate";
}

/** The host atomically claims intent ids and durably completes terminal results. */
export interface PresenceActionLedger {
  claim(intent: PresenceActionIntent): Promise<PresenceActionClaim | PresenceActionDuplicate>;
  complete(claim: PresenceActionClaim, result: CompletedPresenceActionResult): Promise<void>;
}

export interface InfluencerConfig {
  authority: PresenceAuthorityPolicy;
  actuator: PresenceActuator;
  ledger: PresenceActionLedger;
  onResult?: (result: PresenceActionResult) => void | Promise<void>;
}

export interface Influencer {
  act(intent: PresenceActionIntent): Promise<PresenceActionResult>;
}

export interface ValidationFinding {
  field: string;
  message: string;
}

export type CountObservation =
  | {
      state: "observed";
      evidenceSource: string;
      observedAt: string;
      count: number;
    }
  | {
      state: "unobserved";
      evidenceSource: string;
      observedAt: string;
    }
  | {
      state: "could-not-read";
      evidenceSource: string;
      note: string;
    };

export interface AudienceResponseEvent {
  eventId: string;
  experimentId: string;
  contentId: string;
  publicationId: string;
  actionKind: string;
  occurredAt: string;
}

export type ResponseObservation =
  | {
      state: "observed";
      evidenceSource: string;
      observedAt: string;
      events: readonly AudienceResponseEvent[];
    }
  | {
      state: "unobserved";
      evidenceSource: string;
      observedAt: string;
    }
  | {
      state: "could-not-read";
      evidenceSource: string;
      note: string;
    };

export interface ResponseYieldRecord {
  intentId: string;
  subjectId: string;
  actionKind: "publish" | "reply";
  experimentId: string;
  contentId: string;
  publicationId: string;
  channelId: string;
  authority: PresenceAuthorityEvidence;
  windowOpensAt: string;
  windowClosesAt: string;
  exposures: CountObservation;
  responses: ResponseObservation;
}

export interface ResponseYieldInput {
  evaluatedAt: string;
  setpointPerThousand: number;
  minimumExposureCount: number;
  qualifiedActionKinds: readonly string[];
  records: readonly ResponseYieldRecord[];
}

export interface ResponseYieldResult {
  state: "satisfied" | "violated" | "indeterminate";
  metric: "qualified-response-yield-per-thousand";
  qualifiedResponseCount: number;
  eligibleExposureCount: number;
  valuePerThousand: number | null;
  setpointPerThousand: number;
  recordsDue: number;
  unqualifiedResponseCount: number;
  detail: string;
}
