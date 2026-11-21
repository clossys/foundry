import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGENT_PACKAGES } from "./agents.js";
import { installedPackageRoot, packagePath, PRODUCER_ROOT } from "./package-path.js";

describe("packagePath", () => {
  it("reads package data under a root that carries packages/ (the Foundry repository or a test world)", () => {
    const root = mkdtempSync(join(tmpdir(), "package-path-"));
    mkdirSync(join(root, "packages"));
    expect(packagePath(root, "packages/director/standards")).toBe(join(root, "packages/director/standards"));
  });
  it("reads it from the installed package under a consumer root", () => {
    const root = mkdtempSync(join(tmpdir(), "package-path-"));
    expect(packagePath(root, "packages/director/standards")).toBe(join(installedPackageRoot("director")!, "standards"));
    expect(packagePath(root, "packages/producer/pipeline/actions.json")).toBe(join(PRODUCER_ROOT, "pipeline/actions.json"));
  });
  it("leaves paths outside packages/ and unknown packages at the root", () => {
    const root = mkdtempSync(join(tmpdir(), "package-path-"));
    expect(packagePath(root, "clossys/agents")).toBe(join(root, "clossys/agents"));
    expect(packagePath(root, "packages/not-an-agent/x")).toBe(join(root, "packages/not-an-agent/x"));
  });
});

describe("the contamination check's --skill id packages (CONTAM-U3 D5)", () => {
  // scripts/check-contamination-classes.mjs judges a --skill id the way packagePath reads it, so its list of the
  // packages packagePath maps must be Producer plus AGENT_PACKAGES, no more and no fewer.
  it("are exactly the packages packagePath maps", () => {
    const script = readFileSync(fileURLToPath(new URL("../../../scripts/check-contamination-classes.mjs", import.meta.url)), "utf8");
    const listed = /const SKILL_ID_PACKAGES = (\[[^\]]*\]);/.exec(script)?.[1];
    expect(listed, "SKILL_ID_PACKAGES is declared as one array literal").toBeDefined();
    expect(JSON.parse(listed!)).toEqual(["producer", ...Object.keys(AGENT_PACKAGES)]);
    for (const name of Object.keys(AGENT_PACKAGES)) {
      expect(packagePath(mkdtempSync(join(tmpdir(), "package-path-")), `packages/${name}/x`)).toBe(join(installedPackageRoot(name)!, "x"));
    }
  });
});
