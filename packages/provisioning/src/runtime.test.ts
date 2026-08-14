import { describe, expect, it } from "vitest";
import { loadManifest } from "./manifest.js";
import { createRuntimeContext, expandTokens, planInstallation } from "./runtime.js";

const options = { home: "/home/op", sourceRoot: "/src/plane" };

describe("expandTokens", () => {
  it("expands a known token", () => {
    expect(expandTokens("${HOME}/.agents", { HOME: "/home/op" })).toBe("/home/op/.agents");
  });

  // Leaving an unexpanded token in place is how a confident-looking install
  // produces a file whose content reads like a literal instruction.
  it("throws on an unknown token rather than leaving it in place", () => {
    expect(() => expandTokens("${NOPE}/x", { HOME: "/home/op" })).toThrow(/Unknown path token/);
  });

  it("leaves shell-style defaults alone", () => {
    expect(expandTokens("${NODE_OPTIONS:-x}", {})).toBe("${NODE_OPTIONS:-x}");
  });
});

describe("createRuntimeContext", () => {
  it("prefers the caller's workspace root over the manifest default", () => {
    const manifest = loadManifest({ version: 1, defaults: { workspaceRoot: "${HOME}/code" } });
    const runtime = createRuntimeContext(manifest, { ...options, workspaceRoot: "/elsewhere/ws" });
    expect(runtime.workspaceRoot).toBe("/elsewhere/ws");
  });

  it("falls back to the manifest default", () => {
    const manifest = loadManifest({ version: 1, defaults: { workspaceRoot: "${HOME}/code" } });
    expect(createRuntimeContext(manifest, options).workspaceRoot).toBe("/home/op/code");
  });

  // An engine that invented a workspace root would install a machine's guidance
  // into a directory nobody chose.
  it("refuses to invent a workspace root", () => {
    expect(() => createRuntimeContext(loadManifest({ version: 1 }), options)).toThrow(
      /No workspace root/,
    );
  });

  it("exposes WORKSPACE_ROOT to templated content", () => {
    const manifest = loadManifest({ version: 1, defaults: { workspaceRoot: "${HOME}/code" } });
    const runtime = createRuntimeContext(manifest, options);
    expect(expandTokens("root is ${WORKSPACE_ROOT}", runtime.tokens)).toBe("root is /home/op/code");
  });
});

describe("planInstallation", () => {
  const manifest = loadManifest({
    version: 1,
    defaults: { workspaceRoot: "${HOME}/code" },
    links: [{ source: "sources/guidance.txt", destination: "${HOME}/.agents/guidance.txt" }],
    copies: [
      { source: "sources/loader.txt", destination: "${HOME}/.agent/loader.txt", mode: "600", template: true },
    ],
    managedBlocks: [
      {
        source: "adapters/shell.zsh",
        destination: "${HOME}/.zshrc",
        startMarker: "# >>> managed >>>",
        endMarker: "# <<< managed <<<",
      },
    ],
    privateDirectories: [{ path: "${WORKSPACE_ROOT}/personal", create: false }],
  });

  it("resolves every path without touching a filesystem", () => {
    const plan = planInstallation(manifest, createRuntimeContext(manifest, options));
    const byKind = Object.fromEntries(plan.operations.map((o) => [o.kind, o]));

    expect(byKind["link"]?.sourcePath).toBe("/src/plane/sources/guidance.txt");
    expect(byKind["link"]?.destinationPath).toBe("/home/op/.agents/guidance.txt");
    expect(byKind["copy"]?.template).toBe(true);
    expect(byKind["copy"]?.mode).toBe("600");
    expect(byKind["managed-block"]?.startMarker).toBe("# >>> managed >>>");
    expect(byKind["private-directory"]?.destinationPath).toBe("/home/op/code/personal");
    expect(byKind["private-directory"]?.create).toBe(false);
  });

  it("rejects a destination that does not resolve to an absolute path", () => {
    const relative = loadManifest({
      version: 1,
      defaults: { workspaceRoot: "${HOME}/code" },
      copies: [{ source: "a", destination: "relative/path" }],
    });
    expect(() => planInstallation(relative, createRuntimeContext(relative, options))).toThrow(
      /must be absolute/,
    );
  });
});
