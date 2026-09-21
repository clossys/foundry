import type {
  AlternativeRelationship,
  Audience,
  ChurnRecord,
  CompareRecord,
  Familiarity,
  FeedbackRecord,
  InhabitIntent,
  InhabitRecord,
  KeepFormFinding,
  KeepFormReport,
  KeepRecord,
  KnownAlternative,
  LivedExpectation,
  LivedFunctional,
  ReferRecord,
  YesNo,
} from "./types.js";

const SPEAKER = "customer" as const;
const INHABITED_AS = "target-audience" as const;
const YES_NO = new Set<YesNo>(["yes", "no"]);
const INTENTS = new Set<InhabitIntent>(["keep", "feedback", "compare", "refer", "churn"]);
const FAMILIARITIES = new Set<Familiarity>(["fresh", "returning"]);
const RELATIONSHIPS = new Set<AlternativeRelationship>(["i-use-this", "a-peer-uses-this", "i-considered-this"]);
const REJECTED_SPEAKERS = new Set([
  "designer",
  "writer",
  "publisher",
  "inspector",
  "qa",
  "reviewer",
  "strategist",
]);
const DEFAULT_KEEP_TOPIC = "the candidate in front of me";
const INHABIT_SHAPE_RULES = new Set(["speaker-required", "speaker-not-customer", "speaker-invalid", "inhabited-as"]);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finding(rule: string, message: string, path?: string): KeepFormFinding {
  return path === undefined ? { rule, severity: "error", message } : { rule, severity: "error", message, path };
}

function yesNo(value: unknown): value is YesNo {
  return typeof value === "string" && YES_NO.has(value as YesNo);
}

function structuralFindings(findings: KeepFormFinding[]): KeepFormFinding[] {
  return findings.filter((item) => !INHABIT_SHAPE_RULES.has(item.rule));
}

function validateAudienceShape(value: unknown, findings: KeepFormFinding[]): Audience | null {
  if (!record(value)) {
    findings.push(finding("audience-shape", "Audience must be an object.", "$"));
    return null;
  }
  if (!text(value.id)) findings.push(finding("audience-id", "id must be a non-empty string.", "id"));
  if (!text(value.name)) findings.push(finding("audience-name", "name must be a non-empty string.", "name"));
  if (!text(value.description)) findings.push(finding("audience-description", "description must be a non-empty string.", "description"));
  if (value.painPoints !== undefined) {
    if (!Array.isArray(value.painPoints)) {
      findings.push(finding("audience-pain-points", "painPoints must be an array of strings when present.", "painPoints"));
    } else {
      value.painPoints.forEach((item, index) => {
        if (!text(item)) findings.push(finding("audience-pain-point", "Each pain point must be a non-empty string.", `painPoints[${index}]`));
      });
    }
  }
  if (!text(value.id) || !text(value.name) || !text(value.description)) return null;
  const painPoints =
    value.painPoints === undefined
      ? undefined
      : Array.isArray(value.painPoints)
        ? value.painPoints.filter(text)
        : undefined;
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    ...(painPoints !== undefined ? { painPoints } : {}),
  };
}

function envelopeFields(value: UnknownRecord): { audienceId: string; personaName: string; stance: string } | null {
  const persona = value.persona;
  if (!text(value.audienceId) || !record(persona) || !text(persona.name) || !text(value.stance)) return null;
  return { audienceId: value.audienceId, personaName: persona.name, stance: value.stance };
}

function inhabitShapeFindings(value: UnknownRecord): KeepFormFinding[] {
  const inhabit: KeepFormFinding[] = [];
  if (typeof value.speaker !== "string") {
    inhabit.push(finding("speaker-required", "speaker must be a string.", "speaker"));
  } else if (value.speaker !== SPEAKER) {
    if (REJECTED_SPEAKERS.has(value.speaker)) {
      inhabit.push(
        finding("speaker-not-customer", `speaker "${value.speaker}" is not the customer inhabit; only "${SPEAKER}" is allowed.`, "speaker"),
      );
    } else {
      inhabit.push(finding("speaker-invalid", `speaker must be exactly "${SPEAKER}".`, "speaker"));
    }
  }
  if (value.inhabitedAs !== INHABITED_AS) {
    inhabit.push(finding("inhabited-as", `inhabitedAs must be exactly "${INHABITED_AS}".`, "inhabitedAs"));
  }
  return inhabit;
}

function envelopeBase(value: UnknownRecord, findings: KeepFormFinding[]): void {
  findings.push(...inhabitShapeFindings(value));
  if (!text(value.audienceId)) findings.push(finding("audience-id-required", "audienceId must be a non-empty string.", "audienceId"));
  if (!record(value.persona) || !text(value.persona.name)) {
    findings.push(finding("persona-name", "persona.name must be a non-empty string.", "persona.name"));
  }
  if (!text(value.stance)) findings.push(finding("stance-required", "stance must be a non-empty string.", "stance"));
}

function resolveIntent(value: UnknownRecord, findings: KeepFormFinding[]): InhabitIntent | null {
  if (value.intent === undefined) return "keep";
  if (typeof value.intent !== "string") {
    findings.push(finding("intent-unknown", 'intent must be "keep", "feedback", "compare", "refer", or "churn".', "intent"));
    return null;
  }
  if (!INTENTS.has(value.intent as InhabitIntent)) {
    findings.push(finding("intent-unknown", `Unknown intent "${value.intent}".`, "intent"));
    return null;
  }
  return value.intent as InhabitIntent;
}

function resolveFamiliarity(value: UnknownRecord, intent: InhabitIntent, findings: KeepFormFinding[]): Familiarity | null {
  if (value.familiarity === undefined) {
    if (intent === "keep") return "fresh";
    findings.push(finding("familiarity-required", 'familiarity must be "fresh" or "returning".', "familiarity"));
    return null;
  }
  if (typeof value.familiarity !== "string" || !FAMILIARITIES.has(value.familiarity as Familiarity)) {
    findings.push(finding("familiarity-required", 'familiarity must be "fresh" or "returning".', "familiarity"));
    return null;
  }
  return value.familiarity as Familiarity;
}

function resolveTopic(value: UnknownRecord, intent: InhabitIntent, findings: KeepFormFinding[]): string | null {
  if (value.topic === undefined) {
    if (intent === "keep") return DEFAULT_KEEP_TOPIC;
    findings.push(finding("topic-required", "topic must be a non-empty string naming what they asked me.", "topic"));
    return null;
  }
  if (!text(value.topic)) {
    findings.push(finding("topic-required", "topic must be a non-empty string naming what they asked me.", "topic"));
    return null;
  }
  return value.topic;
}

function readLivedFunctional(value: unknown, path: string, findings: KeepFormFinding[]): LivedFunctional | null {
  if (!record(value) || !text(value.happened) || !text(value.expected)) {
    findings.push(finding("functional-item", "Each functional item needs nonempty happened and expected.", path));
    return null;
  }
  return { happened: value.happened, expected: value.expected };
}

function readLivedExpectation(value: unknown, path: string, findings: KeepFormFinding[]): LivedExpectation | null {
  if (!record(value) || !text(value.assumed) || !text(value.actually)) {
    findings.push(finding("expectation-item", "Each expectation item needs nonempty assumed and actually.", path));
    return null;
  }
  return { assumed: value.assumed, actually: value.actually };
}

function readAlternative(value: unknown, path: string, findings: KeepFormFinding[]): KnownAlternative | null {
  if (!record(value) || !text(value.name) || !text(value.whyItMatters)) {
    findings.push(finding("alternative-item", "Each alternative needs nonempty name and whyItMatters.", path));
    return null;
  }
  if (typeof value.relationship !== "string" || !RELATIONSHIPS.has(value.relationship as AlternativeRelationship)) {
    findings.push(
      finding(
        "alternative-relationship",
        'relationship must be "i-use-this", "a-peer-uses-this", or "i-considered-this".',
        `${path}.relationship`,
      ),
    );
    return null;
  }
  return { name: value.name, relationship: value.relationship as AlternativeRelationship, whyItMatters: value.whyItMatters };
}

function parseKeepSession(
  value: UnknownRecord,
  topic: string,
  familiarity: Familiarity,
  findings: KeepFormFinding[],
): KeepRecord | null {
  if (!record(value.impressions)) {
    findings.push(finding("impressions-shape", "impressions must be an object.", "impressions"));
  } else {
    if (!text(value.impressions.firstSeconds)) {
      findings.push(finding("first-seconds", "impressions.firstSeconds must be a non-empty string.", "impressions.firstSeconds"));
    }
    for (const field of ["isThisForMe", "doIBelieve", "wouldIStay", "wouldITellAPeer"] as const) {
      if (!yesNo(value.impressions[field])) {
        findings.push(finding("impression-yes-no", `${field} must be exactly "yes" or "no".`, `impressions.${field}`));
      }
    }
  }
  if (!record(value.visual) || !text(value.visual.impression)) {
    findings.push(finding("visual-impression", "visual.impression must be a non-empty string.", "visual.impression"));
  }
  if (!record(value.verbal) || !text(value.verbal.impression)) {
    findings.push(finding("verbal-impression", "verbal.impression must be a non-empty string.", "verbal.impression"));
  }
  if (value.verdict !== "keep" && value.verdict !== "fail") {
    findings.push(finding("verdict-required", 'verdict must be "keep" or "fail".', "verdict"));
  }

  const shapeOk =
    value.speaker === SPEAKER &&
    value.inhabitedAs === INHABITED_AS &&
    text(value.audienceId) &&
    record(value.persona) &&
    text(value.persona.name) &&
    text(value.stance) &&
    record(value.impressions) &&
    text(value.impressions.firstSeconds) &&
    yesNo(value.impressions.isThisForMe) &&
    yesNo(value.impressions.doIBelieve) &&
    yesNo(value.impressions.wouldIStay) &&
    yesNo(value.impressions.wouldITellAPeer) &&
    record(value.visual) &&
    text(value.visual.impression) &&
    record(value.verbal) &&
    text(value.verbal.impression) &&
    (value.verdict === "keep" || value.verdict === "fail");

  if (!shapeOk) return null;

  const persona = value.persona as UnknownRecord;
  const impressions = value.impressions as UnknownRecord;
  const visual = value.visual as UnknownRecord;
  const verbal = value.verbal as UnknownRecord;

  return {
    speaker: SPEAKER,
    inhabitedAs: INHABITED_AS,
    audienceId: value.audienceId as string,
    persona: { name: persona.name as string },
    stance: value.stance as string,
    topic,
    familiarity,
    intent: "keep",
    impressions: {
      firstSeconds: impressions.firstSeconds as string,
      isThisForMe: impressions.isThisForMe as YesNo,
      doIBelieve: impressions.doIBelieve as YesNo,
      wouldIStay: impressions.wouldIStay as YesNo,
      wouldITellAPeer: impressions.wouldITellAPeer as YesNo,
    },
    visual: { impression: visual.impression as string },
    verbal: { impression: verbal.impression as string },
    verdict: value.verdict as KeepRecord["verdict"],
  };
}

function parseFeedbackSession(
  value: UnknownRecord,
  topic: string,
  familiarity: Familiarity,
  findings: KeepFormFinding[],
): FeedbackRecord | null {
  if (!Array.isArray(value.functional)) {
    findings.push(finding("functional-shape", "functional must be an array of lived { happened, expected } items.", "functional"));
  }
  if (!Array.isArray(value.experience)) {
    findings.push(finding("experience-required", "experience must be a nonempty array of first-person strings.", "experience"));
  } else {
    value.experience.forEach((item, index) => {
      if (!text(item)) findings.push(finding("experience-item", "Each experience entry must be a non-empty string.", `experience[${index}]`));
    });
  }
  if (!Array.isArray(value.expectations)) {
    findings.push(finding("expectations-shape", "expectations must be an array of { assumed, actually } items.", "expectations"));
  }
  if (!yesNo(value.stillForMe)) {
    findings.push(finding("still-for-me", 'stillForMe must be exactly "yes" or "no".', "stillForMe"));
  }

  const functional = Array.isArray(value.functional)
    ? value.functional.map((item, index) => readLivedFunctional(item, `functional[${index}]`, findings))
    : [];
  const expectations = Array.isArray(value.expectations)
    ? value.expectations.map((item, index) => readLivedExpectation(item, `expectations[${index}]`, findings))
    : [];
  const experienceOk = Array.isArray(value.experience) && value.experience.every(text);
  const functionalOk = Array.isArray(value.functional) && functional.every((item) => item !== null);
  const expectationsOk = Array.isArray(value.expectations) && expectations.every((item) => item !== null);
  const envelopeOk =
    value.speaker === SPEAKER &&
    value.inhabitedAs === INHABITED_AS &&
    text(value.audienceId) &&
    record(value.persona) &&
    text(value.persona.name) &&
    text(value.stance);

  if (!envelopeOk || !experienceOk || !functionalOk || !expectationsOk || !yesNo(value.stillForMe)) return null;
  const envelope = envelopeFields(value);
  if (!envelope) return null;

  return {
    speaker: SPEAKER,
    inhabitedAs: INHABITED_AS,
    audienceId: envelope.audienceId,
    persona: { name: envelope.personaName },
    stance: envelope.stance,
    topic,
    familiarity,
    intent: "feedback",
    functional: functional as LivedFunctional[],
    experience: value.experience as string[],
    expectations: expectations as LivedExpectation[],
    stillForMe: value.stillForMe as YesNo,
  };
}

function parseCompareSession(
  value: UnknownRecord,
  topic: string,
  familiarity: Familiarity,
  findings: KeepFormFinding[],
): CompareRecord | null {
  if (!Array.isArray(value.alternatives)) {
    findings.push(finding("alternatives-required", "compare requires a nonempty alternatives array from my actual consideration set.", "alternatives"));
  }
  if (!text(value.versus)) findings.push(finding("versus-required", "versus must be a nonempty first-person narrative.", "versus"));
  if (!yesNo(value.iWouldSwitch)) findings.push(finding("would-switch", 'iWouldSwitch must be exactly "yes" or "no".', "iWouldSwitch"));
  if (!text(value.whatKeepsMeHere)) findings.push(finding("keeps-me-required", "whatKeepsMeHere must be a nonempty string.", "whatKeepsMeHere"));
  if (!text(value.whatWouldMakeMeSwitch)) {
    findings.push(finding("switch-trigger-required", "whatWouldMakeMeSwitch must be a nonempty string.", "whatWouldMakeMeSwitch"));
  }

  const alternatives = Array.isArray(value.alternatives)
    ? value.alternatives.map((item, index) => readAlternative(item, `alternatives[${index}]`, findings))
    : [];
  const alternativesOk = Array.isArray(value.alternatives) && alternatives.every((item) => item !== null);
  const envelopeOk =
    value.speaker === SPEAKER &&
    value.inhabitedAs === INHABITED_AS &&
    text(value.audienceId) &&
    record(value.persona) &&
    text(value.persona.name) &&
    text(value.stance);

  if (
    !envelopeOk ||
    !alternativesOk ||
    !text(value.versus) ||
    !yesNo(value.iWouldSwitch) ||
    !text(value.whatKeepsMeHere) ||
    !text(value.whatWouldMakeMeSwitch)
  ) {
    return null;
  }
  const envelope = envelopeFields(value);
  if (!envelope) return null;

  return {
    speaker: SPEAKER,
    inhabitedAs: INHABITED_AS,
    audienceId: envelope.audienceId,
    persona: { name: envelope.personaName },
    stance: envelope.stance,
    topic,
    familiarity,
    intent: "compare",
    alternatives: alternatives as KnownAlternative[],
    versus: value.versus as string,
    iWouldSwitch: value.iWouldSwitch as YesNo,
    whatKeepsMeHere: value.whatKeepsMeHere as string,
    whatWouldMakeMeSwitch: value.whatWouldMakeMeSwitch as string,
  };
}

function parseReferSession(
  value: UnknownRecord,
  topic: string,
  familiarity: Familiarity,
  findings: KeepFormFinding[],
): ReferRecord | null {
  if (!yesNo(value.wouldITellAPeer)) {
    findings.push(finding("would-tell-peer", 'wouldITellAPeer must be exactly "yes" or "no".', "wouldITellAPeer"));
  }
  if (!text(value.whatIdSay)) findings.push(finding("what-id-say", "whatIdSay must be the actual words I would use.", "whatIdSay"));
  if (!text(value.whatStopsMe)) findings.push(finding("what-stops-me", "whatStopsMe must be a nonempty first-person sentence.", "whatStopsMe"));
  if (!text(value.whoIdTell)) findings.push(finding("who-id-tell", "whoIdTell must name a kind of person, never a private name.", "whoIdTell"));

  const envelopeOk =
    value.speaker === SPEAKER &&
    value.inhabitedAs === INHABITED_AS &&
    text(value.audienceId) &&
    record(value.persona) &&
    text(value.persona.name) &&
    text(value.stance);

  if (!envelopeOk || !yesNo(value.wouldITellAPeer) || !text(value.whatIdSay) || !text(value.whatStopsMe) || !text(value.whoIdTell)) {
    return null;
  }
  const envelope = envelopeFields(value);
  if (!envelope) return null;

  return {
    speaker: SPEAKER,
    inhabitedAs: INHABITED_AS,
    audienceId: envelope.audienceId,
    persona: { name: envelope.personaName },
    stance: envelope.stance,
    topic,
    familiarity,
    intent: "refer",
    wouldITellAPeer: value.wouldITellAPeer as YesNo,
    whatIdSay: value.whatIdSay as string,
    whatStopsMe: value.whatStopsMe as string,
    whoIdTell: value.whoIdTell as string,
  };
}

function parseChurnSession(
  value: UnknownRecord,
  topic: string,
  familiarity: Familiarity,
  findings: KeepFormFinding[],
): ChurnRecord | null {
  if (!yesNo(value.wouldILeave)) findings.push(finding("would-leave", 'wouldILeave must be exactly "yes" or "no".', "wouldILeave"));
  if (!text(value.theMoment)) findings.push(finding("the-moment", "theMoment must describe the scene where I go.", "theMoment"));
  if (!text(value.whatWouldKeepMe)) findings.push(finding("what-would-keep-me", "whatWouldKeepMe must be a nonempty string.", "whatWouldKeepMe"));
  if (!text(value.whereIdGo)) findings.push(finding("where-id-go", "whereIdGo must name where I would actually go.", "whereIdGo"));

  const envelopeOk =
    value.speaker === SPEAKER &&
    value.inhabitedAs === INHABITED_AS &&
    text(value.audienceId) &&
    record(value.persona) &&
    text(value.persona.name) &&
    text(value.stance);

  if (!envelopeOk || !yesNo(value.wouldILeave) || !text(value.theMoment) || !text(value.whatWouldKeepMe) || !text(value.whereIdGo)) {
    return null;
  }
  const envelope = envelopeFields(value);
  if (!envelope) return null;

  return {
    speaker: SPEAKER,
    inhabitedAs: INHABITED_AS,
    audienceId: envelope.audienceId,
    persona: { name: envelope.personaName },
    stance: envelope.stance,
    topic,
    familiarity,
    intent: "churn",
    wouldILeave: value.wouldILeave as YesNo,
    theMoment: value.theMoment as string,
    whatWouldKeepMe: value.whatWouldKeepMe as string,
    whereIdGo: value.whereIdGo as string,
  };
}

function validateInhabitShape(value: unknown, findings: KeepFormFinding[]): InhabitRecord | null {
  if (!record(value)) {
    findings.push(finding("keep-shape", "Inhabit record must be an object.", "$"));
    return null;
  }
  envelopeBase(value, findings);
  const intent = resolveIntent(value, findings);
  if (intent === null) return null;
  const familiarity = resolveFamiliarity(value, intent, findings);
  const topic = resolveTopic(value, intent, findings);
  if (familiarity === null || topic === null) return null;
  if (intent === "keep") return parseKeepSession(value, topic, familiarity, findings);
  if (intent === "feedback") return parseFeedbackSession(value, topic, familiarity, findings);
  if (intent === "compare") return parseCompareSession(value, topic, familiarity, findings);
  if (intent === "refer") return parseReferSession(value, topic, familiarity, findings);
  return parseChurnSession(value, topic, familiarity, findings);
}

function inhabitFindings(session: InhabitRecord, audience: Audience): KeepFormFinding[] {
  const findings: KeepFormFinding[] = [];
  if (session.audienceId !== audience.id) {
    findings.push(
      finding("audience-id-mismatch", `Keep audienceId "${session.audienceId}" does not match Audience id "${audience.id}".`, "audienceId"),
    );
  }
  if (session.persona.name !== audience.name) {
    findings.push(
      finding("persona-name-mismatch", `persona.name "${session.persona.name}" does not match Audience name "${audience.name}".`, "persona.name"),
    );
  }
  const painPoints = audience.painPoints?.filter(text) ?? [];
  if (painPoints.length > 0) {
    const cited = painPoints.some((point) => session.stance.includes(point));
    if (!cited) {
      findings.push(finding("stance-pain-point", "stance must cite at least one Audience pain point when painPoints is non-empty.", "stance"));
    }
  }
  if (session.intent === "feedback" && session.experience.length === 0) {
    findings.push(finding("experience-required", "experience must be a nonempty array of first-person strings.", "experience"));
  }
  if (session.intent === "compare" && session.alternatives.length === 0) {
    findings.push(
      finding("alternatives-required", "compare requires a nonempty alternatives array from my actual consideration set.", "alternatives"),
    );
  }
  if (session.intent === "keep" && session.verdict === "keep") {
    for (const field of ["isThisForMe", "doIBelieve", "wouldIStay", "wouldITellAPeer"] as const) {
      if (session.impressions[field] === "no") {
        findings.push(
          finding("keep-with-no-impression", `verdict "keep" cannot coexist with impressions.${field} "no".`, `impressions.${field}`),
        );
      }
    }
  }
  return findings;
}

/** Parses an Audience JSON seam or throws every shape finding. */
export function parseAudience(input: unknown): Audience {
  const findings: KeepFormFinding[] = [];
  const audience = validateAudienceShape(input, findings);
  if (!audience) {
    const detail = findings.map((item) => `  - ${item.path ?? "(root)"}: ${item.message}`).join("\n");
    throw new Error(`parseAudience: value is not a valid Audience:\n${detail}`);
  }
  return audience;
}

/** Parses any inhabit session (keep, feedback, compare, refer, churn). */
export function parseInhabitRecord(input: unknown): InhabitRecord {
  const findings: KeepFormFinding[] = [];
  const session = validateInhabitShape(input, findings);
  if (!session) {
    const detail = findings.map((item) => `  - ${item.path ?? "(root)"}: ${item.message}`).join("\n");
    throw new Error(`parseInhabitRecord: value is not a valid inhabit record:\n${detail}`);
  }
  return session;
}

/** Parses a first-person keep record or throws every shape finding. */
export function parseKeepRecord(input: unknown): KeepRecord {
  const session = parseInhabitRecord(input);
  if (session.intent !== "keep") {
    throw new Error(`parseKeepRecord: intent "${session.intent}" is not a keep session; use parseInhabitRecord.`);
  }
  return session;
}

/**
 * Validates inhabit form for keep, feedback, compare, refer, and churn.
 * Unreadable shapes are indeterminate; inhabit findings are violated.
 */
export function checkInhabitForm(session: unknown, audience: unknown): KeepFormReport {
  const findings: KeepFormFinding[] = [];
  const parsedAudience = validateAudienceShape(audience, findings);
  const audienceStructural = [...findings];
  findings.length = 0;
  const parsedSession = validateInhabitShape(session, findings);
  const inhabitShape = findings.filter((item) => INHABIT_SHAPE_RULES.has(item.rule));
  const keepStructural = structuralFindings(findings);
  const allStructural = [...audienceStructural, ...keepStructural];

  if (inhabitShape.length > 0) {
    return { state: "violated", findings: inhabitShape };
  }
  if (allStructural.length > 0 || !parsedAudience || !parsedSession) {
    return { state: "indeterminate", findings: allStructural };
  }
  const inhabit = inhabitFindings(parsedSession, parsedAudience);
  if (inhabit.length > 0) return { state: "violated", findings: inhabit };
  return { state: "satisfied", findings: [] };
}

/** Alias: keep-form is inhabit-form, including speed-dial testimony intents. */
export function checkKeepForm(keep: unknown, audience: unknown): KeepFormReport {
  return checkInhabitForm(keep, audience);
}
