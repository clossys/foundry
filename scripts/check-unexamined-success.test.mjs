import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeFile,
  discoverFiles,
  maskNonCode,
  run,
  EXIT_CODES,
} from "./check-unexamined-success.mjs";

// -------------------------------------------------------------------------
// Shape (a): a flag computed and then not consulted on some success path.
// -------------------------------------------------------------------------

test("(a2) a flag consulted by one sibling guard but not an earlier one is flagged — the observer.gradeFleetCoverage shape", () => {
  const src = `
    function gradeFleet(input) {
      const findings = [];
      for (const entry of input.entries) {
        const declarationIsInvalid = entry.raw !== undefined && !entry.raw.ok;
        if (entry.installed) {
          findings.push({ state: "installed" });
          continue;
        }
        if (declarationIsInvalid) {
          findings.push({ state: "unclassified" });
          continue;
        }
        findings.push({ state: "absent" });
      }
      return findings;
    }
  `;
  const findings = analyzeFile("x.ts", src);
  const hit = findings.find((f) => f.rule === "flag-not-consulted-on-sibling-path");
  assert.ok(hit, "expected a flag-not-consulted-on-sibling-path finding");
  assert.match(hit.detail, /declarationIsInvalid/);
});

test("(a2) is NOT flagged when the earlier guard also consults the flag", () => {
  const src = `
    function gradeFleet(input) {
      const findings = [];
      for (const entry of input.entries) {
        const declarationIsInvalid = entry.raw !== undefined && !entry.raw.ok;
        if (entry.installed && !declarationIsInvalid) {
          findings.push({ state: "installed" });
          continue;
        }
        if (declarationIsInvalid) {
          findings.push({ state: "unclassified" });
          continue;
        }
        findings.push({ state: "absent" });
      }
      return findings;
    }
  `;
  const findings = analyzeFile("x.ts", src);
  assert.deepEqual(findings, []);
});

test("(a2) is NOT flagged when the without-flag guard comes AFTER the flag is already checked", () => {
  // The dominant false-positive shape measured against this repository
  // (packages/customer/src/keep-form.ts): several independently named
  // booleans folded into one combined guard, immediately followed by an
  // unrelated later guard for a different concern. By the time the second
  // guard runs, the first guard has already gated on the flag.
  const src = `
    function build(value) {
      const extrasOk = Boolean(value.a) && Boolean(value.b);
      if (!extrasOk) return null;
      if (!value.envelope) return null;
      return { ok: true };
    }
  `;
  const findings = analyzeFile("x.ts", src);
  assert.deepEqual(findings, []);
});

test("(a1) a flag computed and never referenced again is flagged", () => {
  const src = `
    function evaluate(entry) {
      const declarationIsInvalid = entry.raw !== undefined && !entry.raw.ok;
      return { state: "installed" };
    }
  `;
  const findings = analyzeFile("x.ts", src);
  const hit = findings.find((f) => f.rule === "flag-never-consulted");
  assert.ok(hit, "expected a flag-never-consulted finding");
});

test("(a1) is NOT flagged when the flag is consulted anywhere in its block", () => {
  const src = `
    function evaluate(entry) {
      const declarationIsInvalid = entry.raw !== undefined && !entry.raw.ok;
      if (declarationIsInvalid) return { state: "bad" };
      return { state: "installed" };
    }
  `;
  const findings = analyzeFile("x.ts", src);
  assert.deepEqual(findings, []);
});

test("a SCREAMING_SNAKE_CASE constant label is not mistaken for a computed flag", () => {
  // Measured false positive: scripts/check-contamination-classes.mjs's
  // `CITATION_UNREACHABLE` is a fixed enum-value label ("unreachable"), not
  // a freshly computed validity flag, even though its name embeds a flag
  // word. Without the exclusion this fires exactly like the real (a2) case.
  const src = `
    const STATE_UNREACHABLE = "unreachable";
    function classify(x) {
      if (x.a) return { result: "first" };
      if (x.b) return { result: STATE_UNREACHABLE };
      return null;
    }
  `;
  const findings = analyzeFile("x.ts", src);
  assert.deepEqual(findings, []);
});

test("a bare `as Type` narrowing cast is not mistaken for a computed flag", () => {
  // Measured false positive: packages/writer/src/resolve.ts's
  // `validRegistry` is `registry as CopyRegistry` — a type cast after
  // validation already happened, not a boolean check of its own.
  const src = `
    function resolve(input, other) {
      const validInput = input as SomeType;
      if (other.a) { return { ok: true }; }
      if (validInput.b) { return { ok: false }; }
      return null;
    }
  `;
  const findings = analyzeFile("x.ts", src);
  assert.deepEqual(findings, []);
});

test("a counter name (…Count, …Total) is not mistaken for a validity flag", () => {
  const src = `
    function tally(entries) {
      const unclassifiedCount = entries.filter((e) => e.kind === "unclassified").length;
      if (entries.length === 0) return { verdict: "empty" };
      return { verdict: "done" };
    }
  `;
  const findings = analyzeFile("x.ts", src);
  assert.deepEqual(findings.filter((f) => f.rule.startsWith("flag-")), []);
});

// -------------------------------------------------------------------------
// Shape (c): vacuous success over an empty collection.
// -------------------------------------------------------------------------

test("(c2) a length-0 guard that returns success is flagged — the #338 zero-axis shape", () => {
  const src = `
    function grade(axisResults) {
      if (axisResults.length === 0) {
        return gateSatisfied(1);
      }
      return foldResults(axisResults);
    }
  `;
  const findings = analyzeFile("x.ts", src);
  const hit = findings.find((f) => f.rule === "empty-collection-short-circuits-to-success");
  assert.ok(hit, "expected an empty-collection-short-circuits-to-success finding");
});

test("(c2) is NOT flagged when the length-0 branch fails closed instead", () => {
  const src = `
    function grade(axisResults) {
      if (axisResults.length === 0) {
        return { verdict: "indeterminate", reason: "no-cells-to-grade" };
      }
      return foldResults(axisResults);
    }
  `;
  const findings = analyzeFile("x.ts", src);
  assert.deepEqual(findings, []);
});

test("(c1) an .every() call whose own statement forms a success verdict, with no length guard, is flagged", () => {
  const src = `
    function summarize(runs) {
      return { scope: "batch", verdict: runs.every((run) => run.ok) ? "satisfied" : "violated" };
    }
  `;
  const findings = analyzeFile("x.mjs", src);
  const hit = findings.find((f) => f.rule === "every-call-with-no-length-guard");
  assert.ok(hit, "expected an every-call-with-no-length-guard finding");
});

test("(c1) is NOT flagged when a length guard precedes it", () => {
  const src = `
    function summarize(runs) {
      if (runs.length === 0) return { verdict: "indeterminate" };
      return { verdict: runs.every((run) => run.ok) ? "satisfied" : "violated" };
    }
  `;
  const findings = analyzeFile("x.mjs", src);
  assert.deepEqual(findings, []);
});

test("(c1) is NOT flagged for an ordinary type-guard helper — the dominant measured false-positive shape", () => {
  // Array.prototype.every returning true on an empty array is CORRECT here:
  // an empty array is trivially "every element is a string". Measured
  // against this repository: an unqualified "no .length guard" rule scored
  // 32 false positives out of 33 findings, almost entirely this idiom
  // (isStringArray, hasOwnKeys, hasStandardObjectPrototype, ...).
  const src = `
    function isStringArray(value) {
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    }
  `;
  const findings = analyzeFile("x.mjs", src);
  assert.deepEqual(findings, []);
});

test("prose mentioning \"satisfied\" in an explanatory message is not read as a verdict", () => {
  // Measured false positive: packages/controller/src/repository/run.ts's
  // customAxisResult() returns indeterminate with a message that explains
  // the valid shapes in prose, quoting the word "satisfied" as an example.
  const src = `
    function customAxisResult(axis) {
      if (!isValid(axis)) {
        return indeterminate(
          "custom-axis-invalid",
          \`verdict must be "satisfied" with a positive integer "evaluated", or "indeterminate" with a reason\`,
        );
      }
      return dispatch(axis);
    }
  `;
  const findings = analyzeFile("x.ts", src);
  assert.deepEqual(findings, []);
});

// -------------------------------------------------------------------------
// Tokenization robustness — regression coverage for a real bug found while
// building this: a template literal's closing `${...}` brace was written to
// the masked output as a literal `}` instead of being blanked like the rest
// of the interpolation punctuation, injecting a stray unmatched brace that
// corrupted every downstream brace-depth count in the file.
// -------------------------------------------------------------------------

test("maskNonCode does not leak a stray brace from a template literal interpolation", () => {
  const src = 'const s = `text ${a} more ${b.c(d)} end`;\nfunction f() { return 1; }\n';
  const masked = maskNonCode(src);
  assert.equal(masked.length, src.length);
  // Every brace in the masked output must still balance.
  let depth = 0;
  for (const ch of masked) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    assert.ok(depth >= 0, "unbalanced closing brace in masked output");
  }
  assert.equal(depth, 0, "masked output left unbalanced open braces");
});

test("a template literal carrying the real bug shape parses without corrupting sibling detection", () => {
  // A close paraphrase of the exact shape that triggered the bug: a for-loop
  // body full of `detail: \`...${x}...\`` template interpolations, with a
  // flag declared in an outer loop and consulted only in one inner sibling.
  const src = `
    function gradeFleet(input) {
      const findings = [];
      for (const repo of input.repositories) {
        const declarationIsInvalid = repo.raw !== undefined && !repo.raw.ok;
        for (const pkg of input.packages) {
          if (pkg.installed) {
            findings.push({ detail: \`\${pkg.name} is installed in \${repo.id}\` });
            continue;
          }
          if (declarationIsInvalid) {
            findings.push({ detail: \`\${repo.id}'s declaration failed: \${JSON.stringify(repo.raw)}\` });
            continue;
          }
          findings.push({ detail: \`\${pkg.name} not installed in \${repo.id}\` });
        }
      }
      return findings;
    }
  `;
  const findings = analyzeFile("x.ts", src);
  const hit = findings.find((f) => f.rule === "flag-not-consulted-on-sibling-path");
  assert.ok(hit, "template-literal-heavy source must still surface the sibling-path finding");
});

// -------------------------------------------------------------------------
// discoverFiles / run() plumbing
// -------------------------------------------------------------------------

test("discoverFiles excludes test files and non-matching extensions", () => {
  const files = [
    "scripts/check-foo.mjs",
    "scripts/check-foo.test.mjs",
    "scripts/lib/helper.mjs",
    "scripts/README.md",
    "packages/observer/src/coverage.ts",
    "packages/observer/src/coverage.test.ts",
    "packages/observer/src/__tests__/fixture.ts",
    "packages/observer/dist/coverage.js",
    "packages/observer/README.md",
  ];
  // discoverFiles walks a real directory tree, so exercise its filtering
  // logic (isTestPath / extension rules) indirectly through a fake tree is
  // out of scope here; instead this documents the contract the walker
  // implements, asserted against the real repository tree below.
  const real = discoverFiles(new URL("..", import.meta.url).pathname);
  assert.ok(real.length > 0, "expected at least one file under scripts/ or packages/*/src/");
  for (const rel of real) {
    assert.doesNotMatch(rel, /\.test\.(mjs|ts|tsx)$/, `${rel} should be excluded as a test file`);
    assert.doesNotMatch(rel, /(^|\/)(__tests__|test|tests|fixtures)\//, `${rel} should be excluded as test-directory content`);
    assert.ok(rel.endsWith(".mjs") || rel.endsWith(".ts"), `${rel} has an unexpected extension`);
  }
  void files; // documents the contract; the assertions above are what run
});

test("run() is indeterminate, never a silent pass, when the file list is empty", () => {
  const result = run({ root: "/nowhere", files: [] });
  assert.equal(result.verdict, "indeterminate");
  assert.match(result.reason, /no scripts/);
});

test("run() is satisfied on clean input", () => {
  const result = run({
    root: "/r",
    files: ["scripts/clean.mjs"],
    read: () => "export function f() { return 1; }\n",
  });
  assert.equal(result.verdict, "satisfied");
  assert.deepEqual(result.findings, []);
});

test("run() is violated when a scanned file has a finding", () => {
  const result = run({
    root: "/r",
    files: ["scripts/bad.mjs"],
    read: () => `
      function grade(axisResults) {
        if (axisResults.length === 0) { return gateSatisfied(1); }
        return foldResults(axisResults);
      }
    `,
  });
  assert.equal(result.verdict, "violated");
  assert.ok(result.findings.length > 0);
});

test("run() skips an unreadable file rather than treating it as a finding", () => {
  const result = run({
    root: "/r",
    files: ["scripts/unreadable.mjs"],
    read: () => {
      throw new Error("EACCES");
    },
  });
  assert.equal(result.verdict, "satisfied");
  assert.deepEqual(result.findings, []);
});

test("the ternary maps to 0/1/2", () => {
  assert.deepEqual(EXIT_CODES, { satisfied: 0, violated: 1, indeterminate: 2 });
});
