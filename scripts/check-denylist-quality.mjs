#!/usr/bin/env node
// check-denylist-quality — assert properties of the REAL denylist without ever
// echoing a term.
//
//   node scripts/check-denylist-quality.mjs [--denylist <file>] [--scope-config <file>] [--json]
//
// Exit 0 = the denylist is well-formed. Exit 1 = quality findings. Exit 2 = cannot run.
//
// Beyond pattern shape (boundary-anchoring, separator-optionality), this also
// checks two structural properties end to end:
//   - self-scope (issue #1): a term must not match this repo's own configured
//     scope or a package name published under it — see "self-scope loading"
//     below, which is why --scope-config exists alongside --denylist.
//   - self-containment (issue #2): a term's `why`/`boundaryJustification`
//     text must never contain another term's literal value — see the
//     "self-containment" section near the bottom.
//
// WHY THIS IS SEPARATE FROM test-gates.mjs
// ----------------------------------------
// test-gates.mjs proves the gate's MECHANISM works, using a synthetic denylist.
// It deliberately never touches the real terms, because it lives in a public
// repository and hardcoding real terms would publish them.
//
// But the mechanism being correct says nothing about whether the real DATA is
// any good. A denylist of perfectly-executed patterns that all miss the form
// the identity actually takes in the wild is a gate that passes everything.
// That is not hypothetical: a boundary-anchored identity term can match every
// separated rendering of a name and still miss the bare unbroken compound —
// which is exactly how it appears as a GitHub handle, an npm scope, and a URL
// slug.
//
// So this script reads the real denylist and grades the patterns themselves.
// Every finding is reported BY INDEX AND `why`, never by pattern or by example,
// so the output is safe in a CI log. It is the one check that cannot be written
// as a fixture, because its subject is the live data.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// There is deliberately no generic on-disk fallback here. A machine may hold
// several repositories' denylists, and selecting a same-named file from the
// wrong repository makes the quality result look authoritative while grading
// different policy data from the tree scan. The caller must choose one policy
// explicitly (as an argument or environment capability), just like
// check-public-safety.mjs.
const denylistPath = flagValue("--denylist") ?? process.env.PUBLIC_SAFETY_DENYLIST ?? null;

if (!denylistPath) {
  console.error(
    "check-denylist-quality: no denylist selected — set --denylist <file> or $PUBLIC_SAFETY_DENYLIST; " +
      "refusing to grade an unselected policy",
  );
  process.exit(2);
}
if (!existsSync(denylistPath)) {
  console.error(`check-denylist-quality: denylist not found at ${denylistPath}`);
  process.exit(2);
}

let denylist;
try {
  denylist = JSON.parse(readFileSync(denylistPath, "utf8"));
} catch (error) {
  console.error(`check-denylist-quality: denylist does not parse: ${error.message}`);
  process.exit(2);
}
if (!Array.isArray(denylist.terms) || denylist.terms.length === 0) {
  console.error("check-denylist-quality: denylist has no terms");
  process.exit(2);
}

// ------------------------------------------------------- self-scope loading

// A denylist term that matches this repository's own configured publishing
// scope, or one of the package names published under it, is almost
// certainly a self-reference rather than a real leak signal (issue #1): it
// was built from evidence that happened to include this repo's own scope or
// package names, and nothing caught that before merge — a real incident
// produced 276 hits across 59 files, every one a legitimate self-reference.
// Left unflagged that term is a dead trap either way it gets used
// downstream: check-public-safety.mjs either ignores it in practice (a
// pattern nobody bothered to keep, so why have it) or enforces it (which
// flags every legitimate mention of this repo's own scope, making the gate
// unusable on its own source).
//
// package-scope.json is this repository's single source of truth for the
// scope — see that file's own $comment. This script takes no directory
// argument the way check-public-safety.mjs does (it always inspects the
// ambient denylist, not a scanned tree), so its location relative to
// package-scope.json is the fixed repo layout: scripts/check-denylist-quality.mjs
// sits one level under the repo root, the same fixed relationship
// test-gates.mjs relies on for its own `repoRoot`. --scope-config overrides
// that default for hermetic testing — the same escape hatch
// check-public-safety.mjs offers via its own --scope-config flag.
//
// Missing or unparseable scope config is treated exactly like a missing or
// unparseable denylist above: FAILURE (exit 2), never a quiet skip. A skip
// here would mean this script can report PASS having never actually run the
// one check issue #1 asks for — "could not check" and "checked, and it was
// fine" must never share an exit code.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const scopeConfigPath = flagValue("--scope-config") ?? join(scriptDir, "..", "package-scope.json");

let scopeConfig;
try {
  scopeConfig = JSON.parse(readFileSync(scopeConfigPath, "utf8"));
} catch (error) {
  console.error(
    `check-denylist-quality: cannot load the scope configuration needed for the self-scope check (${scopeConfigPath}): ` +
      `${error.code === "ENOENT" ? "not found" : error.message}\n` +
      `  set --scope-config <file> to point at package-scope.json (or an equivalent fixture).\n` +
      `  Refusing to report a pass from a scan that never checked terms against this repo's own scope.`,
  );
  process.exit(2);
}
if (typeof scopeConfig.scope !== "string" || !scopeConfig.scope.trim()) {
  console.error(
    `check-denylist-quality: ${scopeConfigPath} has no non-empty \`scope\` string — cannot run the self-scope check.`,
  );
  process.exit(2);
}

// Every package.json under packages/*, resolved relative to wherever the
// scope config was found — in the real repo that is packages/ at the repo
// root; in a test fixture it is whatever sibling directory the fixture set
// up next to its synthetic package-scope.json. A package.json that is
// absent or fails to parse is skipped rather than aborting the whole gate:
// widening self-scope coverage is this check's job, not re-validating every
// manifest (check-public-safety.mjs and the build already do that).
const packagesDir = join(dirname(scopeConfigPath), "packages");
const packageNames = [];
if (existsSync(packagesDir)) {
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(packagesDir, entry.name, "package.json"), "utf8"));
      if (typeof manifest.name === "string" && manifest.name) packageNames.push(manifest.name);
    } catch {
      // no package.json here, or it doesn't parse — not this check's job to flag that.
    }
  }
}

// Several renderings of the same identity, same reasoning as the
// separator-optional check below: the scope and each package name appear
// both with and without the leading "@" (prose vs. an npm-scope-shaped
// token), and a term is checked against all of them.
const selfScopeCandidates = new Set();
const addSelfScopeCandidate = (s) => {
  if (!s) return;
  selfScopeCandidates.add(s);
  if (s.startsWith("@")) selfScopeCandidates.add(s.slice(1));
};
addSelfScopeCandidate(scopeConfig.scope);
for (const name of packageNames) addSelfScopeCandidate(name);

// Literal core, with regex machinery removed first. Without stripping the
// escape classes, `\b` leaves a stray "b" that reads as a literal chunk and
// silently changes the chunk count — which is how an earlier version of this
// script skipped the exact term the audit had already proven was leaky.
// Factored out (rather than inline in the forEach below) because the
// self-containment check (issue #2) needs the same literal reconstruction
// for terms it never compiles a RegExp for.
function literalChunksOf(pattern) {
  const literalOf = (p) =>
    p
      .replace(/\\[bBdDwWsSnrt]/g, " ") // escape classes, not literals
      .replace(/\\([.\-_/@])/g, "$1") // escaped literals -> themselves
      .replace(/\[[^\]]*\]/g, " ") // character classes
      .replace(/[(){}|?*+^$]/g, " "); // grouping and quantifiers
  return literalOf(pattern)
    .split(/[^A-Za-z0-9]+/)
    .filter((c) => c.length >= 3);
}

const findings = [];
const selfScopeAcknowledged = [];
const acknowledged = [];
const note = (index, why, rule, detail, severity = "medium") =>
  findings.push({ index, why, rule, detail, severity });

denylist.terms.forEach((term, index) => {
  const { pattern, why = "(no why)", severity, boundaryJustification } = term;
  const label = why;

  // A term's own data can carry a documented, reasoned override for the
  // boundary-anchoring trade-off below (kept \b deliberately because the term
  // is an ordinary word — see the check at 3a). That is a decision already
  // made by a human, not an oversight for this script to flag every run. It's
  // still reported, separately, so the record stays visible — but it does not
  // fail CI, which "boundary-anchored" findings otherwise do.
  if (boundaryJustification) {
    acknowledged.push({ index, why: label, note: boundaryJustification });
  }

  // 1. The pattern must compile, and must be case-insensitive-safe. The gate
  //    compiles with "gi", so a pattern relying on case is already covered —
  //    but one that FAILS to compile takes the whole gate down.
  let re;
  try {
    re = new RegExp(pattern, "gi");
  } catch (error) {
    note(index, label, "compiles", `pattern does not compile: ${error.message}`, "critical");
    return;
  }

  // 2. A pattern must not match the empty string. One that does matches every
  //    line in the tree, which reads as "everything is contaminated" and gets
  //    the term deleted rather than fixed.
  re.lastIndex = 0;
  if (re.test("")) {
    note(index, label, "non-empty", "pattern matches the empty string — it will match every line", "critical");
  }

  const literalChunks = literalChunksOf(pattern);

  // 3a. Word-boundary anchoring. A `\b`-anchored pattern matches the term as a
  //     standalone word and MISSES it inside a longer token — which is exactly
  //     how an identity travels: a GitHub handle, an npm scope, a camelCase
  //     identifier, a URL slug. The audit confirmed a real term behaving this
  //     way: every separated rendering caught, the run-together form missed.
  //
  //     There is a genuine trade-off — dropping `\b` on a very short term raises
  //     false positives — so this is reported, not silently rewritten. For a
  //     critical term the trade is not close: a false positive costs a review,
  //     a false negative is an irreversible disclosure.
  if (/\\b/.test(pattern) && !boundaryJustification) {
    const core = literalChunks.join("");
    if (core.length >= 2) {
      re.lastIndex = 0;
      const embedded = `zz${core}zz`;
      if (!re.test(embedded)) {
        note(
          index,
          label,
          "boundary-anchored",
          "\\b-anchored: matches the term as a standalone word but MISSES it embedded in a longer " +
            "token (handle, npm scope, camelCase identifier, URL slug)" +
            (severity === "critical" ? " — and this term is CRITICAL, where a false negative is unrecoverable" : ""),
          severity === "critical" ? "critical" : "high",
        );
      }
    }
  }
  //     Only meaningful when the separator is a hyphen, underscore or space —
  //     the separators a human actually drops when compressing a name into a
  //     handle. A dot or a slash is structural: nobody writes a domain without
  //     its dots or a path without its slashes, so demanding the run-together
  //     form there produces findings for strings that cannot occur, and a
  //     checker that cries wolf gets muted.
  const structuralSeparatorOnly = !/[a-z0-9](\\?[-_ ]|\[[^\]]*[-_ ][^\]]*\])/i.test(pattern);
  if (literalChunks.length >= 2 && !structuralSeparatorOnly) {
    const compound = literalChunks.join("");
    re.lastIndex = 0;
    if (!re.test(compound)) {
      note(
        index,
        label,
        "separator-optional",
        "matches the separated form but NOT the separator-free compound of its own parts " +
          "(that is how an identity appears as a handle, an npm scope, or a URL slug)",
        "high",
      );
    }
  }

  // 4. Severity must be declared and known. An unset severity sorts last in the
  //    gate's report, which is exactly wrong for a term nobody graded.
  if (!severity) {
    note(index, label, "severity-declared", "no severity set — defaults to high but was never graded", "low");
  } else if (!["critical", "high", "medium", "low"].includes(severity)) {
    note(index, label, "severity-known", `severity ${JSON.stringify(severity)} is not a known rank`, "medium");
  }

  // 5. Self-scope (issue #1). A term whose pattern matches this repository's
  //    own configured scope, or a package name published under it, is almost
  //    certainly a self-reference dragged in from the evidence that produced
  //    it — see the setup above for the incident this reproduces.
  //    `selfScopeJustification` is the explicit, at-add-time override the
  //    issue asks for: a documented reason a term legitimately needs to
  //    match the repo's own scope anyway. Same shape as `boundaryJustification`
  //    above — a decision a human already made, recorded rather than
  //    re-litigated on every run, but still visible in the ACKNOWLEDGED list.
  let selfScopeHit = false;
  for (const candidate of selfScopeCandidates) {
    re.lastIndex = 0;
    if (re.test(candidate)) {
      selfScopeHit = true;
      break;
    }
  }
  if (selfScopeHit) {
    if (term.selfScopeJustification) {
      selfScopeAcknowledged.push({ index, why: label, note: term.selfScopeJustification });
    } else {
      note(
        index,
        label,
        "self-scope",
        "matches this repository's own configured scope or a package name published under it — almost " +
          "certainly a self-reference, not a real leak signal; either fix the pattern or add " +
          "`selfScopeJustification` if this is a deliberate, reviewed exception",
        "high",
      );
    }
  }
});

// 6. Every neutralize entry is an exception to a rule, so each one must be
//    justified and, unless it is genuinely global in nature, path-confined.
(denylist.neutralize ?? []).forEach((entry, index) => {
  const why = entry.why ?? entry.note ?? null;
  if (!why) {
    note(index, "(neutralize)", "neutralize-justified", "neutralize entry has no `why` — an unexplained exception", "high");
  }
  if (!entry.paths) {
    // Breadth is about confinement, not pattern length. A `paths` array bounds
    // where a neutralize entry can apply — that is what keeps its blast radius
    // small. Pattern length says nothing about that: a long, elaborate, still
    // context-free pattern unlocks the term everywhere in the tree exactly as
    // a short one does. Judging "broad" by literal-char count is how a
    // long-but-still-global entry passed with zero warning while a real leak
    // sat elsewhere in the same scan. So: unconfined is the finding, full stop
    // — length only appears in the message, never in the gate.
    const literalChars = (entry.pattern ?? "").replace(/[\\^$.*+?()[\]{}|]/g, "").length;
    note(
      index,
      "(neutralize)",
      "neutralize-breadth",
      `global (unconfined) neutralize entry — no \`paths\` confinement (${literalChars} literal char(s) in the ` +
        "pattern, but length is not the risk: unconfined means it can unlock the term anywhere in the tree)",
      "high",
    );
  }
  try {
    new RegExp(entry.pattern, "gi");
  } catch (error) {
    note(index, "(neutralize)", "compiles", `neutralize pattern does not compile: ${error.message}`, "critical");
  }
});

// 7. Self-containment (issue #2). A term's own `why`/`boundaryJustification`
//    text must never contain another term's literal value. Those fields are
//    printed verbatim by this very script (see the header) — they are what a
//    human reads most closely when reviewing the denylist, so a leak there
//    is the worst place for one: the file whose entire job is defining what
//    must stay secret becomes the place secrets leak in plaintext. A real
//    incident put an actual term value in a `why` field and it rode straight
//    into public CI logs until caught by hand.
//
//    Compared as the literal, separator-free compound of each OTHER term's
//    pattern (the same reconstruction the separator-optional check above
//    uses) against the field text with its own separators stripped too —
//    that catches "acme-corp", "acme corp", and "acme.corp" all landing on
//    the same normalized needle, which is the realistic range of ways a
//    value gets typed into hand-written prose. Never printed: only the
//    finding's term index and field name are reported, exactly like every
//    other check in this file.
//
//    A single short, generic literal chunk (e.g. a 3-letter fragment) is
//    excluded from the SOURCE side — it would false-positive on ordinary
//    English inside unrelated `why` text constantly, and training reviewers
//    to ignore this finding is worse than the narrow gap it would close. A
//    compound of two or more chunks, or one distinctive chunk of real
//    length, is what an actual identity term reduces to.
//
//    THAT EXCLUSION MUST NEVER BE SILENT. A short opaque handle is not a
//    rare edge case — it is one of the likeliest shapes for a thing that
//    genuinely is a secret, and "excluded from comparison" and "compared
//    and found clean" must never look the same in the output. So every
//    excluded term is collected in `selfContainmentExcluded` below and
//    reported unconditionally — on a PASS as much as a FAIL, in --json as
//    much as plain text — by index and reason, never by value. It does NOT
//    fail the run by itself: failing on a short term nobody can safely
//    lengthen would be noise, and noise is exactly what trains reviewers to
//    stop reading gate output (same reasoning `boundaryJustification` and
//    `selfScopeJustification` already rest on elsewhere in this file). The
//    excluded term is still checked as a possible TARGET (its own why/
//    boundaryJustification text is still scanned for every other term's
//    value) — only its own value is too short to safely search FOR.
function selfContainmentValueOf(pattern) {
  const chunks = literalChunksOf(pattern ?? "");
  if (chunks.length === 0) {
    return { compound: null, excludeReason: "pattern produced no literal chunks of length >= 3 (pure regex machinery, or an empty pattern) — nothing to search for" };
  }
  if (chunks.length === 1 && chunks[0].length < 6) {
    return { compound: null, excludeReason: "pattern reduces to a single literal chunk shorter than 6 characters — excluded as a leak SOURCE to avoid flagging ordinary English constantly" };
  }
  return { compound: chunks.join("").toLowerCase(), excludeReason: null };
}

const selfContainmentExcluded = [];
const termCompounds = denylist.terms.map((t, i) => {
  const { compound, excludeReason } = selfContainmentValueOf(t.pattern);
  if (excludeReason) selfContainmentExcluded.push({ index: i, why: t.why ?? "(no why)", reason: excludeReason });
  return compound;
});

denylist.terms.forEach((term, containerIndex) => {
  for (const field of ["why", "boundaryJustification"]) {
    const text = term[field];
    if (!text) continue;
    const normalized = text.replace(/[^A-Za-z0-9]+/g, "").toLowerCase();
    termCompounds.forEach((compound, sourceIndex) => {
      if (!compound || sourceIndex === containerIndex) return;
      if (normalized.includes(compound)) {
        note(
          containerIndex,
          term.why ?? "(no why)",
          "self-containment",
          `\`${field}\` text contains another term's literal value as a substring — the file meant to define ` +
            "what is secret leaks it in plaintext to the human reading this field",
          "critical",
        );
      }
    });
  }
});

const summary = {
  denylistVersion: denylist.version ?? null,
  termCount: denylist.terms.length,
  neutralizeCount: (denylist.neutralize ?? []).length,
  findings,
  acknowledged,
  selfScopeAcknowledged,
  selfScopeCoverage: { scopeAndPackageCandidates: selfScopeCandidates.size, packageNamesFound: packageNames.length },
  selfContainmentExcluded,
};

if (flags.has("--json")) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(findings.length ? 1 : 0);
}

console.log(
  `check-denylist-quality: denylist v${summary.denylistVersion} — ` +
    `${summary.termCount} term(s), ${summary.neutralizeCount} neutralize entr(ies)`,
);
console.log("(terms are never printed; findings are identified by index and purpose)\n");

// Coverage lines below are printed UNCONDITIONALLY — on a clean PASS exactly
// as on a FAIL — because the failure this whole file exists to close is a
// check that silently narrows what it looks at and reports the narrowed
// result as a full pass. "Checked and clean" and "not checked" must stay
// visually distinguishable no matter which way the run comes out.

console.log(
  `self-scope coverage: checked every term against ${summary.selfScopeCoverage.scopeAndPackageCandidates} candidate(s) ` +
    `(this repo's scope plus ${summary.selfScopeCoverage.packageNamesFound} package name(s) found under packages/*).`,
);
if (summary.selfScopeCoverage.packageNamesFound === 0) {
  console.log(
    "  !! no packages/*/package.json found — self-scope coverage is the bare scope string only, not this repo's " +
      "published package names. Confirm that's expected (a fresh checkout before any packages) before trusting this scan.",
  );
}
console.log("");

if (selfContainmentExcluded.length) {
  console.log(
    `SELF-CONTAINMENT COVERAGE — ${selfContainmentExcluded.length} of ${summary.termCount} term(s) EXCLUDED as a leak ` +
      "SOURCE (their own pattern produced no comparable literal value) — these were NOT compared against other terms' " +
      "prose; they are still checked as a possible TARGET. This does not fail the run by itself — see the comment above " +
      "`selfContainmentValueOf` for why — but it must never be mistaken for \"compared and found clean\":",
  );
  for (const e of selfContainmentExcluded) {
    console.log(`  term #${e.index} (${e.why}): ${e.reason}`);
  }
  console.log("");
} else {
  console.log("self-containment coverage: every term's pattern produced a comparable literal value; full source-side coverage.\n");
}

if (acknowledged.length) {
  console.log(`ACKNOWLEDGED — ${acknowledged.length} boundary-anchoring exception(s), documented and not failing:`);
  for (const a of acknowledged) {
    console.log(`  term #${a.index} (${a.why}): ${a.note}`);
  }
  console.log("");
}

if (selfScopeAcknowledged.length) {
  console.log(`ACKNOWLEDGED — ${selfScopeAcknowledged.length} self-scope exception(s), documented and not failing:`);
  for (const a of selfScopeAcknowledged) {
    console.log(`  term #${a.index} (${a.why}): ${a.note}`);
  }
  console.log("");
}

if (!findings.length) {
  console.log(
    "PASS — every term compiles, is non-empty, is graded, covers its separator-free form, stays clear of this " +
      "repo's own scope, and no `why`/`boundaryJustification` text contains another term's value (see coverage " +
      "notes above for what that PASS does and does not include).",
  );
  process.exit(0);
}

const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
for (const f of [...findings].sort((a, b) => (RANK[a.severity] ?? 4) - (RANK[b.severity] ?? 4))) {
  console.log(`  [${f.severity}] term #${f.index} (${f.why})`);
  console.log(`      rule: ${f.rule}`);
  console.log(`      ${f.detail}\n`);
}

console.log(`FAIL — ${findings.length} denylist quality finding(s).`);
process.exit(1);
