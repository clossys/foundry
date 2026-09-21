// Regression tests for check-package-skills.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluatePackageSkills, scanPackageSkills } from "./check-package-skills.mjs";

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
      skillText: `---
name: clossys-advisor
description: Receptionist skill.
---

Body.`,
      files: ["skill"],
    },
  ]);
  assert.equal(result.exitCode, 0);
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

test("missing skill file is a finding", () => {
  const temp = mkdtempSync(join(tmpdir(), "pkg-skill-"));
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
Speak from the audience situation and pains only; do not author the audience record.
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

test("CLI exits 0 on this repository", () => {
  const proc = spawnSync(process.execPath, [scriptPath, repoRoot], { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
});
