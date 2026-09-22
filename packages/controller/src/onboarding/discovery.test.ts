import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverRoleAssessmentSurface,
  discoverRoleFitSurface,
  discoverRoleIntakeSurface,
  discoverRoleOutputsDeclaration,
  discoverRoleStatusSurface,
} from "./discovery.js";

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

describe("role-owned intake surface discovery (issue #1172)", () => {
  it("resolves a declared intake-question-cards file", () => {
    install("@clossys/advisor", { name: "@clossys/advisor", version: "9.9.9", foundry: { intake: "intake-cards.json" } }, ["intake-cards.json"]);
    const discovery = discoverRoleIntakeSurface(root, "@clossys/advisor");
    expect(discovery.absence).toBeNull();
    expect(discovery.surface).toMatchObject({ role: "@clossys/advisor", version: "9.9.9", path: "intake-cards.json" });
  });

  it("never infers an intake surface from a role that declares none", () => {
    install("@clossys/keeper", { name: "@clossys/keeper", version: "1.0.0" });
    expect(discoverRoleIntakeSurface(root, "@clossys/keeper").absence).toBe("no-intake-declaration");
  });

  it("refuses a path that escapes the installed package directory", () => {
    install("@clossys/locksmith", { name: "@clossys/locksmith", version: "1.0.0", foundry: { intake: "../../../etc/passwd" } });
    expect(discoverRoleIntakeSurface(root, "@clossys/locksmith").absence).toBe("invalid-intake-declaration");
  });

  it("refuses a declared path the role does not actually ship", () => {
    install("@clossys/butler", { name: "@clossys/butler", version: "1.0.0", foundry: { intake: "intake-cards.json" } });
    expect(discoverRoleIntakeSurface(root, "@clossys/butler").absence).toBe("intake-file-missing");
  });

  it("reports a role that is not installed", () => {
    expect(discoverRoleIntakeSurface(root, "@clossys/writer").absence).toBe("package-not-installed");
  });
});

describe("role-owned fit-signal surface discovery (issue #1172)", () => {
  it("resolves a declared fit-signal-declarations file", () => {
    install("@clossys/publisher", { name: "@clossys/publisher", version: "2.0.0", foundry: { fit: "fit-signals.json" } }, ["fit-signals.json"]);
    const discovery = discoverRoleFitSurface(root, "@clossys/publisher");
    expect(discovery.absence).toBeNull();
    expect(discovery.surface).toMatchObject({ role: "@clossys/publisher", version: "2.0.0", path: "fit-signals.json" });
  });

  it("never infers a fit surface from a role that declares none", () => {
    install("@clossys/observer", { name: "@clossys/observer", version: "1.0.0" });
    expect(discoverRoleFitSurface(root, "@clossys/observer").absence).toBe("no-fit-declaration");
  });

  it("refuses a declared path the role does not actually ship", () => {
    install("@clossys/giver", { name: "@clossys/giver", version: "1.0.0", foundry: { fit: "fit-signals.json" } });
    expect(discoverRoleFitSurface(root, "@clossys/giver").absence).toBe("fit-file-missing");
  });
});

describe("role-owned status surface discovery (issue #1172)", () => {
  it("resolves a declared read-only status probe through the role's own bin mapping", () => {
    install("@clossys/strategist", { name: "@clossys/strategist", version: "3.0.0", bin: { "strategist-status": "dist/status.js" }, foundry: { status: { bin: "strategist-status", invocation: "single-json-input" } } }, ["dist/status.js"]);
    const discovery = discoverRoleStatusSurface(root, "@clossys/strategist");
    expect(discovery.absence).toBeNull();
    expect(discovery.surface).toMatchObject({ role: "@clossys/strategist", version: "3.0.0", bin: "strategist-status", invocation: "single-json-input" });
  });

  it("never infers a status surface from a role that ships CLIs but declares none", () => {
    install("@clossys/messenger", { name: "@clossys/messenger", version: "1.0.0", bin: { "messenger-check": "dist/cli.js" } }, ["dist/cli.js"]);
    expect(discoverRoleStatusSurface(root, "@clossys/messenger").absence).toBe("no-status-declaration");
  });

  it("refuses a declaration naming a bin the role's own manifest does not map", () => {
    install("@clossys/bouncer", { name: "@clossys/bouncer", version: "1.0.0", bin: { "bouncer-check": "dist/cli.js" }, foundry: { status: { bin: "bouncer-status", invocation: "single-json-input" } } });
    expect(discoverRoleStatusSurface(root, "@clossys/bouncer").absence).toBe("undeclared-status-bin");
  });

  it("refuses a mapped bin whose file is not installed", () => {
    install("@clossys/architect", { name: "@clossys/architect", version: "1.0.0", bin: { "architect-status": "dist/status.js" }, foundry: { status: { bin: "architect-status", invocation: "single-json-input" } } });
    expect(discoverRoleStatusSurface(root, "@clossys/architect").absence).toBe("status-executable-missing");
  });
});

describe("role-owned outputs declaration discovery (issue #1172)", () => {
  it("resolves a declared set of output paths, all under clossys/<role>/", () => {
    install("@clossys/writer", { name: "@clossys/writer", version: "4.0.0", foundry: { outputs: ["clossys/writer/registry.json", "clossys/writer/voice-record.md"] } });
    const discovery = discoverRoleOutputsDeclaration(root, "@clossys/writer");
    expect(discovery.absence).toBeNull();
    expect(discovery.declaration).toMatchObject({ role: "@clossys/writer", version: "4.0.0", paths: ["clossys/writer/registry.json", "clossys/writer/voice-record.md"] });
  });

  it("never infers an outputs declaration from a role that declares none", () => {
    install("@clossys/customer", { name: "@clossys/customer", version: "1.0.0" });
    expect(discoverRoleOutputsDeclaration(root, "@clossys/customer").absence).toBe("no-outputs-declaration");
  });

  it("refuses an empty declaration", () => {
    install("@clossys/designer", { name: "@clossys/designer", version: "1.0.0", foundry: { outputs: [] } });
    expect(discoverRoleOutputsDeclaration(root, "@clossys/designer").absence).toBe("invalid-outputs-declaration");
  });

  it("refuses a path outside this role's own clossys/<role>/ folder", () => {
    install("@clossys/writer", { name: "@clossys/writer", version: "1.0.0", foundry: { outputs: ["clossys/designer/registry.json"] } });
    expect(discoverRoleOutputsDeclaration(root, "@clossys/writer").absence).toBe("output-path-outside-role-folder");
  });

  it("refuses a path that escapes the repository", () => {
    install("@clossys/writer", { name: "@clossys/writer", version: "1.0.0", foundry: { outputs: ["../../elsewhere.json"] } });
    expect(discoverRoleOutputsDeclaration(root, "@clossys/writer").absence).toBe("output-path-outside-role-folder");
  });
});
