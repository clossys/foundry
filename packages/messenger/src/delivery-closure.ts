import type {
  DeliveryClosureInput,
  DeliveryClosureRecord,
  DeliveryClosureResult,
  ValidationFinding,
} from "./types.js";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validInstant(value: unknown): value is string {
  return nonEmpty(value) && !Number.isNaN(Date.parse(value));
}

/** Validate gate evidence separately so malformed evidence never becomes a metric failure. */
export function validateDeliveryClosureInput(value: unknown): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ field: "input", message: "must be an object" }];
  }
  const input = value as Partial<DeliveryClosureInput>;
  if (!validInstant(input.evaluatedAt)) findings.push({ field: "evaluatedAt", message: "must be a valid timestamp" });
  if (typeof input.setpoint !== "number" || !Number.isFinite(input.setpoint) || input.setpoint <= 0 || input.setpoint > 1) {
    findings.push({ field: "setpoint", message: "must be a finite number greater than 0 and at most 1" });
  }
  if (!Array.isArray(input.records) || input.records.length === 0) {
    findings.push({ field: "records", message: "must be a non-empty array" });
    return findings;
  }

  const ids = new Set<string>();
  for (const [index, recordValue] of input.records.entries()) {
    const field = `records[${index}]`;
    if (!recordValue || typeof recordValue !== "object" || Array.isArray(recordValue)) {
      findings.push({ field, message: "must be an object" });
      continue;
    }
    const record = recordValue as DeliveryClosureRecord;
    if (!nonEmpty(record.intentId)) findings.push({ field: `${field}.intentId`, message: "must be non-empty" });
    else if (ids.has(record.intentId)) findings.push({ field: `${field}.intentId`, message: "must be unique" });
    else ids.add(record.intentId);
    if (!record.authorization || typeof record.authorization !== "object" || Array.isArray(record.authorization)) {
      findings.push({ field: `${field}.authorization`, message: "must be an evidence object" });
    } else {
      if (!nonEmpty(record.authorization.id)) {
        findings.push({ field: `${field}.authorization.id`, message: "must be non-empty" });
      }
      if (!nonEmpty(record.authorization.intentId)) {
        findings.push({ field: `${field}.authorization.intentId`, message: "must be non-empty" });
      } else if (record.authorization.intentId !== record.intentId) {
        findings.push({ field: `${field}.authorization.intentId`, message: "must equal intentId" });
      }
      if (!nonEmpty(record.authorization.policy)) {
        findings.push({ field: `${field}.authorization.policy`, message: "must be non-empty" });
      }
      if (!validInstant(record.authorization.authorizedAt)) {
        findings.push({ field: `${field}.authorization.authorizedAt`, message: "must be a valid timestamp" });
      } else if (
        validInstant(input.evaluatedAt)
        && Date.parse(record.authorization.authorizedAt) > Date.parse(input.evaluatedAt)
      ) {
        findings.push({ field: `${field}.authorization.authorizedAt`, message: "must not follow evaluatedAt" });
      }
    }
    if (!validInstant(record.windowOpensAt)) {
      findings.push({ field: `${field}.windowOpensAt`, message: "must be a valid timestamp" });
    }
    if (!validInstant(record.windowClosesAt)) {
      findings.push({ field: `${field}.windowClosesAt`, message: "must be a valid timestamp" });
    }
    if (
      validInstant(record.windowOpensAt)
      && validInstant(record.windowClosesAt)
      && Date.parse(record.windowClosesAt) < Date.parse(record.windowOpensAt)
    ) {
      findings.push({ field: `${field}.windowClosesAt`, message: "must not precede windowOpensAt" });
    }

    const observation = record.observation;
    if (observation === undefined) continue;
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      findings.push({ field: `${field}.observation`, message: "must be an object" });
      continue;
    }
    if (!nonEmpty(observation.eventId)) findings.push({ field: `${field}.observation.eventId`, message: "must be non-empty" });
    if (!nonEmpty(observation.evidenceSource)) {
      findings.push({ field: `${field}.observation.evidenceSource`, message: "must be non-empty" });
    }
    if (observation.outcome !== "delivered" && observation.outcome !== "failed") {
      findings.push({ field: `${field}.observation.outcome`, message: 'must be "delivered" or "failed"' });
    }
    if (!validInstant(observation.observedAt)) {
      findings.push({ field: `${field}.observation.observedAt`, message: "must be a valid timestamp" });
    }
    if (observation.outcome === "delivered" && !validInstant(observation.deliveredAt)) {
      findings.push({ field: `${field}.observation.deliveredAt`, message: "must be a valid timestamp for delivered outcomes" });
    }
    if (observation.outcome === "failed" && observation.deliveredAt !== undefined) {
      findings.push({ field: `${field}.observation.deliveredAt`, message: "must be absent for failed outcomes" });
    }
    if (
      validInstant(observation.observedAt)
      && validInstant(input.evaluatedAt)
      && Date.parse(observation.observedAt) > Date.parse(input.evaluatedAt)
    ) {
      findings.push({ field: `${field}.observation.observedAt`, message: "must not follow evaluatedAt" });
    }
    if (
      validInstant(observation.deliveredAt)
      && validInstant(observation.observedAt)
      && Date.parse(observation.deliveredAt) > Date.parse(observation.observedAt)
    ) {
      findings.push({ field: `${field}.observation.deliveredAt`, message: "must not follow observedAt" });
    }
  }
  return findings;
}

/**
 * Compute timely verified delivery rate:
 * independently observed due intents delivered within their declared window
 * divided by all authorized intents whose declared delivery window is due.
 */
export function checkDeliveryClosure(input: DeliveryClosureInput): DeliveryClosureResult {
  const findings = validateDeliveryClosureInput(input);
  if (findings.length > 0) {
    throw new TypeError(`Delivery closure evidence is invalid: ${findings.map((finding) => `${finding.field} ${finding.message}`).join("; ")}`);
  }

  const evaluatedAt = Date.parse(input.evaluatedAt);
  const due = input.records.filter((record) => Date.parse(record.windowClosesAt) <= evaluatedAt);
  if (due.length === 0) {
    return {
      state: "indeterminate",
      metric: "timely-verified-delivery-rate",
      numerator: 0,
      denominator: 0,
      value: null,
      setpoint: input.setpoint,
      missingIntentIds: [],
      lateIntentIds: [],
      failedIntentIds: [],
      detail: "No authorized delivery intent is due; the metric was not observed.",
    };
  }

  const timely: string[] = [];
  const missing: string[] = [];
  const late: string[] = [];
  const failed: string[] = [];
  for (const record of due) {
    const observation = record.observation;
    if (!observation) {
      missing.push(record.intentId);
      continue;
    }
    if (observation.outcome === "failed") {
      failed.push(record.intentId);
      continue;
    }
    const deliveredAt = Date.parse(observation.deliveredAt as string);
    if (deliveredAt >= Date.parse(record.windowOpensAt) && deliveredAt <= Date.parse(record.windowClosesAt)) {
      timely.push(record.intentId);
    } else {
      late.push(record.intentId);
    }
  }

  const value = timely.length / due.length;
  const state = value >= input.setpoint ? "satisfied" : "violated";
  return {
    state,
    metric: "timely-verified-delivery-rate",
    numerator: timely.length,
    denominator: due.length,
    value,
    setpoint: input.setpoint,
    missingIntentIds: missing,
    lateIntentIds: late,
    failedIntentIds: failed,
    detail: `${timely.length} of ${due.length} authorized delivery intents due were independently observed delivered within their declared window.`,
  };
}
