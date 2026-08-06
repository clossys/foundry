#!/usr/bin/env node
// check-denylist-quality — assert properties of the REAL denylist without ever
// echoing a term.
//
//   node scripts/check-denylist-quality.mjs [--denylist <file>] [--json]
//
// Exit 0 = the denylist is well-formed. Exit 1 = quality findings. Exit 2 = cannot run.
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

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const denylistPath =
  flagValue("--denylist") ??
  process.env.PUBLIC_SAFETY_DENYLIST ??
  join(homedir(), ".config", "public-safety", "denylist.json");

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

const findings = [];
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

  // Literal core, with regex machinery removed first. Without stripping the
  // escape classes, `\b` leaves a stray "b" that reads as a literal chunk and
  // silently changes the chunk count — which is how an earlier version of this
  // script skipped the exact term the audit had already proven was leaky.
  const literalOf = (p) =>
    p
      .replace(/\\[bBdDwWsSnrt]/g, " ") // escape classes, not literals
      .replace(/\\([.\-_/@])/g, "$1") // escaped literals -> themselves
      .replace(/\[[^\]]*\]/g, " ") // character classes
      .replace(/[(){}|?*+^$]/g, " "); // grouping and quantifiers

  const literalChunks = literalOf(pattern)
    .split(/[^A-Za-z0-9]+/)
    .filter((c) => c.length >= 3);

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
});

// 5. Every neutralize entry is an exception to a rule, so each one must be
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

const summary = {
  denylistVersion: denylist.version ?? null,
  termCount: denylist.terms.length,
  neutralizeCount: (denylist.neutralize ?? []).length,
  findings,
  acknowledged,
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

if (acknowledged.length) {
  console.log(`ACKNOWLEDGED — ${acknowledged.length} boundary-anchoring exception(s), documented and not failing:`);
  for (const a of acknowledged) {
    console.log(`  term #${a.index} (${a.why}): ${a.note}`);
  }
  console.log("");
}

if (!findings.length) {
  console.log("PASS — every term compiles, is non-empty, is graded, and covers its separator-free form.");
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
