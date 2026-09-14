#!/usr/bin/env node
// check-commit-messages.mjs — scans commit messages (and optionally a PR
// title) in a given range against the same identity denylist used by
// check-public-safety.mjs.
//
// WHY THIS EXISTS: check-public-safety.mjs scans the git TREE (file
// content). check-artifact-safety.mjs scans the packed TARBALL. Neither
// ever reads a commit MESSAGE — and a commit message is exactly as public
// and exactly as permanent as any file it changes. A private identity term
// in a commit message cannot be removed by a later commit; only a history
// rewrite (or deleting and recreating the repository) removes it. This is
// the gate for that surface, and it existing at all is the direct result of
// a real gap: every other surface had a gate, this one didn't.
//
// Unlike check-public-safety.mjs, this gate applies NO path- or pattern-scoped
// neutralize exceptions: a commit message never legitimately needs to state
// private identity (unlike, say, package.json's author field), so the
// strictest possible check is also the simplest one to reason about for any
// NEW commit.
//
// The ONE exception this gate makes beyond the machine-trailer exemption
// below is content-addressed, not path- or pattern-scoped: see "historical
// exceptions" further down. It exists because a commit message is immutable
// — a finding in one cannot be fixed by editing a later commit — so a small,
// closed, reviewed set of already-public historical commits needs a way to
// go green without weakening the rule for anything committed after them.
//
// This intentionally duplicates a small amount of matching logic from
// check-public-safety.mjs rather than importing it, since that script's
// internals are independently maintained — share the logic via a common
// module if the two ever drift apart enough to matter.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function flagValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));

const range = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
const titleArg = flagValue("--title");

if (!range && !titleArg) {
  console.error(
    "usage: check-commit-messages.mjs <git-rev-range> [--title <pr-title>] [--require-denylist] [--denylist <file>] [--exceptions <file>]"
  );
  process.exit(2);
}

// ------------------------------------------------------- historical exceptions
//
// WHY THIS EXISTS (issue #809): GitHub's own squash-merge composes
// `Co-authored-by:` trailers from a contributor's PUBLIC PROFILE email, not
// the email on the commits being squashed — so a repository can have every
// author configured correctly and still get a personal address baked into a
// commit message it never wrote a line of. That message is immutable: a
// later commit cannot edit it, only a full history rewrite can, and that
// costs every existing clone, every merged PR's recorded SHA, and every
// sealed `governance/release-qualifications/` binding. This is the narrow,
// content-addressed escape hatch for exactly that situation — modeled on
// governance/package-identity-history.json's own exact-digest admission of
// historical identity lines, applied here to whole commit messages instead
// of file lines.
//
// SHAPE: each entry names an exact 40-hex commit SHA, a sha256 digest of
// that EXACT commit's full message text (never the matched text itself —
// this file is tracked in a public repository and is itself scanned by
// check-public-safety.mjs and conversation-safety.yml), and the exact
// denylist "why" categories reviewed and admitted for it. A commit message
// is immutable, so the SHA alone already pins the content — the message
// digest is a second, independent tripwire: any divergence (a typo'd digest,
// a copy-paste from the wrong commit) fails the gate rather than silently
// admitting the wrong text.
//
// THE SEAL — this is what stops requirement 3's adversarial case ("add a
// commit with a real secret, then append its SHA here"): every entry's
// commitSha must be an ancestor of (or equal to) `sealedAtCommit`, a FIXED
// historical commit that must never be advanced. A commit created after the
// seal is by construction a DESCENDANT of it, never an ancestor — so no
// newly authored commit's SHA can ever satisfy this check, no matter what
// text is appended alongside it. Defeating this mechanically (not just by
// hoping a reviewer notices) would require moving `sealedAtCommit` itself
// forward, which is exactly the kind of change a reviewer diffing this file
// is asked to treat as suspicious on its face: nothing routine ever touches
// that field again after it is first set.
//
// WHAT THIS DOES NOT PREVENT: a reviewer who approves a PR that both (a)
// adds a new leaking commit under the *current* PR's own head and (b) also
// moves `sealedAtCommit` forward to cover it, in the same review pass. The
// mechanical seal converts that from "silently works" into "requires a
// visibly unusual diff to a security-relevant file, including a field that
// otherwise never changes" — it makes the attempt loud, not impossible.
// Nothing here substitutes for review actually looking at that diff. Note
// also that CI never lets a PR's own edits to this file take effect against
// its own commits anyway (see ci.yml's trusted-scripts checkout below) — an
// entry only ever matters once it has already been merged to a prior base
// ref, which forces a second, separate review pass before it can admit
// anything.
//
// FAILS CLOSED: missing, unparsable, structurally invalid, or out-of-seal
// exception data exits 2 (a gate configuration error) unconditionally —
// before denylist loading, so this is checked even in PARTIAL mode. A
// broken exception mechanism must never be indistinguishable from "nothing
// needed excepting".
//
// DELIBERATELY NOT a FINDING when an entry's commit is simply absent from
// THIS run's scan range — unlike check-package-identity-transition.mjs's
// checkCandidateHistory, which walks the ENTIRE current tree every run and
// so can reliably call an expected-but-unobserved line "unused". This gate
// is invoked once per push/PR against a narrow diff range (see ci.yml) —
// once one of these 8 commits is merged, it will almost never reappear in
// any future range, forever. Treating that ordinary, permanent state as a
// failure would make every future CI run red again, which is the exact
// "assumed unused = safe to flag" mistake #809 itself points at
// (check-package-identity-transition.mjs's historical-record FINDING cost
// this project a CI failure once already). Structural validity (existence,
// seal membership, message digest) is instead checked unconditionally on
// every run, independent of range, which is what actually keeps a stale or
// tampered entry from going unnoticed.
const exceptionsPath =
  flagValue("--exceptions") ?? join(dirname(fileURLToPath(import.meta.url)), "..", "governance", "commit-message-history-exceptions.json");

const SHA1_RE = /^[a-f0-9]{40}$/;
const MSG_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const SEVERITIES = new Set(["critical", "high", "medium"]);
const EXPECTED_EXCEPTIONS_SCHEMA_VERSION = 1;

function exceptionsFail(message) {
  console.error(`check-commit-messages: historical exception file invalid (${exceptionsPath}) — ${message}`);
  console.error(
    "  A commit-message exception must name an exact, already-sealed commit SHA, a digest of\n" +
      "  its exact message, and the exact finding categories it admits. This fails CLOSED: a\n" +
      "  missing, malformed, or out-of-seal exception file can never result in a silent pass."
  );
  process.exit(2);
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function runGitOrNull(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function isAncestorOrEqual(sha, ofSha) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, ofSha], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// issue #830: `cat-file -t` and `merge-base --is-ancestor` below can only see
// what THIS checkout actually fetched. `git rev-parse --is-shallow-repository`
// is the one call that tells the difference between "genuinely absent /
// genuinely not an ancestor" and "absent from a checkout that was never asked
// for the history needed to check it" — used only to make an already-failing
// message name its likely cause, never to change whether it fails.
function isShallowClone() {
  return runGitOrNull(["rev-parse", "--is-shallow-repository"]) === "true";
}

// Parses exactly the shape `git log --format=%x00%H%x01%B` produces for ONE
// commit, mirroring the range-scan parser below so a message digested here
// is byte-for-byte the same text that would be scanned if this commit ever
// appears in a real range. See the range-scan parser's own comment for why
// %x00 leads rather than trails.
function readCommitMessage(sha) {
  let raw;
  try {
    raw = execFileSync("git", ["log", "-1", "--format=%x00%H%x01%B", sha], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
  if (!raw.startsWith("\0")) return null;
  const record = raw.slice(1);
  const sep = record.indexOf("\x01");
  if (sep === -1) return null;
  return { hash: record.slice(0, sep), message: record.slice(sep + 1) };
}

function digestMessage(message) {
  return `sha256:${createHash("sha256").update(message, "utf8").digest("hex")}`;
}

let exceptionsRaw;
try {
  exceptionsRaw = readFileSync(exceptionsPath, "utf8");
} catch (error) {
  exceptionsFail(error.code === "ENOENT" ? "not found" : error.message);
}
let exceptionsDoc;
try {
  exceptionsDoc = JSON.parse(exceptionsRaw);
} catch (error) {
  exceptionsFail(`not valid JSON: ${error.message}`);
}
if (
  !exactKeys(exceptionsDoc, ["$comment", "schemaVersion", "sealedAtCommit", "exceptions"]) ||
  exceptionsDoc.schemaVersion !== EXPECTED_EXCEPTIONS_SCHEMA_VERSION ||
  typeof exceptionsDoc.sealedAtCommit !== "string" ||
  !SHA1_RE.test(exceptionsDoc.sealedAtCommit) ||
  !Array.isArray(exceptionsDoc.exceptions)
) {
  exceptionsFail(`must be the closed schemaVersion ${EXPECTED_EXCEPTIONS_SCHEMA_VERSION} document with a 40-hex sealedAtCommit`);
}

const seenExceptionShas = new Set();
for (const [index, entry] of exceptionsDoc.exceptions.entries()) {
  const where = `exceptions[${index}]`;
  if (!exactKeys(entry, ["commitSha", "messageSha256", "findings", "ref"])) {
    exceptionsFail(`${where} has the wrong shape`);
  }
  if (typeof entry.commitSha !== "string" || !SHA1_RE.test(entry.commitSha)) {
    exceptionsFail(`${where}.commitSha must be a 40-hex commit SHA`);
  }
  if (seenExceptionShas.has(entry.commitSha)) {
    exceptionsFail(`duplicate exception entry for commit ${entry.commitSha}`);
  }
  seenExceptionShas.add(entry.commitSha);
  if (typeof entry.messageSha256 !== "string" || !MSG_DIGEST_RE.test(entry.messageSha256)) {
    exceptionsFail(`${where}.messageSha256 must be "sha256:" followed by 64 hex characters`);
  }
  if (typeof entry.ref !== "string" || entry.ref.trim().length === 0) {
    exceptionsFail(`${where}.ref must be a non-empty string`);
  }
  if (!Array.isArray(entry.findings) || entry.findings.length === 0) {
    exceptionsFail(`${where}.findings must be a non-empty array`);
  }
  const seenWhy = new Set();
  for (const finding of entry.findings) {
    if (!exactKeys(finding, ["why", "severity"])) {
      exceptionsFail(`${where}.findings has an entry with the wrong shape`);
    }
    if (typeof finding.why !== "string" || finding.why.trim().length === 0) {
      exceptionsFail(`${where}.findings entry has an empty "why"`);
    }
    if (!SEVERITIES.has(finding.severity)) {
      exceptionsFail(`${where}.findings entry has an invalid severity ${JSON.stringify(finding.severity)}`);
    }
    if (seenWhy.has(finding.why)) {
      exceptionsFail(`${where}.findings has a duplicate "why" (${JSON.stringify(finding.why)})`);
    }
    seenWhy.add(finding.why);
  }
}

// Git-dependent validation only runs when there is at least one entry to
// check — an empty exceptions list needs no live repository to be valid.
//
// DEPENDS ON A FULL (UNSHALLOWED) CLONE, back through at least sealedAtCommit
// (issue #830). Every `cat-file -t` and `merge-base --is-ancestor` call below
// can only resolve what this checkout actually fetched — on a shallow clone
// they fail exactly the way they would for a genuinely-absent or genuinely-
// not-an-ancestor commit, and this block already fails CLOSED (exit 2) in
// that case (see exceptionsFail below), never a silent different pass. That
// is correct, but until now it rested entirely on `.github/workflows/ci.yml`
// happening to pass `fetch-depth: 0` — added originally for gitleaks' full-
// history scan, not for this mechanism — so this script did not own or
// assert the dependency itself. `shallowRepo` below exists only to make an
// already-failing message NAME that as the likely cause instead of reading
// like an unexplained CI outage; it never changes whether anything passes.
const shallowRepo = exceptionsDoc.exceptions.length > 0 ? isShallowClone() : false;
const shallowHint =
  " — this checkout is a SHALLOW clone (`git rev-parse --is-shallow-repository` = true); " +
  "this check needs a full clone back through sealedAtCommit (fetch-depth: 0), not a shallow one.";
if (exceptionsDoc.exceptions.length > 0) {
  if (runGitOrNull(["cat-file", "-t", exceptionsDoc.sealedAtCommit]) !== "commit") {
    exceptionsFail(
      `sealedAtCommit ${exceptionsDoc.sealedAtCommit} is not a commit in this repository's object database` +
        (shallowRepo ? shallowHint : "")
    );
  }
  for (const entry of exceptionsDoc.exceptions) {
    if (runGitOrNull(["cat-file", "-t", entry.commitSha]) !== "commit") {
      exceptionsFail(
        `commit ${entry.commitSha} is not present in this repository's object database — it cannot be verified and cannot be admitted` +
          (shallowRepo ? shallowHint : "")
      );
    }
    if (!isAncestorOrEqual(entry.commitSha, exceptionsDoc.sealedAtCommit)) {
      exceptionsFail(
        `commit ${entry.commitSha} is not sealed — it is not sealedAtCommit ${exceptionsDoc.sealedAtCommit} or an ancestor of it. ` +
          "A commit created after the seal can never be admitted this way; moving sealedAtCommit forward to cover it is a change that must be reviewed on its own merits, not a routine edit." +
          (shallowRepo
            ? " Note also" + shallowHint + " If this commit really is an ancestor, a shallow clone can make merge-base report it as not one; fetch full history and re-run before trusting this result."
            : "")
      );
    }
    const actual = readCommitMessage(entry.commitSha);
    if (!actual || actual.hash !== entry.commitSha) {
      exceptionsFail(`could not read the exact message of commit ${entry.commitSha}` + (shallowRepo ? shallowHint : ""));
    }
    const actualDigest = digestMessage(actual.message);
    if (actualDigest !== entry.messageSha256) {
      exceptionsFail(
        `commit ${entry.commitSha}'s actual message digest (${actualDigest}) does not match the recorded messageSha256 (${entry.messageSha256}) — refusing to admit a mismatch rather than trusting a possibly wrong record`
      );
    }
  }
}

// hash -> Map(why -> { severity, ref }), used below to filter findings for
// exactly the recorded categories on exactly this commit — a denylist term
// added later that ALSO happens to match one of these old commits is a NEW
// finding, not automatically covered, and still fails.
const exceptionsByHash = new Map(
  exceptionsDoc.exceptions.map((entry) => [
    entry.commitSha,
    { ref: entry.ref, why: new Map(entry.findings.map((f) => [f.why, f.severity])) },
  ])
);

// ------------------------------------------------------------ denylist loading
//
// Deliberately NO generic local-default fallback (unlike check-public-safety.mjs's
// historical behavior) — an explicit denylist is required here, full stop. A
// silent fallback to the wrong repo's denylist on a shared machine is exactly
// the footgun this project hit once already; this newer gate doesn't repeat it.
const denylistPath = flagValue("--denylist") ?? process.env.PUBLIC_SAFETY_DENYLIST ?? null;

let denylist = null;
let denylistError = null;
if (denylistPath) {
  try {
    const parsed = JSON.parse(readFileSync(denylistPath, "utf8"));
    if (!Array.isArray(parsed.terms) || parsed.terms.length === 0) {
      throw new Error("denylist has no terms");
    }
    denylist = parsed;
  } catch (error) {
    denylistError = error.code === "ENOENT" ? "not found" : error.message;
  }
} else {
  denylistError = "no --denylist flag and $PUBLIC_SAFETY_DENYLIST is unset";
}

const mode = denylist ? "FULL" : "PARTIAL";

if (!denylist && flags.has("--require-denylist")) {
  console.error(
    `check-commit-messages: FULL mode required but the denylist could not be loaded (${denylistError}).\n` +
      `  set --denylist <file> or $PUBLIC_SAFETY_DENYLIST.`
  );
  process.exit(2);
}

if (!denylist) {
  console.log(
    "check-commit-messages: PARTIAL mode — no denylist available, commit messages were NOT scanned for identity."
  );
  process.exit(0);
}

// --------------------------------------------------------------- term matching

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A pattern that already looks regex-shaped (contains a metacharacter) is used
// as-is; a plain string is escaped and matched literally. Mirrors
// check-public-safety.mjs's convention so the two gates agree on what a term
// means.
const termRes = denylist.terms.map((t) => {
  const looksRegex = /[\\[\](){}|^$.*+?]/.test(t.pattern);
  const src = looksRegex ? t.pattern : escapeRegExp(t.pattern);
  return { re: new RegExp(src, "gi"), term: t };
});

function stripZeroWidth(s) {
  // ZWSP, ZWNJ, ZWJ, BOM — see check-public-safety.mjs issue #16; applied here
  // too since a commit message is ordinary text and equally capable of
  // carrying an invisible-character bypass.
  return s.replace(/[​‌‍﻿]/g, "");
}

// The ONE exception this gate makes, and the reasoning for why it is narrow
// enough to be safe.
//
// GitHub's own squash-merge writes a `Co-authored-by:` trailer naming every
// contributor to the squashed branch, using its `<id>+<login>@users.noreply.github.com`
// address form. That is machine-generated attribution, not prose a human
// chose to write, and it is unavoidable: it is added server-side at merge
// time, after every check has already passed, so no gate can prevent it and
// no author can opt a single merge out of it.
//
// Author attribution is separately a settled decision in this repository —
// LICENSE names a real copyright holder (an MIT grant is not valid without
// one) and package.json carries a real `author`, both covered by explicit
// path-scoped neutralize entries in the denylist. This trailer is the same
// already-public fact in a third place, so refusing it would fail every
// squash merge forever to hide something two committed files state outright.
//
// The match is deliberately tight: only GitHub's own noreply address form,
// only as a whole trailer line. A hand-written `Co-authored-by: Name
// <name@realdomain.com>` does NOT match and is still scanned in full, which
// is the correct boundary — machine-generated attribution is exempt, a human
// typing an identity into a commit message is not.
const GITHUB_COAUTHOR_TRAILER =
  /^Co-authored-by:[^\n<]*<\d+\+[^@\s>]+@users\.noreply\.github\.com>[ \t]*$/gim;

function stripMachineTrailers(s) {
  return s.replace(GITHUB_COAUTHOR_TRAILER, "");
}

function findMatches(label, text) {
  const clean = stripMachineTrailers(stripZeroWidth(text));
  const findings = [];
  for (const { re, term } of termRes) {
    re.lastIndex = 0;
    if (re.test(clean)) {
      findings.push({ label, why: term.why ?? "(no why)", severity: term.severity ?? "high" });
    }
  }
  return findings;
}

// ------------------------------------------------------------------- gather text

const items = []; // [{ label, text, hash }] — hash is null for the PR title, which no exception can ever cover.

if (titleArg) {
  items.push({ label: "PR title", text: titleArg, hash: null });
}

if (range) {
  let raw;
  try {
    // %x00 as a record separator, %x01 as a hash/message separator — neither
    // byte occurs in valid UTF-8 commit text, so this can't be confused by
    // pathological commit content.
    //
    // %x00 goes at the FRONT of the format, not the back — this is load-
    // bearing, not stylistic. `--format=` is shorthand for `tformat:`, and
    // per git-log(1), tformat always appends its own terminating "\n" after
    // each commit's expansion UNLESS the format string itself ends in %n.
    // Ours ends in %B (the free-form commit body), so that automatic
    // newline always fires, on every commit, and there is no way to opt out
    // of it while still ending the format in %B. A format of
    // `%H%x01%B%x00` puts git's extra "\n" AFTER our own %x00 terminator —
    // i.e. at the START of the next record once we split on \0 — which
    // silently prepends a stray "\n" onto every hash but the first (git logs
    // newest-first, so in practice: every hash but the newest commit's).
    // That corrupted hash still slices to a "plausible" 12-char label, so
    // nothing downstream ever complains; it's just wrong, silently, forever.
    //
    // Putting %x00 first instead sidesteps the collision entirely rather
    // than cleaning up after it: git's auto-appended "\n" now lands after
    // %B, i.e. inside the CURRENT record's own message text (as harmless
    // trailing whitespace — %B already normally ends in one), never in
    // front of the NEXT record's %H. The hash is therefore always the first
    // thing after a \0, full stop, regardless of what git glues onto the
    // tail end of the previous entry.
    raw = execFileSync("git", ["log", range, "--format=%x00%H%x01%B"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // Fail CLOSED on a git error (bad range, not a git repo, etc.) rather than
    // silently reporting zero commits scanned as if that were a clean pass.
    console.error(`check-commit-messages: failed to read git log for range "${range}": ${error.message}`);
    process.exit(2);
  }
  // The very first character of `raw` is the leading %x00 of the first
  // record, so split() always yields an empty leading element — drop it.
  // Everything after that is a real record; there is no trailing-empty
  // case to filter here the way a %x00-as-terminator scheme would need,
  // since nothing follows the last record's own trailing "\n".
  const records = raw.split("\0").filter((r) => r.length > 0);
  for (const record of records) {
    const sep = record.indexOf("\x01");
    if (sep === -1) {
      // A record with no %x01 separator means the git-log output didn't
      // match the shape this parser assumes — fail CLOSED rather than
      // `continue`-ing past it. Silently dropping an unparseable record
      // would let a commit skip the identity scan entirely while the gate
      // still reports success, which is worse than not scanning at all:
      // it would look exactly like a clean pass.
      console.error(
        `check-commit-messages: malformed git-log record while parsing range "${range}" ` +
          `(no \\x01 hash/message separator found) — refusing to silently drop it from the scan.`
      );
      process.exit(2);
    }
    const hash = record.slice(0, sep);
    const message = record.slice(sep + 1);
    items.push({ label: `commit ${hash.slice(0, 12)}`, text: message, hash });
  }
  if (records.length === 0) {
    console.log(`check-commit-messages: range "${range}" contains no commits — nothing to scan.`);
  }
}

// ------------------------------------------------------------------------ scan

const allFindings = [];
const suppressed = [];
for (const { label, text, hash } of items) {
  const findings = findMatches(label, text);
  const exception = hash ? exceptionsByHash.get(hash) : undefined;
  if (!exception) {
    allFindings.push(...findings);
    continue;
  }
  for (const finding of findings) {
    if (exception.why.has(finding.why)) {
      // Admitted: exactly this commit, exactly this recorded finding
      // category. A finding whose "why" is NOT in the recorded set (e.g. a
      // denylist term added after this exception was written) still falls
      // through to allFindings below — the exception is not a blanket
      // amnesty for the commit, only for what was actually reviewed.
      suppressed.push({ label, why: finding.why, ref: exception.ref });
    } else {
      allFindings.push(finding);
    }
  }
}

console.log(
  `check-commit-messages: scanned ${items.length} item(s)${range ? ` in range "${range}"` : ""}${
    titleArg ? " plus 1 PR title" : ""
  }`
);
console.log(`mode: ${mode} (denylist v${denylist.version}, ${denylist.terms.length} terms)`);
if (suppressed.length > 0) {
  console.log(`\n${suppressed.length} historical exception(s) applied from ${exceptionsPath}:`);
  for (const s of suppressed) {
    console.log(`  ${s.label} (${s.ref}): ${s.why}`);
  }
}

if (allFindings.length > 0) {
  console.error(`\nFAIL — ${allFindings.length} identity finding(s) in commit message text:\n`);
  for (const f of allFindings) {
    console.error(`  [${f.severity}] ${f.label}: ${f.why}`);
  }
  console.error(
    "\nA commit message is exactly as public and exactly as permanent as any file it changes.\n" +
      "Editing a later commit does NOT remove this from history — it requires a history\n" +
      "rewrite (or deleting and recreating the repository) to actually fix.\n"
  );
  process.exit(1);
}

console.log("\nPASS — no private identity found in scanned commit message text.");
