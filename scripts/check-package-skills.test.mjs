// Regression tests for check-package-skills.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
    },
  ]);
  assert.equal(result.exitCode, 0);
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

test("expression-wave skills must reference PRE-AUTH-QUALITY and exceptional", () => {
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

test("live repository package skills pass", () => {
  const result = scanPackageSkills(repoRoot);
  assert.equal(result.exitCode, 0, result.findings.map((f) => `${f.packageDir}:${f.rule}`).join(", "));
  assert.equal(result.passed.length, 21);
});

test("CLI exits 0 on this repository", () => {
  const proc = spawnSync(process.execPath, [scriptPath, repoRoot], { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
});
