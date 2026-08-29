/**
 * The task-record check.
 *
 * A task record is the link between a proposed change and the tracked work
 * item that asked for it. The check asks one question — does this change
 * name a work item, in a shape that resolves to a real tracked item — and it
 * asks it about caller-supplied observations, never by reaching for a
 * tracker itself.
 *
 * THREE THINGS THIS SEPARATES THAT ARE EASY TO COLLAPSE
 * -----------------------------------------------------
 * 1. *No reference was given.* That is a real finding about the change:
 *    someone opened a change with no stated reason. `violated`.
 * 2. *A reference was given and does not resolve.* Also `violated` — but
 *    only when the caller actually looked and actually got an answer.
 * 3. *A reference was given and could not be looked up.* A tracker that
 *    returned a permission error, a reference pointing outside the scope the
 *    caller's credential can read, a lookup that was never attempted:
 *    `indeterminate`. A credential-scoped tracker commonly answers
 *    "not found" for an item that exists but is not visible, and treating
 *    that as proof of absence would fail changes for a reason that is about
 *    the credential rather than the change.
 *
 * STRUCTURAL EXEMPTIONS ARE PART OF THE CHECK, NOT AN ESCAPE HATCH
 * -----------------------------------------------------------------
 * Automated changes — a dependency bot's version bump, a release-automation
 * branch — have no work item and never will, because no person asked for
 * them individually. A check that fails them teaches its consumers to route
 * around it, which costs more than the check earns. So exemptions are
 * modelled as first-class policy: the consuming repository declares, as
 * data, which authors, branch prefixes, and labels are exempt, and an
 * exemption that fires is reported by name in the result rather than
 * disappearing into a silent pass. Nothing here has a default exemption; an
 * exemption this package invented would be an exemption no consumer chose.
 *
 * Zero I/O. Pure function of already-collected observations.
 */

import { createGateReasons, gateSatisfied, gateViolated } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import { isRecord, isStringArray } from "./shape.js";
import type { CheckFinding } from "./types.js";

/** How a caller's attempt to resolve a referenced work item ended. */
export type TaskItemLookupOutcome =
  /** The item was read and is a tracked work item. */
  | "resolved"
  /** The item was read and is not a work item at all (e.g. it is another proposed change). */
  | "resolved-wrong-kind"
  /** The tracker answered, and the answer was "no such item, or not visible to this credential". */
  | "not-visible"
  /** The tracker could not be reached, or answered with an error. */
  | "unavailable"
  /** No lookup was made. */
  | "not-attempted";

/**
 * The same vocabulary as a value, so a caller-supplied outcome can be
 * checked against it at runtime. The type alone is erased before any
 * observation is read, and an outcome outside this list must never be able
 * to fall through the branches that interpret it into the satisfied result
 * they all precede.
 */
export const TASK_ITEM_LOOKUP_OUTCOMES = Object.freeze([
  "resolved",
  "resolved-wrong-kind",
  "not-visible",
  "unavailable",
  "not-attempted",
] as const);

/** What the caller found out about the referenced item, if anything. */
export interface TaskItemObservation {
  readonly outcome: TaskItemLookupOutcome;
  /** A human-facing title, when the tracker supplied one. Purely descriptive. */
  readonly title?: string;
  /** Free-text detail from the tracker, for the report. */
  readonly detail?: string;
}

/** Everything observed about one proposed change. All caller-supplied; none discovered here. */
export interface TaskRecordObservation {
  /** What triggered this run, in the caller's own vocabulary. */
  readonly eventKind: string;
  /** The change's description text, which is where a work-item reference is looked for. */
  readonly description: string;
  /** Opaque author identifier. */
  readonly authorId: string;
  /** The source branch name. */
  readonly headRef: string;
  /** Labels attached to the change. */
  readonly labels: readonly string[];
  /**
   * The scope the caller's tracker credential can read, opaque and compared
   * only for equality (case-insensitively). A reference naming a different
   * scope is `indeterminate`, never a finding.
   */
  readonly trackerScope: string;
  /** The caller's lookup result for whatever reference was extracted, if it made one. */
  readonly item?: TaskItemObservation;
}

/** The consuming repository's own requirements. Every field is required; nothing is defaulted. */
export interface TaskRecordPolicy {
  /** Event kinds this check is meaningful for. A run outside them is `indeterminate`, never a pass. */
  readonly applicableEventKinds: readonly string[];
  /** Literal labels whose presence exempts a change. May be empty. */
  readonly exemptLabels: readonly string[];
  /** Author-identifier suffixes that exempt a change (an automation marker). May be empty. */
  readonly exemptAuthorSuffixes: readonly string[];
  /** Branch-name prefixes that exempt a change. May be empty. */
  readonly exemptHeadRefPrefixes: readonly string[];
  /**
   * The literal field labels a work-item reference may be introduced by, e.g.
   * `["Work item"]`. Matched case-insensitively, with optional surrounding
   * emphasis markers, and escaped before use — a caller's label is data, and
   * data spliced unescaped into a pattern is a pattern the caller did not
   * write.
   */
  readonly recordLabels: readonly string[];
  /**
   * Whether the referenced item must have been confirmed to exist. `false`
   * checks the reference's shape only, and says so in the result rather than
   * implying more than it checked.
   */
  readonly requireResolvedItem: boolean;
}

/** Every reason this check can decline to answer. */
export const taskRecordReasons = createGateReasons([
  "no-observation-supplied",
  "no-policy-supplied",
  "policy-invalid",
  "observation-invalid",
  "not-applicable-event",
  "item-lookup-not-attempted",
  "item-lookup-unavailable",
  "item-not-visible",
  "item-outside-tracker-scope",
] as const);

export type TaskRecordReason = (typeof taskRecordReasons.reasons)[number];

/** One reportable problem with a change's task record. */
export interface TaskRecordFinding extends CheckFinding {
  readonly rule: "task-record-missing" | "task-record-unparseable" | "task-record-wrong-kind";
}

/** A work-item reference pulled out of a change description. */
export interface ParsedTaskReference {
  /** The reference exactly as written. */
  readonly raw: string;
  /** The tracker scope it names, defaulting to the observation's own scope for a bare number. */
  readonly scope: string;
  /** The item's number within that scope. */
  readonly number: string;
}

function finding(rule: TaskRecordFinding["rule"], path: string, message: string): TaskRecordFinding {
  return { rule, severity: "error", path, message };
}

/** Escapes a caller-supplied literal so it can appear safely inside a pattern. */
function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips regions delimited by HTML comment markers (`<!-- ... -->`) before
 * any label is matched.
 *
 * An automated reviewer that appends a section to a description commonly
 * fences its own markers this way — invisible when the description renders,
 * present in the raw text this check actually reads. No legitimate task
 * record is ever written inside a generated, fenced region, so removing it
 * first removes a whole class of false positives in one place rather than
 * teaching every downstream rule about it individually.
 *
 * Replaced with a newline rather than deleted outright, so text that sat
 * before and after an inline comment on the same physical line is never
 * glued into a new false anchor by the removal itself.
 */
function stripGeneratedRegions(description: string): string {
  const retained: string[] = [];
  let cursor = 0;
  while (cursor < description.length) {
    const open = description.indexOf("<!--", cursor);
    if (open === -1) {
      retained.push(description.slice(cursor));
      break;
    }
    const close = description.indexOf("-->", open + 4);
    if (close === -1) {
      retained.push(description.slice(cursor));
      break;
    }
    retained.push(description.slice(cursor, open), "\n");
    cursor = close + 3;
  }
  return retained.join("");
}

/**
 * Every token that follows a declared label at the START of one of the
 * description's lines, in the order the lines appear, label by label.
 *
 * ANCHORED TO LINE START, NOT MATCHED ANYWHERE
 * ----------------------------------------------
 * The earlier arrangement matched a configured label as a bare, case-
 * insensitive substring anywhere it occurred, including mid-sentence. Two
 * confirmed failures came from exactly that: "...the header comment
 * describes and already fixes for every other root-install caller" matched
 * `fixes` and returned `for`, and a generated `* **Bug Fixes**` heading
 * matched `Fixes` and returned `*` — the token that opened the following
 * bullet.
 *
 * A record plausibly begins at the start of a line, optionally behind
 * nothing but Markdown decoration — a list or blockquote marker, a heading
 * marker, emphasis, a code-span backtick — never behind an actual word. The
 * permitted-prefix character class below is exactly that decoration set; it
 * contains no letters or digits, so any real word sitting between the start
 * of the line and the label (`the header comment describes and already ` in
 * the first failure, `Bug ` in the second) leaves nothing for the label to
 * match against at that position and the line is skipped. This is also why
 * the second failure needs no special case beyond ordinary anchoring:
 * `Fixes` inside `Bug Fixes` is preceded by the word `Bug`, which is not
 * decoration, so it never becomes a candidate regardless of what follows it.
 *
 * MATCHING IS PER LINE, SO THE CAPTURE CAN NEVER CROSS A LINE
 * --------------------------------------------------------------
 * A label with nothing after it on its own line — a bare generated heading
 * such as `## Fixes` with the content on the following line — must not
 * capture that following line's content as if it were the value. Operating
 * one line at a time makes that structurally impossible rather than
 * something the pattern has to remember not to do: there is nothing after
 * the label on the line, so the capture group has nothing to match and the
 * line contributes no candidate.
 *
 * EVERY LABEL, EVERY ANCHORED LINE
 * -----------------------------------
 * Still every declared label and every anchored occurrence, not the first:
 * a description can legitimately carry more than one anchored line (a
 * placeholder line above the real one), and a repository can declare more
 * than one label. See `extractTaskReferenceText` for how a shape-valid
 * candidate is preferred once more than one anchored line is found.
 *
 * The label is guarded on both sides by `(?<!\w)` / `(?!\w)`, matching the
 * reasoning from the earlier arrangement: a plain `\b` cannot be used
 * because a caller's label can itself end in a non-word character (a policy
 * declaring `"Ticket (id)"` is exercised by this package's own tests), and
 * `\b` requires a word/non-word transition at that edge which a label
 * ending in `)` immediately followed by `:` can never produce.
 */
function extractTaskReferenceCandidates(description: string, recordLabels: readonly string[]): readonly string[] {
  const candidates: string[] = [];
  const lines = stripGeneratedRegions(description).split(/\r?\n/);
  for (const label of recordLabels) {
    const pattern = new RegExp(
      "^[\\s*_`>#\\-+]*(?<!\\w)" + escapeLiteral(label) + "(?!\\w):?[*_`]{0,2}[ \\t]*(\\S+)",
      "i",
    );
    for (const line of lines) {
      const match = pattern.exec(line);
      const captured = match?.[1];
      if (captured === undefined) continue;
      const trimmed = captured.replace(/[.,;:)\]]+$/, "");
      if (trimmed !== "") candidates.push(trimmed);
    }
  }
  return candidates;
}

/**
 * A stand-in scope used only to ask whether a candidate token has the SHAPE
 * of a reference. `parseTaskReference` rejects an empty default scope, and a
 * bare `#12` needs some scope to resolve against, so the selection below
 * needs a non-empty one — but the value never escapes this module. The real
 * scope is applied by the caller when the chosen candidate is parsed for
 * real.
 */
const SHAPE_PROBE_SCOPE = "scope-probe/scope-probe";

/**
 * True for a candidate that is *only* a bare run of digits, once any
 * code-span backticks are stripped — `2024`, not `#2024`, `a/b#2024`, or a
 * tracker URL.
 *
 * A bare number is the one reference shape indistinguishable, by form
 * alone, from an ordinary number sitting in a sentence: "…that Refs 2024
 * baseline…" and "Refs #12" produce identically-shaped tokens once "Refs"
 * has been matched as the label, and `2024` parses exactly as cleanly as
 * `12` does. The other two shapes cannot make that mistake — a qualified
 * `owner/name#12` and a tracker URL both carry punctuation no ordinary
 * sentence puts next to a label by coincidence. So a naked number is not
 * rejected (it is still a documented, accepted shorthand, and is still
 * returned when it is the only thing found), it is only asked to stand
 * behind any candidate that carries that punctuation.
 */
function isNakedNumericCandidate(candidate: string): boolean {
  const unspanned = candidate.replace(/^`+/, "").replace(/`+$/, "");
  return /^\d+$/.test(unspanned);
}

/**
 * Pulls the work-item reference out of a change description.
 *
 * Accepts `Work item: #12`, `**Work item:** #12`, and `Work item #12`, for
 * whichever labels the policy declared. Trailing sentence punctuation is
 * stripped, because a reference at the end of a sentence is still a
 * reference and failing it teaches nothing.
 *
 * WHY THIS PREFERS A PARSEABLE CANDIDATE INSTEAD OF TAKING THE FIRST ONE
 * ----------------------------------------------------------------------
 * The earlier arrangement returned the first token after the first declared
 * label that matched anywhere, and stopped. Against real descriptions that
 * produced wrong verdicts two ways, both observed:
 *
 * 1. Prose won over the record. `Work item` is matched case-insensitively,
 *    so the sentence "there is no work item at all" matched, `at` was
 *    returned, and the actual `Work item: #12` further down the description
 *    was never reached — reported as an unparseable reference rather than
 *    the resolved one sitting in the same text.
 * 2. Only the FIRST configured label was ever consulted. A repository
 *    declaring `["Work item", "Issue"]` and writing `Issue: #12` got the
 *    same failure whenever the word "work item" appeared in prose above it.
 *
 * So every label and every occurrence is collected, and a reference-SHAPED
 * candidate is preferred over an unshaped one.
 *
 * WHY "SHAPED" ALONE IS STILL NOT ENOUGH
 * ---------------------------------------
 * A bare number is shaped — it is a documented, accepted form — and ordinary
 * prose contains numbers next to words that happen to be configured labels.
 * "…that Refs 2024 baseline…" matches the label `Refs` exactly as cleanly as
 * a real `Refs #12` written elsewhere in the same description, and `2024`
 * parses exactly as cleanly as `12` does: preferring the first SHAPED
 * candidate still lets that prose win when it appears first, which is a
 * wrong verdict against the WRONG issue rather than an honest "unparseable".
 * A qualified `owner/name#12` and a tracker URL cannot make this mistake —
 * both carry punctuation no sentence puts next to a label by coincidence —
 * so among shaped candidates, one that is not a bare naked number is
 * preferred over one that is. A naked number is never discarded; it is only
 * asked to stand behind a more distinctly-marked candidate, and is still
 * returned — shaped, then unshaped — when it is the only thing the
 * description contains.
 *
 * This can never manufacture a pass: every candidate it can return came out
 * of the description, and whichever one it returns is parsed and then looked
 * up on its own merits by the caller.
 */
export function extractTaskReferenceText(description: string, recordLabels: readonly string[]): string | undefined {
  if (typeof description !== "string") return undefined;
  const candidates = extractTaskReferenceCandidates(description, recordLabels);
  const isShaped = (candidate: string): boolean => parseTaskReference(candidate, SHAPE_PROBE_SCOPE) !== undefined;
  const marked = candidates.find((candidate) => isShaped(candidate) && !isNakedNumericCandidate(candidate));
  if (marked !== undefined) return marked;
  const shaped = candidates.find(isShaped);
  return shaped ?? candidates[0];
}

/**
 * Parses a work-item reference into a scope and a number.
 *
 * Three accepted shapes: a tracker URL ending `/<scope-owner>/<scope-name>/
 * issues/<n>`, a qualified `<owner>/<name>#<n>`, and a bare `#<n>` or `<n>`
 * resolved against the observation's own scope. The URL form deliberately
 * does not pin a host: this package endorses no tracker vendor, and a host
 * literal here would be exactly the vendor-shaped knowledge the sibling
 * packages' charters refuse.
 *
 * Backticks around the reference are stripped first. A description is
 * Markdown, and writing a reference in a code span — `` `Work item: #12` ``
 * or `` Work item: `#12` `` — is ordinary, correct authoring, not a mistake
 * to be failed. The extraction step above splits on whitespace, so a code
 * span leaves a delimiter attached to the token (a trailing one when the
 * whole line is spanned, both when only the reference is), and the anchored
 * pattern below then rejects a reference that is plainly present. That is a
 * wrong verdict about a real change, so the delimiters come off here rather
 * than the pattern learning about Markdown. `raw` keeps the text exactly as
 * it was written, because that is what a report shows a human.
 */
export function parseTaskReference(raw: string, defaultScope: string): ParsedTaskReference | undefined {
  if (typeof raw !== "string") return undefined;
  let start = 0;
  let end = raw.length;
  while (start < end && raw[start] === "`") start += 1;
  while (end > start && raw[end - 1] === "`") end -= 1;
  const unspanned = raw.slice(start, end);

  const isDigits = (value: string): boolean => {
    if (value.length === 0) return false;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code < 48 || code > 57) return false;
    }
    return true;
  };
  const hasWhitespace = (value: string): boolean => {
    for (const character of value) {
      if (character.trim() === "") return true;
    }
    return false;
  };

  let scope: string;
  let number: string;
  const schemeEnd = unspanned.startsWith("https://") ? 8 : unspanned.startsWith("http://") ? 7 : undefined;
  if (schemeEnd !== undefined) {
    const hostEnd = unspanned.indexOf("/", schemeEnd);
    const ownerEnd = hostEnd === -1 ? -1 : unspanned.indexOf("/", hostEnd + 1);
    const nameEnd = ownerEnd === -1 ? -1 : unspanned.indexOf("/", ownerEnd + 1);
    if (hostEnd === -1 || ownerEnd === -1 || nameEnd === -1) return undefined;
    const host = unspanned.slice(schemeEnd, hostEnd);
    const owner = unspanned.slice(hostEnd + 1, ownerEnd);
    const name = unspanned.slice(ownerEnd + 1, nameEnd);
    const issuePrefix = "/issues/";
    if (
      host === "" ||
      owner === "" ||
      name === "" ||
      hasWhitespace(host) ||
      hasWhitespace(owner) ||
      hasWhitespace(name) ||
      !unspanned.startsWith(issuePrefix, nameEnd)
    ) {
      return undefined;
    }
    number = unspanned.slice(nameEnd + issuePrefix.length);
    if (!isDigits(number)) return undefined;
    scope = `${owner}/${name}`;
  } else {
    const slash = unspanned.indexOf("/");
    const hash = unspanned.indexOf("#");
    if (slash !== -1 || (hash > 0 && slash !== -1)) {
      if (slash <= 0 || hash <= slash + 1 || unspanned.indexOf("/", slash + 1) !== -1 || unspanned.indexOf("#", hash + 1) !== -1) {
        return undefined;
      }
      const owner = unspanned.slice(0, slash);
      const name = unspanned.slice(slash + 1, hash);
      number = unspanned.slice(hash + 1);
      if (hasWhitespace(owner) || hasWhitespace(name) || !isDigits(number)) return undefined;
      scope = `${owner}/${name}`;
    } else {
      number = unspanned.startsWith("#") ? unspanned.slice(1) : unspanned;
      if (!isDigits(number)) return undefined;
      scope = defaultScope;
    }
  }
  if (number === undefined || scope.trim() === "") return undefined;
  return { raw, scope, number };
}

/** Why a change was exempt, when it was. Reported so an exemption is never invisible. */
export interface TaskRecordExemption {
  readonly kind: "label" | "author" | "head-ref";
  readonly matched: string;
}

/** What the check concluded, alongside the verdict. */
export interface TaskRecordReport {
  readonly result: GateResult<TaskRecordFinding, TaskRecordReason>;
  /** Set when a declared structural exemption fired. */
  readonly exemption?: TaskRecordExemption;
  /** The reference that was parsed out, when one was. */
  readonly reference?: ParsedTaskReference;
}

/**
 * Says what is wrong with the policy, or `undefined` if nothing is.
 *
 * Shape is established before content, and that order is the whole point:
 * the previous arrangement asked `applicableEventKinds.length === 0` before
 * it had established that `applicableEventKinds` was a list at all, so a
 * policy with a `null` there threw rather than returning `policy-invalid`.
 * A throw does not reach the report — it ends the process on Node's
 * uncaught-exception status of `1`, which this package reads as a real
 * finding against the change.
 */
function validatePolicy(policy: TaskRecordPolicy): string | undefined {
  const lists: readonly (readonly [string, unknown])[] = [
    ["applicableEventKinds", policy.applicableEventKinds],
    ["exemptLabels", policy.exemptLabels],
    ["exemptAuthorSuffixes", policy.exemptAuthorSuffixes],
    ["exemptHeadRefPrefixes", policy.exemptHeadRefPrefixes],
    ["recordLabels", policy.recordLabels],
  ];
  for (const [name, values] of lists) {
    if (!isStringArray(values)) return `${name} must be a list of strings.`;
    for (const value of values) {
      if (value.trim() === "") {
        // An empty exemption entry matches every author and every branch. It
        // reads as an oversight and behaves as a repository-wide waiver.
        return `${name} contains an empty entry, which would match everything.`;
      }
    }
  }
  if (policy.applicableEventKinds.length === 0) {
    return "applicableEventKinds is empty, so this check could never apply to anything.";
  }
  if (policy.recordLabels.length === 0) {
    return "recordLabels is empty, so no reference could ever be recognised.";
  }
  if (typeof policy.requireResolvedItem !== "boolean") {
    return "requireResolvedItem must be an explicit boolean.";
  }
  return undefined;
}

/**
 * Says what is wrong with the observation, or `undefined` if nothing is.
 *
 * Same reasoning as the policy above, applied to the other caller-supplied
 * half: `labels.includes`, `authorId.endsWith`, and `headRef.startsWith` are
 * all called on values a JSON document can perfectly well supply as `null`.
 */
function validateObservation(observation: TaskRecordObservation): string | undefined {
  const strings: readonly (readonly [string, unknown])[] = [
    ["eventKind", observation.eventKind],
    ["description", observation.description],
    ["authorId", observation.authorId],
    ["headRef", observation.headRef],
    ["trackerScope", observation.trackerScope],
  ];
  for (const [name, value] of strings) {
    if (typeof value !== "string") return `${name} must be a string.`;
  }
  if (observation.trackerScope.trim() === "") {
    return "trackerScope is empty, so no reference could be compared against the scope this run can read.";
  }
  if (!isStringArray(observation.labels)) return "labels must be a list of strings.";
  const item: unknown = observation.item;
  if (item !== undefined) {
    if (!isRecord(item)) return "item must be a lookup result object when it is present.";
    // An outcome outside the declared vocabulary must not fall past the
    // branches below into the satisfied result at the end of the check. An
    // unrecognised word is not a lookup that succeeded; it is a lookup this
    // build cannot interpret, which is the definition of indeterminate.
    if (!(TASK_ITEM_LOOKUP_OUTCOMES as readonly unknown[]).includes(item.outcome)) {
      return (
        `item.outcome is ${JSON.stringify(item.outcome)}, which is not one of ` +
        `${TASK_ITEM_LOOKUP_OUTCOMES.join(", ")}. An outcome this build cannot read is not a resolved item.`
      );
    }
  }
  return undefined;
}

function findExemption(observation: TaskRecordObservation, policy: TaskRecordPolicy): TaskRecordExemption | undefined {
  const label = policy.exemptLabels.find((candidate) => observation.labels.includes(candidate));
  if (label !== undefined) return { kind: "label", matched: label };
  const suffix = policy.exemptAuthorSuffixes.find((candidate) => observation.authorId.endsWith(candidate));
  if (suffix !== undefined) return { kind: "author", matched: suffix };
  const prefix = policy.exemptHeadRefPrefixes.find((candidate) => observation.headRef.startsWith(candidate));
  if (prefix !== undefined) return { kind: "head-ref", matched: prefix };
  return undefined;
}

/** Evaluates one change's task record against the consuming repository's policy. */
export function checkTaskRecord(
  observation: TaskRecordObservation | undefined,
  policy: TaskRecordPolicy | undefined,
): TaskRecordReport {
  if (!isRecord(observation)) {
    return {
      result: taskRecordReasons.indeterminate(
        "no-observation-supplied",
        "No change observation was supplied, or what was supplied is not an observation. Absence of a change is not " +
          "a change with a valid record.",
      ),
    };
  }
  if (!isRecord(policy)) {
    return {
      result: taskRecordReasons.indeterminate(
        "no-policy-supplied",
        "No task-record policy was supplied. This package holds no default requirements, and will not invent one.",
      ),
    };
  }
  const policyProblem = validatePolicy(policy);
  if (policyProblem !== undefined) {
    return { result: taskRecordReasons.indeterminate("policy-invalid", policyProblem) };
  }
  const observationProblem = validateObservation(observation);
  if (observationProblem !== undefined) {
    return { result: taskRecordReasons.indeterminate("observation-invalid", observationProblem) };
  }
  if (!policy.applicableEventKinds.includes(observation.eventKind)) {
    return {
      result: taskRecordReasons.indeterminate(
        "not-applicable-event",
        `This check applies to ${policy.applicableEventKinds.join(", ")} and this run observed ` +
          `${JSON.stringify(observation.eventKind)}. Nothing was evaluated, so nothing passed.`,
      ),
    };
  }

  const exemption = findExemption(observation, policy);
  if (exemption !== undefined) {
    // One thing was evaluated and held: the declared exemption rule itself.
    // It is named in the report, so this can never read as an ordinary pass.
    return { result: gateSatisfied(1), exemption };
  }

  const raw = extractTaskReferenceText(observation.description, policy.recordLabels);
  if (raw === undefined) {
    return {
      result: gateViolated([
        finding(
          "task-record-missing",
          "description",
          `No ${policy.recordLabels.map((label) => `"${label}:"`).join(" or ")} reference appears in the change description.`,
        ),
      ]),
    };
  }

  const reference = parseTaskReference(raw, observation.trackerScope);
  if (reference === undefined) {
    return {
      result: gateViolated([
        finding(
          "task-record-unparseable",
          "description",
          `${JSON.stringify(raw)} is not a recognised work-item reference (#12, owner/name#12, or a tracker URL).`,
        ),
      ]),
    };
  }

  if (reference.scope.toLowerCase() !== observation.trackerScope.toLowerCase()) {
    return {
      reference,
      result: taskRecordReasons.indeterminate(
        "item-outside-tracker-scope",
        `${reference.scope}#${reference.number} is outside ${observation.trackerScope}, which is the only scope this ` +
          "run's credential is stated to read. The reference's shape is valid; whether the item exists is unknown.",
      ),
    };
  }

  if (!policy.requireResolvedItem) {
    // One thing was evaluated: the reference's shape. The report says so; it
    // never implies the item was confirmed to exist.
    return { result: gateSatisfied(1), reference };
  }

  const item = observation.item;
  if (item === undefined || item.outcome === "not-attempted") {
    return {
      reference,
      result: taskRecordReasons.indeterminate(
        "item-lookup-not-attempted",
        `The policy requires ${reference.scope}#${reference.number} to resolve, and no lookup was attempted.`,
      ),
    };
  }
  if (item.outcome === "unavailable") {
    return {
      reference,
      result: taskRecordReasons.indeterminate(
        "item-lookup-unavailable",
        `The tracker could not answer for ${reference.scope}#${reference.number}` +
          (item.detail === undefined ? "." : `: ${item.detail}`),
      ),
    };
  }
  if (item.outcome === "not-visible") {
    return {
      reference,
      result: taskRecordReasons.indeterminate(
        "item-not-visible",
        `${reference.scope}#${reference.number} was not visible to this run's credential. A scoped credential answers ` +
          "the same way for an item that does not exist and an item it may not read, so this is not treated as proof " +
          "of absence.",
      ),
    };
  }
  if (item.outcome === "resolved-wrong-kind") {
    return {
      reference,
      result: gateViolated([
        finding(
          "task-record-wrong-kind",
          "description",
          `${reference.scope}#${reference.number} resolved, but is not a tracked work item` +
            (item.detail === undefined ? "." : `: ${item.detail}`),
        ),
      ]),
    };
  }

  // The satisfied result is the last branch in the function and is guarded
  // by an equality rather than reached by exhaustion. Every branch above
  // names an outcome it handles; if this one merely returned whatever fell
  // past them, adding a sixth outcome upstream — or a caller writing one
  // this build has never heard of — would silently become a pass. It is the
  // only branch that reports the change as sound, so it states the one
  // condition under which that is true.
  if (item.outcome !== "resolved") {
    return {
      reference,
      result: taskRecordReasons.indeterminate(
        "observation-invalid",
        `item.outcome is ${JSON.stringify(item.outcome)}, which this build does not interpret as a resolved work ` +
          "item. An outcome that was not understood is not one that succeeded.",
      ),
    };
  }

  // Two things were evaluated: the reference's shape, and the item it names.
  return { result: gateSatisfied(2), reference };
}
