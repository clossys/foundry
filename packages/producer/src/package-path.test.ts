import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
