// The title and body of one repository's pull request (issue #1178; the apply
// RFC's section 6 body marker, threat T6, decision D31 and section 12.7, in the
// public repository, not shipped in this package). A pure function of three
// inputs: a stored change set, the ApprovalBinding admission decided for it,
// and the number of the task-record issue. It reads nothing, writes nothing and
// opens nothing; a later step decides the binding, passes it in, records
// `bodySha256` and hands the text to the agent that opens the pull request.
// The caller may also pass the numbers of the older pull requests this one
// replaces; they are written ascending under `## Supersedes` and nothing else.
//
// This is a public-safety surface, so every ambiguity refuses:
//
// - The text carries ids, act names, versions and digests only: never a brief,
//   plan prose, `texts`, a key value, a path or a file's contents. Every value
//   is matched against its own strict pattern before it is written, and any
//   that holds `<`, `>`, a backtick, `|`, a carriage return or a line feed is
//   refused, so no value can start a marker, close a code span or add a line.
// - Each value is written inside a code span, so a package name such as
//   `@scope/name` is never read by GitHub as a mention.
// - The body opens with the one marker line and holds no other, and it is read
//   back with readChangeSetMarker before it is returned.
// - The renderer does not decide the binding: it shows what the caller passes.
//   It does not check that the task-record issue exists, and it cannot stop a
//   pull request's body being edited after it is opened; `bodySha256` and the
//   marker are how a later `status` sees that.
//
// A refusal carries a fixed token, never an id, a digest or any input text.

import { createHash } from "node:crypto";
import { validateRepositoryChangeSet } from "./change-set-contract.js";
import type { ApprovalBinding, ChangeSetItem, RepositoryChangeSet } from "./change-set-contract.js";
import { changeSetDigest } from "./change-set-digest.js";

export type PullRequestRefusalReason =
  | "change-set-invalid"
  | "title-mismatch"
  | "binding-invalid"
  | "binding-phase-mismatch"
  | "task-record-invalid"
  | "supersedes-invalid"
  | "value-unsafe"
  | "body-invalid"
  | "render-failed";

/** A refusal: a fixed token, never a value. */
export interface PullRequestRefusal {
  readonly state: "refused";
  readonly reason: PullRequestRefusalReason;
}

export interface RenderPullRequestInput {
  readonly set: RepositoryChangeSet;
  /** What admission decided for this set (decideSetBinding). It is shown, not checked here beyond its shape. */
  readonly binding: ApprovalBinding;
  /** The number of the task-record issue in the target repository: a positive safe integer. */
  readonly taskRecord: number;
  /**
   * The numbers of the pull requests of older change sets this one replaces (RFC section 6, D6): each a positive safe integer,
   * none repeated and none the task record. Written ascending under `## Supersedes`. Absent or empty: no such section, and the
   * body is the one it was without this option.
   */
  readonly supersedes?: readonly number[];
}

export interface PullRequestText {
  readonly state: "rendered";
  readonly title: string;
  readonly body: string;
  /** `sha256:` and the hex SHA-256 of the body's UTF-8 bytes. */
  readonly bodySha256: string;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const TITLE = /^Clossys: apply plan [0-9a-f]{12}$/u;
const MARKER_LINE = /^<!-- clossys-change-set: (sha256:[0-9a-f]{64}) -->$/u;
const REPOSITORY_ID = /^(?:[A-Za-z0-9][A-Za-z0-9-]{0,38}\/)?[A-Za-z0-9._-]{1,100}$/u;
// 355 characters: a repository id of up to 140, a colon and a package name of up to 214 (the planItem the contract derives, C16).
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,354}$/u;
const ID_TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PACKAGE_NAME = /^(?=.{1,214}$)@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u;
const EXACT_VERSION = /^(?:0|[1-9][0-9]{0,15})\.(?:0|[1-9][0-9]{0,15})\.(?:0|[1-9][0-9]{0,15})$/u;
const UNSAFE = /[<>`|\r\n]/u;
const PRINTABLE_LINES = /^[\x20-\x7e\n]*$/u;
const MARKER_WORD = /clossys-change-set/giu;

const PHASES: ReadonlySet<string> = new Set(["setup", "apply"]);
const ACTS: ReadonlySet<string> = new Set([
  "write-record",
  "compose-skills",
  "install",
  "pin-starter",
  "exempt-release-age",
  "declare-root-entry",
  "write-ledger",
  "add-caller-workflow",
  "write-starter-request",
  "add-ci-template",
  "add-path-scope-job",
]);

const refuse = (reason: PullRequestRefusalReason): PullRequestRefusal => ({ state: "refused", reason });

/** A value that may be interpolated: a string that matches its own pattern and holds nothing that could start a marker, close a code span or add a line. */
function safe(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && !UNSAFE.test(value) && pattern.test(value);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const sha256Of = (text: string): string => `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;

/**
 * The change-set digest a body carries, or null. Exactly one line must be
 * exactly `<!-- clossys-change-set: sha256:<64 hex> -->`, and the marker's
 * name must appear nowhere else in the body, so a second marker line, or a
 * marker inside another line, reads as none.
 */
export function readChangeSetMarker(body: string): string | null {
  if (typeof body !== "string") return null;
  const found = body.split("\n").flatMap((line) => MARKER_LINE.exec(line)?.[1] ?? []);
  if (found.length !== 1) return null;
  if ((body.match(MARKER_WORD) ?? []).length !== 1) return null;
  return found[0]!;
}

function itemLine(item: ChangeSetItem): string | null {
  if (!safe(item.id, ITEM_ID) || typeof item.act !== "string" || !ACTS.has(item.act)) return null;
  if (item.act !== "install" && item.act !== "pin-starter") return `- \`${item.id}\` \`${item.act}\``;
  if (!safe(item.package.name, PACKAGE_NAME) || !safe(item.package.version, EXACT_VERSION)) return null;
  return `- \`${item.id}\` \`${item.act}\` \`${item.package.name}@${item.package.version}\``;
}

function bindingLines(binding: unknown, set: RepositoryChangeSet): string[] | PullRequestRefusal {
  if (!isRecord(binding)) return refuse("binding-invalid");
  const keys = Object.keys(binding).sort().join(",");
  if (binding.kind === "approved") {
    if (keys !== "kind,subjectDigest" || !safe(binding.subjectDigest, DIGEST)) return refuse("binding-invalid");
    return ["- Binding: `approved`", `- Approved subject: \`${binding.subjectDigest}\``];
  }
  if (binding.kind === "admitted") {
    if (keys !== "kind,setupChangeSet,subjectDigest" || !safe(binding.subjectDigest, DIGEST) || !safe(binding.setupChangeSet, DIGEST)) return refuse("binding-invalid");
    if (set.phase !== "apply") return refuse("binding-phase-mismatch");
    // Admission never binds a set to itself, or to the bundle that holds the set.
    if (binding.setupChangeSet === set.changeSetDigest || binding.subjectDigest === set.bundle) return refuse("binding-invalid");
    return ["- Binding: `admitted`", `- Admitted subject: \`${binding.subjectDigest}\``, `- Setup change set: \`${binding.setupChangeSet}\``];
  }
  return refuse("binding-invalid");
}

/**
 * The pull request title and body for one stored change set. The title is
 * exactly `set.pullRequest.title`, which must be `Clossys: apply plan ` and
 * the first 12 hex digits of the set's own digest. Refuses a set that fails
 * validateRepositoryChangeSet or whose digest does not recompute, a malformed
 * binding, an `admitted` binding on a setup set, a task record that is not a
 * positive safe integer, and any value it cannot prove safe to write. Never
 * throws.
 */
export function renderPullRequest(input: RenderPullRequestInput): PullRequestText | PullRequestRefusal {
  try {
    return render(input);
  } catch {
    return refuse("render-failed");
  }
}

function render(input: RenderPullRequestInput): PullRequestText | PullRequestRefusal {
  const { taskRecord } = input;
  if (typeof taskRecord !== "number" || !Number.isSafeInteger(taskRecord) || taskRecord < 1) return refuse("task-record-invalid");

  // Read once, like the set: what is checked is what is written. Only a list of distinct positive safe integers other than the task record passes.
  let supersedes: number[] = [];
  if (input.supersedes !== undefined) {
    let read: unknown;
    try {
      read = JSON.parse(JSON.stringify(input.supersedes));
    } catch {
      return refuse("supersedes-invalid");
    }
    if (!Array.isArray(read)) return refuse("supersedes-invalid");
    for (const entry of read as unknown[]) if (typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < 1 || entry === taskRecord) return refuse("supersedes-invalid");
    supersedes = (read as number[]).slice().sort((left, right) => left - right);
    if (supersedes.some((entry, index) => index > 0 && entry === supersedes[index - 1])) return refuse("supersedes-invalid");
  }

  // One snapshot, so a getter or a proxy cannot show the checks one value and the text another.
  let set: RepositoryChangeSet;
  let binding: unknown;
  try {
    set = JSON.parse(JSON.stringify(input.set)) as RepositoryChangeSet;
  } catch {
    return refuse("change-set-invalid");
  }
  try {
    binding = JSON.parse(JSON.stringify(input.binding));
  } catch {
    return refuse("binding-invalid");
  }
  if (!validateRepositoryChangeSet(set).valid || changeSetDigest(set) !== set.changeSetDigest) return refuse("change-set-invalid");

  // The contract's rule C5 already ties the title to the digest; this is the same rule, held here too.
  const digest = set.changeSetDigest;
  if (!safe(digest, DIGEST)) return refuse("change-set-invalid");
  if (!safe(set.pullRequest.title, TITLE) || set.pullRequest.title !== `Clossys: apply plan ${digest.slice("sha256:".length, "sha256:".length + 12)}`) return refuse("title-mismatch");

  const bound = bindingLines(binding, set);
  if (!Array.isArray(bound)) return bound;

  const repositoryId = set.repository.id;
  if (!safe(repositoryId, REPOSITORY_ID) || repositoryId === "." || repositoryId === ".." || repositoryId.endsWith("/.") || repositoryId.endsWith("/..")) return refuse("value-unsafe");
  if (typeof set.phase !== "string" || !PHASES.has(set.phase)) return refuse("value-unsafe");
  if (!safe(set.planDigest, DIGEST) || !safe(set.bundle, DIGEST)) return refuse("value-unsafe");

  const items: string[] = [];
  for (const item of set.items) {
    const line = itemLine(item);
    if (line === null) return refuse("value-unsafe");
    items.push(line);
  }

  const notes: string[] = [];
  for (const deferral of set.deferred) {
    if (!safe(deferral.planItem, ITEM_ID) || !safe(deferral.reason, ID_TOKEN)) return refuse("value-unsafe");
    notes.push(`- Deferred: \`${deferral.planItem}\` \`${deferral.reason}\``);
  }
  for (const refusal of set.refused) {
    if (!safe(refusal.item, ITEM_ID) || !safe(refusal.reason, ID_TOKEN)) return refuse("value-unsafe");
    notes.push(`- Refused: \`${refusal.item}\` \`${refusal.reason}\``);
  }

  const lines = [
    `<!-- clossys-change-set: ${digest} -->`,
    "",
    "## Change set",
    "",
    `- Repository: \`${repositoryId}\``,
    `- Phase: \`${set.phase}\``,
    `- Change set: \`${digest}\``,
    `- Plan: \`${set.planDigest}\``,
    `- Bundle: \`${set.bundle}\``,
    "",
    "## Binding",
    "",
    ...bound,
    "",
    "## Items",
    "",
    ...items,
    ...(notes.length === 0 ? [] : ["", "## Not applied", "", ...notes]),
    ...(supersedes.length === 0 ? [] : ["", "## Supersedes", "", ...supersedes.map((number) => `- #${number}`)]),
    "",
    "## Task record",
    "",
    `- #${taskRecord}`,
  ];
  const body = `${lines.join("\n")}\n`;

  // The last word: printable ASCII and line feeds only, no line feed at the end but one, and the marker reads back as this set's digest.
  if (!PRINTABLE_LINES.test(body) || body.endsWith("\n\n") || readChangeSetMarker(body) !== digest || !body.startsWith(`<!-- clossys-change-set: ${digest} -->\n`)) return refuse("body-invalid");
  return { state: "rendered", title: set.pullRequest.title, body, bodySha256: sha256Of(body) };
}
