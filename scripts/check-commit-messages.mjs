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
// Unlike check-public-safety.mjs, this gate applies NO neutralize
// exceptions: a commit message never legitimately needs to state private
// identity (unlike, say, package.json's author field), so the strictest
// possible check is also the simplest one to reason about.
//
// This intentionally duplicates a small amount of matching logic from
// check-public-safety.mjs rather than importing it, since that script's
// internals are independently maintained — share the logic via a common
// module if the two ever drift apart enough to matter.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function flagValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));

const range = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
const titleArg = flagValue("--title");

if (!range && !titleArg) {
  console.error(
    "usage: check-commit-messages.mjs <git-rev-range> [--title <pr-title>] [--require-denylist] [--denylist <file>]"
  );
  process.exit(2);
}

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

const items = []; // [{ label, text }]

if (titleArg) {
  items.push({ label: "PR title", text: titleArg });
}

if (range) {
  let raw;
  try {
    // %x00 as a record separator, %x01 as a hash/message separator — neither
    // byte occurs in valid UTF-8 commit text, so this can't be confused by
    // pathological commit content.
    raw = execFileSync("git", ["log", range, "--format=%H%x01%B%x00"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // Fail CLOSED on a git error (bad range, not a git repo, etc.) rather than
    // silently reporting zero commits scanned as if that were a clean pass.
    console.error(`check-commit-messages: failed to read git log for range "${range}": ${error.message}`);
    process.exit(2);
  }
  const records = raw.split("\0").filter((r) => r.length > 0);
  for (const record of records) {
    // `--format=` is shorthand for `tformat:`; since the format string doesn't
    // end in %n, git appends its own newline after each entry in addition to
    // the %x00 we asked for. That glues a leading "\n" onto every record but
    // the first after the split above — strip it before slicing out the hash.
    const clean = record.replace(/^\r?\n/, "");
    const sep = clean.indexOf("\x01");
    if (sep === -1) continue;
    const hash = clean.slice(0, sep);
    const message = clean.slice(sep + 1);
    items.push({ label: `commit ${hash.slice(0, 12)}`, text: message });
  }
  if (records.length === 0) {
    console.log(`check-commit-messages: range "${range}" contains no commits — nothing to scan.`);
  }
}

// ------------------------------------------------------------------------ scan

const allFindings = [];
for (const { label, text } of items) {
  allFindings.push(...findMatches(label, text));
}

console.log(
  `check-commit-messages: scanned ${items.length} item(s)${range ? ` in range "${range}"` : ""}${
    titleArg ? " plus 1 PR title" : ""
  }`
);
console.log(`mode: ${mode} (denylist v${denylist.version}, ${denylist.terms.length} terms)`);

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
