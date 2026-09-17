import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverRoleAssessmentSurface } from "./discovery.js";

let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "onboarding-discovery-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function install(role: string, manifest: Record<string, unknown>, binaries: readonly string[] = []): void {
  const directory = join(root, ...role.split("/"));
  mkdirSync(join(directory, "dist"), { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
  for (const file of binaries) writeFileSync(join(directory, file), "#!/usr/bin/env node\n");
}

describe("role-owned assessment surface discovery", () => {
  it("resolves a declared surface through the role's own bin mapping", () => {
    install("@clossys/advisor", { name: "@clossys/advisor", version: "9.9.9", bin: { "advisor-check": "dist/cli.js" }, foundry: { assessment: { bin: "advisor-check", invocation: "single-json-input" } } }, ["dist/cli.js"]);
    const discovery = discoverRoleAssessmentSurface(root, "@clossys/advisor");
    expect(discovery.absence).toBeNull();
    expect(discovery.surface).toMatchObject({ role: "@clossys/advisor", version: "9.9.9", bin: "advisor-check", invocation: "single-json-input" });
  });

  it("reports a role that is not installed", () => {
    expect(discoverRoleAssessmentSurface(root, "@clossys/writer").absence).toBe("package-not-installed");
  });

  it("reports an unreadable manifest rather than guessing", () => {
    const directory = join(root, "@clossys", "writer");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), "{ not json");
    expect(discoverRoleAssessmentSurface(root, "@clossys/writer").absence).toBe("manifest-unreadable");
  });

  it("never infers a surface from a role that ships CLIs but declares none", () => {
    install("@clossys/keeper", { name: "@clossys/keeper", version: "1.0.0", bin: { "keeper-check": "dist/cli.js" } }, ["dist/cli.js"]);
    expect(discoverRoleAssessmentSurface(root, "@clossys/keeper").absence).toBe("no-assessment-declaration");
  });

  it("refuses a declaration whose invocation kind is not the supported one", () => {
    install("@clossys/giver", { name: "@clossys/giver", version: "1.0.0", bin: { "giver-check": "dist/cli.js" }, foundry: { assessment: { bin: "giver-check", invocation: "interactive-conversation" } } }, ["dist/cli.js"]);
    expect(discoverRoleAssessmentSurface(root, "@clossys/giver").absence).toBe("invalid-assessment-declaration");
  });

  it("refuses a declaration naming a bin the role's own manifest does not map", () => {
    install("@clossys/butler", { name: "@clossys/butler", version: "1.0.0", bin: { "butler-check": "dist/cli.js" }, foundry: { assessment: { bin: "butler-assess", invocation: "single-json-input" } } }, ["dist/cli.js"]);
    expect(discoverRoleAssessmentSurface(root, "@clossys/butler").absence).toBe("undeclared-assessment-bin");
  });

  it("refuses a mapped bin whose file is not installed", () => {
    install("@clossys/bouncer", { name: "@clossys/bouncer", version: "1.0.0", bin: { "bouncer-check": "dist/cli.js" }, foundry: { assessment: { bin: "bouncer-check", invocation: "single-json-input" } } });
    expect(discoverRoleAssessmentSurface(root, "@clossys/bouncer").absence).toBe("assessment-executable-missing");
  });

  it("refuses a bin target that escapes the installed package directory", () => {
    install("@clossys/locksmith", { name: "@clossys/locksmith", version: "1.0.0", bin: { "locksmith-check": "../../../etc/passwd" }, foundry: { assessment: { bin: "locksmith-check", invocation: "single-json-input" } } });
    expect(discoverRoleAssessmentSurface(root, "@clossys/locksmith").absence).toBe("undeclared-assessment-bin");
  });

  it("refuses a manifest whose name is not the role it was installed as", () => {
    install("@clossys/integrator", { name: "a-different-package-name", version: "1.0.0", bin: {}, foundry: { assessment: { bin: "x", invocation: "single-json-input" } } });
    expect(discoverRoleAssessmentSurface(root, "@clossys/integrator").absence).toBe("manifest-unreadable");
  });
});
