import type {
  AudienceResponseEvent,
  ResponseObservation,
  ResponseYieldInput,
  ResponseYieldRecord,
  ResponseYieldResult,
  ValidationFinding,
} from "./types.js";

const ACTION_KINDS = new Set(["configure-presence", "publish", "reply"]);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validInstant(value: unknown): value is string {
  return nonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validateEvidenceBase(
  value: unknown,
  field: string,
  evaluatedAt: string | undefined,
  findings: ValidationFinding[],
): value is { state: string; evidenceSource: string; observedAt?: string; note?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    findings.push({ field, message: "must be an evidence object" });
    return false;
  }
  const evidence = value as { state?: unknown; evidenceSource?: unknown; observedAt?: unknown; note?: unknown };
  if (!nonEmpty(evidence.evidenceSource)) findings.push({ field: `${field}.evidenceSource`, message: "must be non-empty" });
  if (evidence.state === "could-not-read") {
    if (!nonEmpty(evidence.note)) findings.push({ field: `${field}.note`, message: "must explain why the source could not be read" });
  } else if (evidence.state === "observed" || evidence.state === "unobserved") {
    if (!validInstant(evidence.observedAt)) {
      findings.push({ field: `${field}.observedAt`, message: "must be a valid timestamp" });
    } else if (validInstant(evaluatedAt) && Date.parse(evidence.observedAt) > Date.parse(evaluatedAt)) {
      findings.push({ field: `${field}.observedAt`, message: "must not follow evaluatedAt" });
    }
  } else {
    findings.push({ field: `${field}.state`, message: 'must be "observed", "unobserved", or "could-not-read"' });
  }
  return true;
}

function validateAuthority(
  record: ResponseYieldRecord,
  field: string,
  evaluatedAt: string | undefined,
  findings: ValidationFinding[],
): void {
  const authority = record.authority;
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) {
    findings.push({ field: `${field}.authority`, message: "must be an evidence object" });
    return;
  }
  for (const key of ["id", "intentId", "subjectId", "actorId", "humanOwnerId"] as const) {
    if (!nonEmpty(authority[key])) findings.push({ field: `${field}.authority.${key}`, message: "must be non-empty" });
  }
  if (authority.intentId !== record.intentId) {
    findings.push({ field: `${field}.authority.intentId`, message: "must equal intentId" });
  }
  if (authority.subjectId !== record.subjectId) {
    findings.push({ field: `${field}.authority.subjectId`, message: "must equal subjectId" });
  }
  if (!Array.isArray(authority.allowedActions) || !authority.allowedActions.includes(record.actionKind)) {
    findings.push({ field: `${field}.authority.allowedActions`, message: "must include actionKind" });
  } else if (new Set(authority.allowedActions).size !== authority.allowedActions.length || authority.allowedActions.some((kind) => !ACTION_KINDS.has(kind))) {
    findings.push({ field: `${field}.authority.allowedActions`, message: "must contain unique supported actions" });
  }
  if (!Array.isArray(authority.channelIds) || !authority.channelIds.includes(record.channelId)) {
    findings.push({ field: `${field}.authority.channelIds`, message: "must include channelId" });
  } else if (new Set(authority.channelIds).size !== authority.channelIds.length || authority.channelIds.some((id) => !nonEmpty(id))) {
    findings.push({ field: `${field}.authority.channelIds`, message: "must contain unique non-empty ids" });
  }
  if (!validInstant(authority.issuedAt)) {
    findings.push({ field: `${field}.authority.issuedAt`, message: "must be a valid timestamp" });
  } else {
    if (validInstant(evaluatedAt) && Date.parse(authority.issuedAt) > Date.parse(evaluatedAt)) {
      findings.push({ field: `${field}.authority.issuedAt`, message: "must not follow evaluatedAt" });
    }
    if (validInstant(record.windowOpensAt) && Date.parse(authority.issuedAt) > Date.parse(record.windowOpensAt)) {
      findings.push({ field: `${field}.authority.issuedAt`, message: "must not follow windowOpensAt" });
    }
  }
  if (!validInstant(authority.expiresAt)) {
    findings.push({ field: `${field}.authority.expiresAt`, message: "must be a valid timestamp" });
  } else if (validInstant(record.windowOpensAt) && Date.parse(authority.expiresAt) < Date.parse(record.windowOpensAt)) {
    findings.push({ field: `${field}.authority.expiresAt`, message: "must not precede windowOpensAt" });
  }
  if (authority.paidSpendCeiling !== 0) {
    findings.push({ field: `${field}.authority.paidSpendCeiling`, message: "must be exactly zero in v1" });
  }
}

function validateResponseEvent(
  event: AudienceResponseEvent,
  field: string,
  record: ResponseYieldRecord,
  observation: Extract<ResponseObservation, { state: "observed" }>,
  evaluatedAt: string | undefined,
  eventIds: Set<string>,
  findings: ValidationFinding[],
): void {
  for (const key of ["eventId", "experimentId", "contentId", "publicationId", "actionKind"] as const) {
    if (!nonEmpty(event[key])) findings.push({ field: `${field}.${key}`, message: "must be non-empty" });
  }
  if (nonEmpty(event.eventId) && eventIds.has(event.eventId)) findings.push({ field: `${field}.eventId`, message: "must be globally unique" });
  if (nonEmpty(event.eventId)) eventIds.add(event.eventId);
  for (const key of ["experimentId", "contentId", "publicationId"] as const) {
    if (event[key] !== record[key]) findings.push({ field: `${field}.${key}`, message: `must equal record.${key}` });
  }
  if (!validInstant(event.occurredAt)) {
    findings.push({ field: `${field}.occurredAt`, message: "must be a valid timestamp" });
  } else {
    if (validInstant(observation.observedAt) && Date.parse(event.occurredAt) > Date.parse(observation.observedAt)) {
      findings.push({ field: `${field}.occurredAt`, message: "must not follow responses.observedAt" });
    }
    if (validInstant(evaluatedAt) && Date.parse(event.occurredAt) > Date.parse(evaluatedAt)) {
      findings.push({ field: `${field}.occurredAt`, message: "must not follow evaluatedAt" });
    }
  }
}

/** Validate metric evidence before attempting a rate judgment. */
export function validateResponseYieldInput(value: unknown): ValidationFinding[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ field: "input", message: "must be an object" }];
  }
  const input = value as ResponseYieldInput;
  const findings: ValidationFinding[] = [];
  if (!validInstant(input.evaluatedAt)) findings.push({ field: "evaluatedAt", message: "must be a valid timestamp" });
  if (typeof input.setpointPerThousand !== "number" || !Number.isFinite(input.setpointPerThousand) || input.setpointPerThousand <= 0) {
    findings.push({ field: "setpointPerThousand", message: "must be a positive finite number" });
  }
  if (!positiveInteger(input.minimumExposureCount)) {
    findings.push({ field: "minimumExposureCount", message: "must be a positive integer" });
  }
  if (!Array.isArray(input.qualifiedActionKinds) || input.qualifiedActionKinds.length === 0) {
    findings.push({ field: "qualifiedActionKinds", message: "must be a non-empty array" });
  } else {
    const seen = new Set<string>();
    for (const [index, action] of input.qualifiedActionKinds.entries()) {
      if (!nonEmpty(action)) findings.push({ field: `qualifiedActionKinds[${index}]`, message: "must be non-empty" });
      else if (seen.has(action)) findings.push({ field: `qualifiedActionKinds[${index}]`, message: "must be unique" });
      else seen.add(action);
    }
  }
  if (!Array.isArray(input.records) || input.records.length === 0) {
    findings.push({ field: "records", message: "must be a non-empty array" });
    return findings;
  }

  const intentIds = new Set<string>();
  const publicationIds = new Set<string>();
  const eventIds = new Set<string>();
  for (const [index, recordValue] of input.records.entries()) {
    const field = `records[${index}]`;
    if (!recordValue || typeof recordValue !== "object" || Array.isArray(recordValue)) {
      findings.push({ field, message: "must be an object" });
      continue;
    }
    const record = recordValue as ResponseYieldRecord;
    for (const key of ["intentId", "subjectId", "experimentId", "contentId", "publicationId", "channelId"] as const) {
      if (!nonEmpty(record[key])) findings.push({ field: `${field}.${key}`, message: "must be non-empty" });
    }
    if (record.actionKind !== "publish" && record.actionKind !== "reply") {
      findings.push({ field: `${field}.actionKind`, message: 'must be "publish" or "reply"' });
    }
    if (nonEmpty(record.intentId) && intentIds.has(record.intentId)) findings.push({ field: `${field}.intentId`, message: "must be unique" });
    if (nonEmpty(record.intentId)) intentIds.add(record.intentId);
    if (nonEmpty(record.publicationId) && publicationIds.has(record.publicationId)) {
      findings.push({ field: `${field}.publicationId`, message: "must be unique" });
    }
    if (nonEmpty(record.publicationId)) publicationIds.add(record.publicationId);
    if (!validInstant(record.windowOpensAt)) findings.push({ field: `${field}.windowOpensAt`, message: "must be a valid timestamp" });
    if (!validInstant(record.windowClosesAt)) findings.push({ field: `${field}.windowClosesAt`, message: "must be a valid timestamp" });
    if (
      validInstant(record.windowOpensAt)
      && validInstant(record.windowClosesAt)
      && Date.parse(record.windowClosesAt) < Date.parse(record.windowOpensAt)
    ) {
      findings.push({ field: `${field}.windowClosesAt`, message: "must not precede windowOpensAt" });
    }
    validateAuthority(record, field, input.evaluatedAt, findings);

    if (validateEvidenceBase(record.exposures, `${field}.exposures`, input.evaluatedAt, findings)) {
      if (record.exposures.state === "observed" && (!Number.isInteger(record.exposures.count) || record.exposures.count < 0)) {
        findings.push({ field: `${field}.exposures.count`, message: "must be a non-negative integer" });
      }
    }
    if (validateEvidenceBase(record.responses, `${field}.responses`, input.evaluatedAt, findings)) {
      if (record.responses.state === "observed") {
        if (!Array.isArray(record.responses.events)) {
          findings.push({ field: `${field}.responses.events`, message: "must be an array" });
        } else {
          for (const [eventIndex, event] of record.responses.events.entries()) {
            if (!event || typeof event !== "object" || Array.isArray(event)) {
              findings.push({ field: `${field}.responses.events[${eventIndex}]`, message: "must be an object" });
              continue;
            }
            validateResponseEvent(
              event,
              `${field}.responses.events[${eventIndex}]`,
              record,
              record.responses,
              input.evaluatedAt,
              eventIds,
              findings,
            );
          }
        }
      }
    }
  }
  return findings;
}

/** Compute independently verified qualified audience responses per thousand eligible exposures. */
export function checkResponseYield(input: ResponseYieldInput): ResponseYieldResult {
  const findings = validateResponseYieldInput(input);
  if (findings.length > 0) {
    throw new TypeError(`Response-yield evidence is invalid: ${findings.map((finding) => `${finding.field} ${finding.message}`).join("; ")}`);
  }
  const evaluatedAt = Date.parse(input.evaluatedAt);
  const due = input.records.filter((record) => Date.parse(record.windowClosesAt) <= evaluatedAt);
  const indeterminate = (detail: string): ResponseYieldResult => ({
    state: "indeterminate",
    metric: "qualified-response-yield-per-thousand",
    qualifiedResponseCount: 0,
    eligibleExposureCount: 0,
    valuePerThousand: null,
    setpointPerThousand: input.setpointPerThousand,
    recordsDue: due.length,
    unqualifiedResponseCount: 0,
    detail,
  });
  if (due.length === 0) return indeterminate("No governed outbound publication window is due; the metric was not observed.");
  if (due.some((record) => record.exposures.state === "could-not-read" || record.responses.state === "could-not-read")) {
    return indeterminate("At least one due exposure or response evidence source could not be read.");
  }

  let eligibleExposureCount = 0;
  let qualifiedResponseCount = 0;
  let unqualifiedResponseCount = 0;
  const qualifiedKinds = new Set(input.qualifiedActionKinds);
  for (const record of due) {
    if (record.exposures.state === "observed") eligibleExposureCount += record.exposures.count;
    if (record.responses.state !== "observed") continue;
    const opens = Date.parse(record.windowOpensAt);
    const closes = Date.parse(record.windowClosesAt);
    for (const event of record.responses.events) {
      const occurred = Date.parse(event.occurredAt);
      if (qualifiedKinds.has(event.actionKind) && occurred >= opens && occurred <= closes) qualifiedResponseCount += 1;
      else unqualifiedResponseCount += 1;
    }
  }
  if (eligibleExposureCount < input.minimumExposureCount) {
    return {
      ...indeterminate(
        `Observed ${eligibleExposureCount} eligible exposures, below the declared minimum of ${input.minimumExposureCount}.`,
      ),
      qualifiedResponseCount,
      eligibleExposureCount,
      unqualifiedResponseCount,
    };
  }
  const valuePerThousand = (1_000 * qualifiedResponseCount) / eligibleExposureCount;
  const state = valuePerThousand >= input.setpointPerThousand ? "satisfied" : "violated";
  return {
    state,
    metric: "qualified-response-yield-per-thousand",
    qualifiedResponseCount,
    eligibleExposureCount,
    valuePerThousand,
    setpointPerThousand: input.setpointPerThousand,
    recordsDue: due.length,
    unqualifiedResponseCount,
    detail: `${qualifiedResponseCount} independently observed qualified responses from ${eligibleExposureCount} eligible exposures (${valuePerThousand} per thousand).`,
  };
}
