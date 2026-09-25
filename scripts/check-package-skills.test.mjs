// Regression tests for check-package-skills.mjs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluatePackageSkills, scanPackageSkills } from "./check-package-skills.mjs";
import { makeTmpDirSync } from "./lib/tmp-fixture.mjs";
import { spawnCapture } from "./lib/spawn-capture.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "check-package-skills.mjs");
const repoRoot = resolve(scriptDir, "..");

const validSkill = (name, description, disable = true) => `---
name: ${name}
description: ${description}
${disable ? "disable-model-invocation: true" : ""}
---

# ${name}

Body.
`;

// One entry per advisor degraded-mode check (issue #1507). These are
// deliberately scoped INSIDE a "## Degraded mode" heading followed by a
// second "## Elsewhere" heading carrying decoy text (clossys/brief.json,
// advisor-resolve-packages, and every negator word) — proving both
// directions of the section-scoping fix: a part removed from inside the
// section still fails even though its decoy twin sits right outside it,
// and text outside the section never satisfies a rule on its own.
const ADVISOR_DEGRADED_PARTS = {
  hubCase: "**In the hub.** Everything above this section applies unchanged.",
  siblingCase: "**A hub checkout sits beside this repository.** Read its engagement state read-only.",
  noHubCase: "**No hub reachable.** Give a short read-only report instead of guessing.",
  markerKind: 'Treat this checkout as the hub only once `kind` is `"account-hub"`.',
  markerSchema: "Treat this checkout as the hub only once `schemaVersion` is `1`.",
  markerOrigin: "The marker's `repository` must equal this checkout's own git origin.",
  legacyMarker: "If only the legacy `.clossys/workspace.json` marker validates, the hub has not migrated yet.",
  inventoryPath: "A sibling counts as the hub only once its own clossys/.state/inventory.json is read.",
  inventoryMembership: "Accept a sibling hub only once its inventory lists this repository's id.",
  ambiguousHubs: "If more than one sibling validates, stop and report every one you found.",
  briefFallback: "With no hub reachable, report read-only from clossys/brief.json.",
  refusalSentence: "Refuse every decision and every write outside the hub — never only hiring, a plan change, or an approval.",
  writeNothingSentence: "Write nothing under `clossys/`, here or in a hub checkout you found beside this one.",
  neverInstallSentence: "Never install `@clossys/advisor` in this repository, even to answer a status question.",
  npxInvocation: "Run the hub's exact pin with npx --package=@clossys/advisor@<hub version> <bin>.",
  devDepsSource: 'Read the hub version from devDependencies["@clossys/advisor"].',
  nextStepPhrasing: 'Say `Open <hub repository> in Claude Code and type "/clossys-advisor loop".`',
  noContinueAsHub: "Do not continue this conversation as though you were already standing in the hub.",
};

// Expected rule id for each part above, used by the omission test.
const ADVISOR_DEGRADED_RULE_BY_PART = {
  hubCase: "advisor-degraded-hub-case",
  siblingCase: "advisor-degraded-sibling-case",
  noHubCase: "advisor-degraded-no-hub-case",
  markerKind: "advisor-degraded-marker-kind",
  markerSchema: "advisor-degraded-marker-schema",
  markerOrigin: "advisor-degraded-marker-origin",
  legacyMarker: "advisor-degraded-legacy-marker",
  inventoryPath: "advisor-degraded-inventory-path",
  inventoryMembership: "advisor-degraded-inventory-membership",
  ambiguousHubs: "advisor-degraded-ambiguous-hubs",
  briefFallback: "advisor-degraded-brief-fallback",
  refusalSentence: "advisor-degraded-refusal-sentence",
  writeNothingSentence: "advisor-degraded-write-nothing-sentence",
  neverInstallSentence: "advisor-degraded-never-install-sentence",
  npxInvocation: "advisor-degraded-npx-invocation",
  devDepsSource: "advisor-degraded-devdeps-source",
  nextStepPhrasing: "advisor-degraded-next-step-phrasing",
  noContinueAsHub: "advisor-degraded-no-continue-as-hub",
};

// Phrases that plausibly reverse the section's meaning while leaving every
// positive rule above still matching — the mutation-style guards B4 asks
// for. Each maps to the negator rule it must trip.
const ADVISOR_DEGRADED_NEGATORS = {
  retired: { phrase: "This validation is now retired.", rule: "advisor-degraded-negator-retired" },
  mayRun: { phrase: "A founder may run advisor-resolve-packages here.", rule: "advisor-degraded-negator-may-run" },
  npmInstall: { phrase: "Or just npm install @clossys/advisor here.", rule: "advisor-degraded-negator-npm-install" },
};

function advisorDegradedSectionBody(omitKey, extraLine) {
  const lines = Object.entries(ADVISOR_DEGRADED_PARTS)
    .filter(([key]) => key !== omitKey)
    .map(([, line]) => line)
    .join("\n\n");
  const extra = extraLine ? `\n\n${extraLine}` : "";
  // The "## Elsewhere" section and its decoy text sit OUTSIDE the
  // boundary the gate extracts (the next "## " heading) — every phrase a
  // positive or negator rule looks for is repeated here, outside, so a
  // gate that accidentally scanned the whole file instead of the section
  // would wrongly pass every omission/negator case below.
  return `## Degraded mode: locating the hub before you decide anything (issue #1507)

${lines}${extra}

## Elsewhere

Decoy text a whole-file scan would wrongly credit: clossys/brief.json, advisor-resolve-packages, retired, may run, npm install @clossys/advisor, devDependencies["@clossys/advisor"], npx --package=@clossys/advisor@<hub version> <bin>.
`;
}

const advisorSkillText = (omitKey, extraLine, description = "Receptionist skill.") => `---
name: clossys-advisor
description: ${description}
---

${advisorDegradedSectionBody(omitKey, extraLine)}
`;

test("valid frontmatter passes", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "alpha",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-alpha",
      skillText: validSkill("clossys-alpha", "Third-person description for alpha role."),
      files: ["dist", "skill"],
    },
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.findings.length, 0);
});

test("slash and at-sign in name are rejected", () => {
  const badSlash = evaluatePackageSkills([
    {
      packageDir: "beta",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-beta",
      skillText: validSkill("clossys/beta", "Description."),
      files: ["skill"],
    },
  ]);
  assert.equal(badSlash.exitCode, 1);
  assert.ok(badSlash.findings.some((f) => f.rule === "name-mismatch" || f.rule === "invalid-name-chars"));

  const badAt = evaluatePackageSkills([
    {
      packageDir: "beta",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-beta",
      skillText: validSkill("clossys-beta@", "Description."),
      files: ["skill"],
    },
  ]);
  assert.ok(badAt.findings.some((f) => f.rule === "invalid-name-chars" || f.rule === "name-pattern"));
});

test("non-advisor packages require disable-model-invocation", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "gamma",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-gamma",
      skillText: `---
name: clossys-gamma
description: Missing disable flag.
---

Body.`,
      files: ["skill"],
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.findings.map((f) => f.rule), ["disable-model-invocation"]);
});

test("advisor may omit disable-model-invocation", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "advisor",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-advisor",
      skillText: advisorSkillText(),
      files: ["skill"],
    },
  ]);
  assert.equal(result.exitCode, 0);
});

test("advisor skill passes with the full degraded-mode section present", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "advisor",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-advisor",
      skillText: advisorSkillText(),
      files: ["skill"],
    },
  ]);
  assert.equal(result.exitCode, 0, JSON.stringify(result.findings));
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.passed, [{ packageDir: "advisor", name: "clossys-advisor" }]);
});

test("advisor skill has no degraded-mode section at all is a finding", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "advisor",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-advisor",
      skillText: validSkill("clossys-advisor", "Receptionist skill.", false),
      files: ["skill"],
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.findings.map((f) => f.rule), ["advisor-degraded-section-missing"]);
});

test("advisor skill flags each missing degraded-mode element, even though its decoy twin sits outside the section", () => {
  for (const [omitKey, expectedRule] of Object.entries(ADVISOR_DEGRADED_RULE_BY_PART)) {
    const result = evaluatePackageSkills([
      {
        packageDir: "advisor",
        skillPath: "/tmp/ignored",
        expectedName: "clossys-advisor",
        skillText: advisorSkillText(omitKey),
        files: ["skill"],
      },
    ]);
    assert.equal(result.exitCode, 1, `expected a finding when omitting ${omitKey}`);
    assert.ok(
      result.findings.some((f) => f.rule === expectedRule),
      `expected rule ${expectedRule} when omitting ${omitKey}, got ${JSON.stringify(result.findings.map((f) => f.rule))}`,
    );
  }
});

test("advisor skill flags a negator inserted inside the degraded-mode section", () => {
  for (const [name, { phrase, rule }] of Object.entries(ADVISOR_DEGRADED_NEGATORS)) {
    const result = evaluatePackageSkills([
      {
        packageDir: "advisor",
        skillPath: "/tmp/ignored",
        expectedName: "clossys-advisor",
        skillText: advisorSkillText(undefined, phrase),
        files: ["skill"],
      },
    ]);
    assert.equal(result.exitCode, 1, `expected a finding for negator ${name}`);
    assert.ok(
      result.findings.some((f) => f.rule === rule),
      `expected rule ${rule} for negator ${name}, got ${JSON.stringify(result.findings.map((f) => f.rule))}`,
    );
  }
});

test("advisor degraded-mode checks fail against the pre-#1507 SKILL.md (proves the checks are not vacuous)", (t) => {
  let preChangeText;
  try {
    preChangeText = execFileSync("git", ["show", "bce95463:packages/advisor/skill/SKILL.md"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  } catch {
    t.skip("commit bce95463 is not reachable in this checkout's git history");
    return;
  }
  // The two checks the review (#1507) found vacuous before this section was
  // scoped: both phrases already appear in the pre-change file, outside any
  // degraded-mode section, and must not be read as satisfying the rules
  // that name them.
  assert.ok(preChangeText.includes("clossys/brief.json"));
  assert.ok(preChangeText.includes("advisor-resolve-packages"));
  const result = evaluatePackageSkills([
    {
      packageDir: "advisor",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-advisor",
      skillText: preChangeText,
      files: ["skill"],
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "advisor-degraded-section-missing"));
});

test("skill without files entry is a finding", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "epsilon",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-epsilon",
      skillText: validSkill("clossys-epsilon", "Description for epsilon."),
      files: ["dist", "README.md", "LICENSE"],
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.findings.map((f) => f.rule), ["files-missing-skill"]);
});

test("skill with files entry passes packing gate", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "zeta",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-zeta",
      skillText: validSkill("clossys-zeta", "Description for zeta."),
      files: ["dist", "LICENSE", "skill"],
    },
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.findings.length, 0);
});

test("missing skill file is a finding", (t) => {
  const temp = makeTmpDirSync(t, "pkg-skill-");
  const pkgRoot = join(temp, "packages", "delta");
  mkdirSync(pkgRoot, { recursive: true });
  writeFileSync(join(pkgRoot, "package.json"), JSON.stringify({ name: "@scope/delta" }));
  const result = evaluatePackageSkills([
    {
      packageDir: "delta",
      skillPath: join(pkgRoot, "skill", "SKILL.md"),
      expectedName: "clossys-delta",
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.findings[0].rule, "missing-skill");
});

test("customer skill requires first-person inhabit and must not be a reviewer", () => {
  const inhabit = `---
name: clossys-customer
description: First-person inhabit of the named audience. Invoke with @clossys-customer when the named person must speak.
disable-model-invocation: true
---

I am the named Audience. Invoke @clossys-customer before seal. I am not a reviewer.
Ask me for feedback, compare, refer, churn, adopt, and worth as the same person.
`;
  const ok = evaluatePackageSkills([
    { packageDir: "customer", skillPath: "/tmp/ignored", expectedName: "clossys-customer", skillText: inhabit },
  ]);
  assert.equal(ok.exitCode, 0, JSON.stringify(ok.findings));

  const reviewer = evaluatePackageSkills([
    {
      packageDir: "customer",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-customer",
      skillText: `---
name: clossys-customer
description: Reviewer skill. Invoke with @clossys-customer when judging a change.
disable-model-invocation: true
---

You are a reviewer. Tick the boxes.
`,
    },
  ]);
  assert.ok(reviewer.findings.some((f) => f.rule === "customer-not-reviewer" || f.rule === "customer-inhabit-language"));

  const missingDial = evaluatePackageSkills([
    {
      packageDir: "customer",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-customer",
      skillText: `---
name: clossys-customer
description: First-person inhabit of the named audience. Invoke with @clossys-customer when the named person must speak.
disable-model-invocation: true
---

I am the named Audience. Invoke @clossys-customer before seal. I am not a reviewer.
`,
    },
  ]);
  assert.ok(missingDial.findings.some((f) => f.rule === "customer-speed-dial-intents"));
});

test("expression-wave skills must name clossys-customer", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "designer",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-designer",
      skillText: validSkill("clossys-designer", "Design tokens."),
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "expression-customer-session"));
});

test("publisher pre-auth section must name MarketingView", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "publisher",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-publisher",
      skillText: `---
name: clossys-publisher
description: Publisher skill.
disable-model-invocation: true
---

## Pre-auth page

SectionedView only.
`,
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "publisher-pre-auth-marketing-view"));
});

test("expression-wave skills without Pre-auth page heading fail", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "designer",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-designer",
      skillText: validSkill("clossys-designer", "Design tokens and components."),
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "pre-auth-page-heading"));
});

test("expression-wave skills must cap taste after fold-check green and forbid self-certify", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "designer",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-designer",
      skillText: `---
name: clossys-designer
description: Design tokens.
disable-model-invocation: true
---

## Pre-auth page

PRE-AUTH-QUALITY exceptional synthetic user does not author keep-review evidence.
`,
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "pre-auth-taste-fold-precondition"));
  assert.ok(result.findings.some((f) => f.rule === "pre-auth-taste-bound"));
  assert.ok(result.findings.some((f) => f.rule === "pre-auth-no-self-certify"));
});

test("strategist skill must state brand-coverage is necessary not sufficient, not keep without do-nots, and name --surfaces", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "strategist",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-strategist",
      skillText: validSkill("clossys-strategist", "Strategy traceability."),
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "strategist-brand-coverage-necessary"));
  assert.ok(result.findings.some((f) => f.rule === "strategist-brand-surfaces-do-not"));
  assert.ok(result.findings.some((f) => f.rule === "strategist-brand-not-keep"));
});

test("expression-wave skills must reference PRE-AUTH-QUALITY, exceptional, synthetic user, and not author keep-review", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "writer",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-writer",
      skillText: `---
name: clossys-writer
description: Copy gates.
disable-model-invocation: true
---

## Pre-auth page

Fill MarketingView slots only.
`,
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "pre-auth-quality-ref"));
  assert.ok(result.findings.some((f) => f.rule === "pre-auth-exceptional"));
  assert.ok(result.findings.some((f) => f.rule === "pre-auth-synthetic-user"));
  assert.ok(result.findings.some((f) => f.rule === "pre-auth-no-author-keep"));
});

test("launcher catalogue drift is a finding", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "alpha",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-alpha",
      skillText: validSkill("clossys-alpha", "Third-person description for alpha role."),
      catalogueText: validSkill("clossys-alpha", "A different packed copy."),
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "catalogue-drift"));
});

test("strategist package.json files includes skill for npm pack", () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "packages/strategist/package.json"), "utf8"));
  assert.ok(Array.isArray(manifest.files), "strategist package.json must declare files");
  assert.ok(manifest.files.includes("skill"), "strategist tarball must pack skill/SKILL.md");
});

test("strategist skill must not treat gate-green as keep", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "strategist",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-strategist",
      skillText: validSkill("clossys-strategist", "Strategy traceability and direction currency."),
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "strategist-pre-auth-quality-ref"));
  assert.ok(result.findings.some((f) => f.rule === "strategist-no-gate-keep"));
  assert.ok(result.findings.some((f) => f.rule === "strategist-gates-prove-3"));
});

test("strategist skill must list directory output files and handoff", () => {
  const result = evaluatePackageSkills([
    {
      packageDir: "strategist",
      skillPath: "/tmp/ignored",
      expectedName: "clossys-strategist",
      skillText: validSkill("clossys-strategist", "Strategy traceability."),
    },
  ]);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "strategist-output-files"));
  assert.ok(result.findings.some((f) => f.rule === "strategist-handoff-subcommand"));
});

test("live repository package skills pass", () => {
  const result = scanPackageSkills(repoRoot);
  assert.equal(result.exitCode, 0, result.findings.map((f) => `${f.packageDir}:${f.rule}`).join(", "));
  assert.equal(result.passed.length, 21);
});

test("CLI exits 0 on this repository", async () => {
  const proc = await spawnCapture(process.execPath, [scriptPath, repoRoot]);
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
});
