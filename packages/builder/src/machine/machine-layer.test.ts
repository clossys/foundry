import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryDiscoveryFileSystem } from "./memory-discovery.test-helper.js";
import {
  CLASS_ONE_SOURCE_ROOT,
  MACHINE_LAYER_DECLARATION_PATH_ENV_VAR,
  buildClassOneManifest,
  loadClassOnePolicy,
  parseMachineLayerDeclaration,
  resolveClassOneDeclarationPath,
  validateMachineLayerDeclarationShape,
  writeMachineLayerDeclaration,
} from "./machine-layer.js";

const declarationPath = "/machine/policy/class-one.json";

function validDeclaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    destinations: [
      { id: "branch-provenance", install: "link", destination: ".agents/documents/branch-provenance" },
      { id: "agent-policy-rules", install: "copy", destination: ".claude/agent-policy.rules" },
    ],
    ...overrides,
  };
}

describe("resolveClassOneDeclarationPath", () => {
  it("prefers an explicit path over the environment variable", () => {
    expect(
      resolveClassOneDeclarationPath({ path: "/explicit.json", env: { [MACHINE_LAYER_DECLARATION_PATH_ENV_VAR]: "/env.json" } }),
    ).toBe("/explicit.json");
  });

  it("falls back to the environment variable when no path is supplied", () => {
    expect(resolveClassOneDeclarationPath({ env: { [MACHINE_LAYER_DECLARATION_PATH_ENV_VAR]: "/env.json" } })).toBe("/env.json");
  });

  it("invents no default — neither supplied means undefined, never a guessed path", () => {
    expect(resolveClassOneDeclarationPath({ env: {} })).toBeUndefined();
  });
});

describe("validateMachineLayerDeclarationShape", () => {
  it("accepts a well-formed declaration", () => {
    expect(validateMachineLayerDeclarationShape(validDeclaration())).toEqual([]);
  });

  it("rejects a non-object", () => {
    const findings = validateMachineLayerDeclarationShape("nope");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("machine-layer-declaration/not-an-object");
  });

  it("rejects the wrong schemaVersion", () => {
    const findings = validateMachineLayerDeclarationShape(validDeclaration({ schemaVersion: 99 }));
    expect(findings.some((f) => f.rule === "machine-layer-declaration/unsupported-schema-version")).toBe(true);
  });

  it("rejects destinations that is not an array", () => {
    const findings = validateMachineLayerDeclarationShape(validDeclaration({ destinations: "nope" }));
    expect(findings.some((f) => f.rule === "machine-layer-declaration/destinations-not-array")).toBe(true);
  });

  it("rejects a non-object entry", () => {
    const findings = validateMachineLayerDeclarationShape(validDeclaration({ destinations: ["nope"] }));
    expect(findings.some((f) => f.rule === "machine-layer-declaration/entry-not-object")).toBe(true);
  });

  it("rejects a missing or empty id", () => {
    const findings = validateMachineLayerDeclarationShape(
      validDeclaration({ destinations: [{ install: "link", destination: "x" }] }),
    );
    expect(findings.some((f) => f.rule === "machine-layer-declaration/missing-id")).toBe(true);
  });

  it("rejects a duplicate id within one declaration", () => {
    const findings = validateMachineLayerDeclarationShape(
      validDeclaration({
        destinations: [
          { id: "branch-provenance", install: "link", destination: "a" },
          { id: "branch-provenance", install: "link", destination: "b" },
        ],
      }),
    );
    expect(findings.some((f) => f.rule === "machine-layer-declaration/duplicate-id")).toBe(true);
  });

  it("rejects an invalid install kind", () => {
    const findings = validateMachineLayerDeclarationShape(
      validDeclaration({ destinations: [{ id: "x", install: "symlink-farm", destination: "y" }] }),
    );
    expect(findings.some((f) => f.rule === "machine-layer-declaration/invalid-install")).toBe(true);
  });

  it("rejects an absolute destination — the whole point is home-relative placement", () => {
    const findings = validateMachineLayerDeclarationShape(
      validDeclaration({ destinations: [{ id: "x", install: "link", destination: "/etc/passwd" }] }),
    );
    expect(findings.some((f) => f.rule === "machine-layer-declaration/destination-not-relative")).toBe(true);
  });

  it("rejects a destination containing a .. segment", () => {
    const findings = validateMachineLayerDeclarationShape(
      validDeclaration({ destinations: [{ id: "x", install: "link", destination: "../../etc/passwd" }] }),
    );
    expect(findings.some((f) => f.rule === "machine-layer-declaration/destination-not-relative")).toBe(true);
  });

  it("rejects two entries claiming the same destination", () => {
    const findings = validateMachineLayerDeclarationShape(
      validDeclaration({
        destinations: [
          { id: "branch-provenance", install: "link", destination: "shared" },
          { id: "agent-policy-rules", install: "copy", destination: "shared" },
        ],
      }),
    );
    expect(findings.some((f) => f.rule === "machine-layer-declaration/duplicate-destination")).toBe(true);
  });

  it("requires distinct startMarker/endMarker for a managed-block entry", () => {
    const missing = validateMachineLayerDeclarationShape(
      validDeclaration({ destinations: [{ id: "shell-integration", install: "managed-block", destination: "x" }] }),
    );
    expect(missing.some((f) => f.rule === "machine-layer-declaration/missing-start-marker")).toBe(true);
    expect(missing.some((f) => f.rule === "machine-layer-declaration/missing-end-marker")).toBe(true);

    const identical = validateMachineLayerDeclarationShape(
      validDeclaration({
        destinations: [
          { id: "shell-integration", install: "managed-block", destination: "x", startMarker: "# >>>", endMarker: "# >>>" },
        ],
      }),
    );
    expect(identical.some((f) => f.rule === "machine-layer-declaration/markers-not-distinct")).toBe(true);
  });

  it("rejects markers on a link or copy entry — they are only meaningful for managed-block", () => {
    const findings = validateMachineLayerDeclarationShape(
      validDeclaration({
        destinations: [{ id: "branch-provenance", install: "link", destination: "x", startMarker: "# >>>", endMarker: "# <<<" }],
      }),
    );
    expect(findings.some((f) => f.rule === "machine-layer-declaration/markers-not-applicable")).toBe(true);
  });
});

describe("parseMachineLayerDeclaration", () => {
  it("returns ok:true for a well-formed declaration", () => {
    const result = parseMachineLayerDeclaration(validDeclaration());
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with every finding for a malformed declaration", () => {
    const result = parseMachineLayerDeclaration({ schemaVersion: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.findings.length).toBeGreaterThan(0);
  });
});

describe("writeMachineLayerDeclaration", () => {
  it("serializes a valid declaration", () => {
    const serialized = writeMachineLayerDeclaration({
      destinations: [{ id: "branch-provenance", install: "link", destination: ".agents/branch-provenance" }],
    });
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    expect(parseMachineLayerDeclaration(parsed).ok).toBe(true);
  });

  it("throws rather than serializing an invalid declaration", () => {
    expect(() =>
      writeMachineLayerDeclaration({ destinations: [{ id: "", install: "link", destination: "x" }] }),
    ).toThrow(/refusing to serialize/);
  });
});

describe("buildClassOneManifest", () => {
  it("builds a link entry for non-templated content, sourced from the shared conventions root", () => {
    const manifest = buildClassOneManifest({
      schemaVersion: 1,
      destinations: [{ id: "branch-provenance", install: "link", destination: ".agents/branch-provenance" }],
    });
    expect(manifest.links).toEqual([{ source: join("documents", "branch-provenance.md"), destination: "${HOME}/.agents/branch-provenance" }]);
  });

  it("builds a copy entry carrying the catalog's own mode for an adapter that declares one", () => {
    const manifest = buildClassOneManifest({
      schemaVersion: 1,
      destinations: [{ id: "agent-policy-rules", install: "copy", destination: ".claude/agent-policy.rules" }],
    });
    expect(manifest.copies).toEqual([
      { source: "adapters/agent-policy.rules", destination: "${HOME}/.claude/agent-policy.rules", template: false, mode: "600" },
    ]);
  });

  it("builds a templated copy for templated content, with template:true", () => {
    const manifest = buildClassOneManifest({
      schemaVersion: 1,
      destinations: [{ id: "machine-guidance", install: "copy", destination: ".agents/machine-guidance" }],
    });
    expect(manifest.copies).toEqual([
      { source: join("documents", "machine-guidance.md"), destination: "${HOME}/.agents/machine-guidance", template: true },
    ]);
  });

  it("refuses to link templated content — a reader would receive the literal token", () => {
    expect(() =>
      buildClassOneManifest({
        schemaVersion: 1,
        destinations: [{ id: "machine-guidance", install: "link", destination: ".agents/machine-guidance" }],
      }),
    ).toThrow(/must never be linked/);
  });

  it("refuses an id the catalog does not ship", () => {
    expect(() =>
      buildClassOneManifest({
        schemaVersion: 1,
        destinations: [{ id: "not-a-real-id", install: "link", destination: "x" }],
      }),
    ).toThrow(/unknown convention id/);
  });

  it("builds a managed-block entry with the declared markers", () => {
    const manifest = buildClassOneManifest({
      schemaVersion: 1,
      destinations: [
        {
          id: "shell-integration",
          install: "managed-block",
          destination: ".zshrc",
          startMarker: "# >>> conventions >>>",
          endMarker: "# <<< conventions <<<",
        },
      ],
    });
    expect(manifest.managedBlocks).toEqual([
      {
        source: "adapters/shell-integration.zsh",
        destination: "${HOME}/.zshrc",
        startMarker: "# >>> conventions >>>",
        endMarker: "# <<< conventions <<<",
        template: true,
      },
    ]);
  });
});

describe("loadClassOnePolicy — the ternary", () => {
  it("is indeterminate when no path is supplied and the environment variable is unset", () => {
    const result = loadClassOnePolicy(createMemoryDiscoveryFileSystem(), { path: undefined });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("path-not-declared");
  });

  it("is indeterminate when the declaration cannot be read", () => {
    const result = loadClassOnePolicy(createMemoryDiscoveryFileSystem(), { path: declarationPath });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("declaration-unreadable");
  });

  it("is indeterminate when the declaration does not parse as JSON", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(declarationPath, "not json");
    const result = loadClassOnePolicy(discovery, { path: declarationPath });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("declaration-malformed");
  });

  it("is indeterminate when the declaration fails shape validation", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(declarationPath, JSON.stringify({ schemaVersion: 1 }));
    const result = loadClassOnePolicy(discovery, { path: declarationPath });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("declaration-invalid-schema");
  });

  it("is indeterminate — not satisfied — when destinations is a syntactically valid empty array (#338)", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(declarationPath, JSON.stringify({ schemaVersion: 1, destinations: [] }));
    const result = loadClassOnePolicy(discovery, { path: declarationPath });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("declaration-empty");
  });

  it("is indeterminate when a shape-valid declaration names an id the catalog does not ship", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(
      declarationPath,
      JSON.stringify({ schemaVersion: 1, destinations: [{ id: "not-real", install: "link", destination: "x" }] }),
    );
    const result = loadClassOnePolicy(discovery, { path: declarationPath });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("declaration-semantically-invalid");
  });

  it("is satisfied for a well-formed declaration naming only real catalog ids", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(declarationPath, JSON.stringify(validDeclaration()));
    const result = loadClassOnePolicy(discovery, { path: declarationPath });
    expect(result.verdict).toBe("satisfied");
    expect(result.manifest?.links).toHaveLength(1);
    expect(result.manifest?.copies).toHaveLength(1);
    expect(result.sourceRoot).toBe(CLASS_ONE_SOURCE_ROOT);
  });

  it("reads its path from the environment variable when none is supplied explicitly", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(declarationPath, JSON.stringify(validDeclaration()));
    const resolved = { [MACHINE_LAYER_DECLARATION_PATH_ENV_VAR]: declarationPath };
    const result = loadClassOnePolicy(discovery, { path: resolved[MACHINE_LAYER_DECLARATION_PATH_ENV_VAR] });
    expect(result.verdict).toBe("satisfied");
  });
});
