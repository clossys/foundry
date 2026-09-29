import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { evaluateCiConventions } from "./ci-conventions.js";
import { templatePath } from "./documents.js";
import { parseYamlLite, type YamlValue } from "./yaml-lite.js";

// conventions/templates/product-ci-workflow.yml is what a client product
// repository's setup pull request writes as .github/workflows/clossys-ci.yml.
// These tests hold the shipped bytes to the same checker every other
// workflow answers to, and execute the install step's lockfile decision
// against stubbed package managers so the fail-closed claim is measured,
// not asserted in prose.

const INSTALLED_PATH = ".github/workflows/clossys-ci.yml";
const content = readFileSync(templatePath("product-ci-workflow.yml"), "utf8");

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, YamlValue> };

function verifySteps(): Step[] {
  const doc = parseYamlLite(content) as { jobs: Record<string, { steps: Step[] }> };
  return doc.jobs["verify-product"]!.steps;
}

function runBodies(): string[] {
  return verifySteps()
    .map((s) => s.run)
    .filter((r): r is string => typeof r === "string");
}

function installBody(): string {
  const step = verifySteps().find((s) => typeof s.run === "string" && s.run.includes("--frozen-lockfile"));
  if (!step?.run) throw new Error("install step not found");
  return step.run;
}

describe("conventions/templates/product-ci-workflow.yml", () => {
  it("satisfies ci-conventions-check with verify-product as the required context", () => {
    const result = evaluateCiConventions({
      workflowFiles: [{ path: INSTALLED_PATH, content }],
      ruleset: { requiredContexts: ["verify-product"], maxRetentionDays: 14 },
      declaration: {
        visibility: "public",
        requiredContextWorkflows: { "verify-product": INSTALLED_PATH },
      },
      packageVersion: "0.0.0-test",
    });

    expect(result.verdict).toBe("satisfied");
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("declares one job named verify-product", () => {
    const doc = parseYamlLite(content) as { name: string; jobs: Record<string, unknown> };
    expect(doc.name).toBe("Clossys CI");
    expect(Object.keys(doc.jobs)).toEqual(["verify-product"]);
  });

  it("pins every action to a full 40-hex commit SHA", () => {
    const uses = [...content.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("does not use pull_request_target, secrets, or a setup-node cache key", () => {
    expect(content).not.toContain("pull_request_target");
    expect(content).not.toMatch(/\bsecrets\./);
    expect(content).not.toMatch(/^\s*cache:/m);
    expect(content).toMatch(/persist-credentials:\s*false/);
  });

  it("keeps ${{ }} expressions out of every run body", () => {
    const bodies = runBodies();
    expect(bodies.length).toBeGreaterThanOrEqual(3);
    for (const body of bodies) expect(body).not.toContain("${{");
  });

  it("selects the manager for build and test from the install step's decision", () => {
    const bodies = runBodies();
    expect(bodies).toContain('"${PM:?}" run --if-present build');
    expect(bodies).toContain('"${PM:?}" run --if-present test');
  });
});

describe("install step lockfile decision", () => {
  const root = mkdtempSync(join(tmpdir(), "product-ci-install-"));
  const stubBin = join(root, "bin");
  mkdirSync(stubBin);
  for (const tool of ["npm", "pnpm", "corepack"]) {
    const p = join(stubBin, tool);
    writeFileSync(p, `#!/bin/sh\necho "${tool} $*" >> "$STUBLOG"\nexit 0\n`);
    chmodSync(p, 0o755);
  }
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  let n = 0;
  function runInstall(lockfiles: string[]) {
    const dir = join(root, `case-${n++}`);
    mkdirSync(dir);
    for (const f of lockfiles) writeFileSync(join(dir, f), "");
    const stubLog = join(dir, "..", `stub-${n}.log`);
    const githubEnv = join(dir, "..", `github-env-${n}`);
    writeFileSync(stubLog, "");
    writeFileSync(githubEnv, "");
    const res = spawnSync("bash", ["-eo", "pipefail", "-c", installBody()], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: `${stubBin}:/usr/bin:/bin`,
        STUBLOG: stubLog,
        GITHUB_ENV: githubEnv,
      },
    });
    return {
      status: res.status,
      output: `${res.stdout}${res.stderr}`,
      calls: readFileSync(stubLog, "utf8").split("\n").filter(Boolean),
      githubEnv: readFileSync(githubEnv, "utf8"),
    };
  }

  for (const [label, files] of [
    ["only yarn.lock", ["yarn.lock"]],
    ["yarn.lock beside package-lock.json", ["yarn.lock", "package-lock.json"]],
    ["yarn.lock beside pnpm-lock.yaml", ["yarn.lock", "pnpm-lock.yaml"]],
    ["both lockfiles", ["package-lock.json", "pnpm-lock.yaml"]],
    ["no lockfile", []],
  ] as const) {
    it(`refuses ${label} without running any package manager`, () => {
      const r = runInstall([...files]);
      expect(r.status).not.toBe(0);
      expect(r.output).toContain("::error::");
      expect(r.calls).toEqual([]);
      expect(r.githubEnv).toBe("");
    });
  }

  it("runs npm ci --ignore-scripts for only package-lock.json", () => {
    const r = runInstall(["package-lock.json"]);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(["npm ci --ignore-scripts"]);
    expect(r.githubEnv).toContain("npm");
  });

  it("runs corepack enable then pnpm install --frozen-lockfile --ignore-scripts for only pnpm-lock.yaml", () => {
    const r = runInstall(["pnpm-lock.yaml"]);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(["corepack enable", "pnpm install --frozen-lockfile --ignore-scripts"]);
    expect(r.githubEnv).toContain("pnpm");
  });
});
