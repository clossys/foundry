import { InfluencerValidationError } from "./errors.js";
import type {
  PresenceActionIntent,
  PresenceActionKind,
  PresenceExperiment,
  PresenceInstallation,
  ValidationFinding,
} from "./types.js";

const ACTION_KINDS = new Set<PresenceActionKind>(["configure-presence", "publish", "reply"]);

export const PRESENCE_ACTION_KINDS = ["configure-presence", "publish", "reply"] as const;
export const PRESENCE_SUBJECT_KINDS = ["organization", "product"] as const;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validInstant(value: unknown): value is string {
  return nonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateStringArray(
  value: unknown,
  field: string,
  findings: ValidationFinding[],
  allowed?: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    findings.push({ field, message: "must be a non-empty array" });
    return [];
  }
  const strings: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!nonEmpty(entry)) {
      findings.push({ field: `${field}[${index}]`, message: "must be a non-empty string" });
      continue;
    }
    if (seen.has(entry)) findings.push({ field: `${field}[${index}]`, message: "must be unique" });
    else seen.add(entry);
    if (allowed && !allowed.has(entry)) findings.push({ field: `${field}[${index}]`, message: "is not a supported value" });
    strings.push(entry);
  }
  return strings;
}

/** Validate all values required to install the role for one organizational or product presence. */
export function validatePresenceInstallation(value: unknown): ValidationFinding[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ field: "installation", message: "must be an object" }];
  }
  const installation = value as PresenceInstallation;
  const findings: ValidationFinding[] = [];
  for (const field of [
    "id",
    "subjectId",
    "businessMetricNode",
    "causalHypothesis",
    "audienceRef",
    "strategyRevision",
    "authoritySource",
  ] as const) {
    if (!nonEmpty(installation[field])) findings.push({ field, message: "must be a non-empty string" });
  }
  if (!PRESENCE_SUBJECT_KINDS.includes(installation.subjectKind)) {
    findings.push({ field: "subjectKind", message: 'must be "organization" or "product"' });
  }
  if (!Array.isArray(installation.channels) || installation.channels.length === 0) {
    findings.push({ field: "channels", message: "must be a non-empty array" });
  } else {
    const ids = new Set<string>();
    for (const [index, channel] of installation.channels.entries()) {
      if (!channel || typeof channel !== "object") {
        findings.push({ field: `channels[${index}]`, message: "must be an object" });
        continue;
      }
      for (const field of ["id", "accountRef", "readinessEvidenceSource"] as const) {
        if (!nonEmpty(channel[field])) findings.push({ field: `channels[${index}].${field}`, message: "must be non-empty" });
      }
      if (nonEmpty(channel.id) && ids.has(channel.id)) {
        findings.push({ field: `channels[${index}].id`, message: "must be unique" });
      }
      if (nonEmpty(channel.id)) ids.add(channel.id);
    }
  }
  validateStringArray(installation.qualifiedActionKinds, "qualifiedActionKinds", findings);
  validateStringArray(installation.allowedActions, "allowedActions", findings, ACTION_KINDS);

  if (!installation.metric || typeof installation.metric !== "object") {
    findings.push({ field: "metric", message: "must be an object" });
  } else {
    if (!positiveFinite(installation.metric.setpointPerThousand)) {
      findings.push({ field: "metric.setpointPerThousand", message: "must be a positive finite number" });
    }
    if (!positiveInteger(installation.metric.minimumExposureCount)) {
      findings.push({ field: "metric.minimumExposureCount", message: "must be a positive integer" });
    }
    if (!positiveInteger(installation.metric.attributionWindowSeconds)) {
      findings.push({ field: "metric.attributionWindowSeconds", message: "must be a positive integer" });
    }
    for (const field of ["evaluationCadence", "exposureEvidenceSource", "responseEvidenceSource"] as const) {
      if (!nonEmpty(installation.metric[field])) findings.push({ field: `metric.${field}`, message: "must be non-empty" });
    }
  }
  if (installation.paidSpendCeiling !== 0) {
    findings.push({ field: "paidSpendCeiling", message: "must be exactly zero in v1" });
  }
  if (!installation.guardrails || typeof installation.guardrails !== "object") {
    findings.push({ field: "guardrails", message: "must be an object" });
  } else {
    if (!positiveInteger(installation.guardrails.maxActionsPerCadence)) {
      findings.push({ field: "guardrails.maxActionsPerCadence", message: "must be a positive integer" });
    }
    validateStringArray(installation.guardrails.contentPolicyRefs, "guardrails.contentPolicyRefs", findings);
    if (installation.guardrails.impersonationProhibited !== true) {
      findings.push({ field: "guardrails.impersonationProhibited", message: "must be true" });
    }
  }
  if (!installation.durableStores || typeof installation.durableStores !== "object") {
    findings.push({ field: "durableStores", message: "must be an object" });
  } else {
    for (const field of ["experiments", "actions", "outcomes"] as const) {
      if (!nonEmpty(installation.durableStores[field])) findings.push({ field: `durableStores.${field}`, message: "must be non-empty" });
    }
  }
  if (!installation.escalation || typeof installation.escalation !== "object") {
    findings.push({ field: "escalation", message: "must be an object" });
  } else {
    for (const field of ["ownerId", "route"] as const) {
      if (!nonEmpty(installation.escalation[field])) findings.push({ field: `escalation.${field}`, message: "must be non-empty" });
    }
  }
  return findings;
}

/** Validate a versioned content/cadence hypothesis without choosing its values. */
export function validatePresenceExperiment(value: unknown): ValidationFinding[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ field: "experiment", message: "must be an object" }];
  }
  const experiment = value as PresenceExperiment;
  const findings: ValidationFinding[] = [];
  for (const field of ["id", "installationId", "revision", "hypothesis", "audienceRef", "channelId", "contentId"] as const) {
    if (!nonEmpty(experiment[field])) findings.push({ field, message: "must be a non-empty string" });
  }
  if (experiment.actionKind !== "publish" && experiment.actionKind !== "reply") {
    findings.push({ field: "actionKind", message: 'must be "publish" or "reply"' });
  }
  if (!positiveInteger(experiment.cadenceSeconds)) {
    findings.push({ field: "cadenceSeconds", message: "must be a positive integer" });
  }
  if (!validInstant(experiment.windowOpensAt)) findings.push({ field: "windowOpensAt", message: "must be a valid timestamp" });
  if (!validInstant(experiment.windowClosesAt)) findings.push({ field: "windowClosesAt", message: "must be a valid timestamp" });
  if (
    validInstant(experiment.windowOpensAt)
    && validInstant(experiment.windowClosesAt)
    && Date.parse(experiment.windowClosesAt) < Date.parse(experiment.windowOpensAt)
  ) {
    findings.push({ field: "windowClosesAt", message: "must not precede windowOpensAt" });
  }
  if (!(["planned", "running", "closed", "escalated"] as const).includes(experiment.status)) {
    findings.push({ field: "status", message: "must be a supported experiment status" });
  }
  if (experiment.supersedes !== undefined && !nonEmpty(experiment.supersedes)) {
    findings.push({ field: "supersedes", message: "must be non-empty when present" });
  }
  return findings;
}

/** Validate the exact action and its bound, zero-spend authority evidence. */
export function validatePresenceActionIntent(value: unknown): ValidationFinding[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ field: "intent", message: "must be an object" }];
  }
  const intent = value as PresenceActionIntent;
  const findings: ValidationFinding[] = [];
  for (const field of ["id", "installationId", "subjectId", "experimentId", "channelId"] as const) {
    if (!nonEmpty(intent[field])) findings.push({ field, message: "must be a non-empty string" });
  }
  if (!ACTION_KINDS.has(intent.actionKind)) findings.push({ field: "actionKind", message: "must be a supported v1 action" });
  if (!validInstant(intent.requestedAt)) findings.push({ field: "requestedAt", message: "must be a valid timestamp" });

  if (!intent.authority || typeof intent.authority !== "object" || Array.isArray(intent.authority)) {
    findings.push({ field: "authority", message: "must be an evidence object" });
  } else {
    for (const field of ["id", "intentId", "subjectId", "actorId", "humanOwnerId"] as const) {
      if (!nonEmpty(intent.authority[field])) findings.push({ field: `authority.${field}`, message: "must be non-empty" });
    }
    if (intent.authority.intentId !== intent.id) findings.push({ field: "authority.intentId", message: "must equal intent.id" });
    if (intent.authority.subjectId !== intent.subjectId) findings.push({ field: "authority.subjectId", message: "must equal subjectId" });
    const allowedActions = validateStringArray(intent.authority.allowedActions, "authority.allowedActions", findings, ACTION_KINDS);
    const channels = validateStringArray(intent.authority.channelIds, "authority.channelIds", findings);
    if (ACTION_KINDS.has(intent.actionKind) && !allowedActions.includes(intent.actionKind)) {
      findings.push({ field: "authority.allowedActions", message: "must include actionKind" });
    }
    if (nonEmpty(intent.channelId) && !channels.includes(intent.channelId)) {
      findings.push({ field: "authority.channelIds", message: "must include channelId" });
    }
    if (!validInstant(intent.authority.issuedAt)) findings.push({ field: "authority.issuedAt", message: "must be a valid timestamp" });
    if (!validInstant(intent.authority.expiresAt)) findings.push({ field: "authority.expiresAt", message: "must be a valid timestamp" });
    if (
      validInstant(intent.authority.issuedAt)
      && validInstant(intent.requestedAt)
      && Date.parse(intent.authority.issuedAt) > Date.parse(intent.requestedAt)
    ) {
      findings.push({ field: "authority.issuedAt", message: "must not follow requestedAt" });
    }
    if (
      validInstant(intent.authority.expiresAt)
      && validInstant(intent.requestedAt)
      && Date.parse(intent.authority.expiresAt) < Date.parse(intent.requestedAt)
    ) {
      findings.push({ field: "authority.expiresAt", message: "must not precede requestedAt" });
    }
    if (intent.authority.paidSpendCeiling !== 0) {
      findings.push({ field: "authority.paidSpendCeiling", message: "must be exactly zero in v1" });
    }
  }

  if (intent.actionKind === "configure-presence") {
    if (!nonEmpty(intent.presenceRevision)) findings.push({ field: "presenceRevision", message: "must be non-empty" });
  } else if (intent.actionKind === "publish") {
    if (!nonEmpty(intent.contentId)) findings.push({ field: "contentId", message: "must be non-empty" });
    if (!nonEmpty(intent.publicationId)) findings.push({ field: "publicationId", message: "must be non-empty" });
  } else if (intent.actionKind === "reply") {
    for (const field of ["contentId", "publicationId", "inReplyToId", "admissionEvidenceId"] as const) {
      if (!nonEmpty(intent[field])) findings.push({ field, message: "must be non-empty" });
    }
  }
  return findings;
}

export function assertValidPresenceActionIntent(intent: PresenceActionIntent): void {
  const findings = validatePresenceActionIntent(intent);
  if (findings.length > 0) throw new InfluencerValidationError("Presence action intent", findings);
}
