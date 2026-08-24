import { describe, expect, it } from "vitest";
import type { PresenceExperiment, PresenceInstallation, PublishIntent } from "./types.js";
import {
  validatePresenceActionIntent,
  validatePresenceExperiment,
  validatePresenceInstallation,
} from "./validation.js";

const installation: PresenceInstallation = {
  id: "presence-one",
  subjectId: "product-one",
  subjectKind: "product",
  businessMetricNode: "qualified-demand",
  causalHypothesis: "Relevant explanations prompt qualified product evaluation.",
  audienceRef: "audience-builders-v2",
  strategyRevision: "strategy-v3",
  channels: [{ id: "channel-one", accountRef: "account-one", readinessEvidenceSource: "channel-inspector" }],
  qualifiedActionKinds: ["qualified-reply", "product-evaluation"],
  metric: {
    setpointPerThousand: 2,
    minimumExposureCount: 1_000,
    attributionWindowSeconds: 86_400,
    evaluationCadence: "P7D",
    exposureEvidenceSource: "channel-outcomes",
    responseEvidenceSource: "product-outcomes",
  },
  authoritySource: "delegated-authority",
  allowedActions: ["configure-presence", "publish", "reply"],
  paidSpendCeiling: 0,
  guardrails: {
    maxActionsPerCadence: 10,
    contentPolicyRefs: ["claims-v3", "voice-v2"],
    impersonationProhibited: true,
  },
  durableStores: { experiments: "experiment-ledger", actions: "action-ledger", outcomes: "outcome-ledger" },
  escalation: { ownerId: "owner-one", route: "human-review" },
};

const experiment: PresenceExperiment = {
  id: "experiment-one",
  installationId: installation.id,
  revision: "1.0.0",
  hypothesis: "A concrete example increases qualified replies.",
  audienceRef: installation.audienceRef,
  channelId: "channel-one",
  contentId: "content-one",
  actionKind: "publish",
  cadenceSeconds: 86_400,
  windowOpensAt: "2026-08-23T10:00:00.000Z",
  windowClosesAt: "2026-08-24T10:00:00.000Z",
  status: "planned",
};

const publishIntent: PublishIntent = {
  id: "intent-one",
  installationId: installation.id,
  subjectId: installation.subjectId,
  experimentId: experiment.id,
  channelId: experiment.channelId,
  actionKind: "publish",
  requestedAt: "2026-08-23T10:00:00.000Z",
  authority: {
    id: "authority-one",
    intentId: "intent-one",
    subjectId: installation.subjectId,
    actorId: "agent-one",
    humanOwnerId: "owner-one",
    allowedActions: ["publish"],
    channelIds: ["channel-one"],
    issuedAt: "2026-08-23T09:00:00.000Z",
    expiresAt: "2026-08-23T11:00:00.000Z",
    paidSpendCeiling: 0,
  },
  contentId: experiment.contentId,
  publicationId: "publication-one",
};

describe("consumer and experiment bindings", () => {
  it("accepts a complete zero-spend organizational/product installation", () => {
    expect(validatePresenceInstallation(installation)).toEqual([]);
    expect(validatePresenceExperiment(experiment)).toEqual([]);
  });

  it("structurally rejects person impersonation and paid spend", () => {
    const findings = validatePresenceInstallation({
      ...installation,
      subjectKind: "person",
      paidSpendCeiling: 50,
      guardrails: { ...installation.guardrails, impersonationProhibited: false },
    });
    expect(findings.map((finding) => finding.field)).toEqual(expect.arrayContaining([
      "subjectKind",
      "paidSpendCeiling",
      "guardrails.impersonationProhibited",
    ]));
  });

  it("requires the complete consumer binding rather than an empty mission document", () => {
    const findings = validatePresenceInstallation({
      ...installation,
      causalHypothesis: "",
      channels: [],
      qualifiedActionKinds: [],
      escalation: { ownerId: "", route: "" },
    });
    expect(findings.map((finding) => finding.field)).toEqual(expect.arrayContaining([
      "causalHypothesis",
      "channels",
      "qualifiedActionKinds",
      "escalation.ownerId",
      "escalation.route",
    ]));
  });
});

describe("intent-bound authority", () => {
  it("accepts an authorized zero-spend publish intent", () => {
    expect(validatePresenceActionIntent(publishIntent)).toEqual([]);
  });

  it("rejects authority attached to another intent, subject, channel, or action", () => {
    const findings = validatePresenceActionIntent({
      ...publishIntent,
      authority: {
        ...publishIntent.authority,
        intentId: "other-intent",
        subjectId: "other-subject",
        allowedActions: ["reply"],
        channelIds: ["other-channel"],
      },
    });
    expect(findings.map((finding) => finding.field)).toEqual(expect.arrayContaining([
      "authority.intentId",
      "authority.subjectId",
      "authority.allowedActions",
      "authority.channelIds",
    ]));
  });

  it("rejects a positive spend ceiling and expired authority", () => {
    const findings = validatePresenceActionIntent({
      ...publishIntent,
      authority: {
        ...publishIntent.authority,
        paidSpendCeiling: 1,
        expiresAt: "2026-08-23T09:59:59.000Z",
      },
    });
    expect(findings.map((finding) => finding.field)).toEqual(expect.arrayContaining([
      "authority.paidSpendCeiling",
      "authority.expiresAt",
    ]));
  });

  it("requires admitted inbound evidence for a reply", () => {
    const findings = validatePresenceActionIntent({
      ...publishIntent,
      actionKind: "reply",
      inReplyToId: "inbound-one",
      admissionEvidenceId: "",
      authority: { ...publishIntent.authority, allowedActions: ["reply"] },
    });
    expect(findings).toContainEqual({ field: "admissionEvidenceId", message: "must be non-empty" });
  });
});
