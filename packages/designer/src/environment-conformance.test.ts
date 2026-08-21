import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkEnvironmentConformance } from "./environment-conformance.js";

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "env-conformance-")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string): void {
  const abs = join(dir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function writeManifest(exportsMap: Record<string, unknown>): void {
  writeFile("package.json", JSON.stringify({ name: "@fixture/pkg", version: "0.0.0", type: "module", exports: exportsMap }, null, 2));
}

function writeDeclaration(map: Record<string, string>): void {
  const entries = Object.entries(map)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  writeFile("dist/render-environment.js", `export const RENDER_ENVIRONMENT = {\n${entries}\n};\n`);
}

describe("checkEnvironmentConformance — satisfied", () => {
  it("agrees when RENDER_ENVIRONMENT's keys and exports' subpaths are the same set", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" }, "./b": { import: "./dist/b.js" } });
    writeDeclaration({ "./a": "server-safe", "./b": "client-only" });

    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("satisfied");
    expect(result.agreedSubpaths).toEqual(["./a", "./b"]);
    expect(result.violations).toEqual([]);
    expect(result.indeterminateReasons).toEqual([]);
  });

  it("agrees for a single subpath (the minimum for satisfied)", async () => {
    writeManifest({ "./only": "./styles/only.css" });
    writeDeclaration({ "./only": "server-safe" });

    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("satisfied");
    expect(result.agreedSubpaths).toEqual(["./only"]);
  });

  it("never resolves any file the exports map points to — a subpath whose target does not exist on disk still agrees", async () => {
    writeManifest({ "./a": { import: "./dist/never-built.js" } });
    writeDeclaration({ "./a": "server-safe" });
    // dist/never-built.js is never written — this checker performs no
    // module resolution, so its absence is irrelevant to this check.

    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("satisfied");
  });
});

describe("checkEnvironmentConformance — violated", () => {
  it("flags a real exports subpath with no declaration (undeclared-subpath)", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" }, "./b": { import: "./dist/b.js" } });
    writeDeclaration({ "./a": "server-safe" });

    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("violated");
    expect(result.violations).toEqual([{ subpath: "./b", reason: "undeclared-subpath", detail: expect.any(String) }]);
  });

  it("flags a declared subpath with no matching real export (stale-declaration)", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" } });
    writeDeclaration({ "./a": "server-safe", "./ghost": "server-safe" });

    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("violated");
    expect(result.violations).toEqual([{ subpath: "./ghost", reason: "stale-declaration", detail: expect.any(String) }]);
  });

  it("reports both directions in the same run when both defects are present", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" }, "./new": { import: "./dist/new.js" } });
    writeDeclaration({ "./a": "server-safe", "./ghost": "server-safe" });

    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("violated");
    expect(result.violations).toHaveLength(2);
    expect(result.violations.find((v) => v.subpath === "./new")?.reason).toBe("undeclared-subpath");
    expect(result.violations.find((v) => v.subpath === "./ghost")?.reason).toBe("stale-declaration");
  });

  it("flags a RENAMED subpath as both directions at once — a rename is neither purely undeclared nor purely stale, it is both", async () => {
    // This is the same fixture shape environment-conformance.adversarial.test.ts
    // builds independently to prove the count-comparison weakness; this
    // test only confirms the renamed-subpath case reports correctly
    // under checkEnvironmentConformance's own direct API.
    writeManifest({ "./a": { import: "./dist/a.js" }, "./b-renamed": { import: "./dist/b.js" } });
    writeDeclaration({ "./a": "server-safe", "./b": "client-only" });

    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("violated");
    expect(result.violations).toHaveLength(2);
    expect(result.violations.find((v) => v.subpath === "./b-renamed")?.reason).toBe("undeclared-subpath");
    expect(result.violations.find((v) => v.subpath === "./b")?.reason).toBe("stale-declaration");
  });
});

describe("checkEnvironmentConformance — indeterminate", () => {
  it("manifest-missing when package.json does not exist", async () => {
    mkdirSync(dir, { recursive: true });
    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("indeterminate");
    expect(result.indeterminateReasons.map((r) => r.code)).toEqual(["manifest-missing"]);
  });

  it("manifest-unparseable when package.json is not valid JSON", async () => {
    writeFile("package.json", "{ not json");
    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("indeterminate");
    expect(result.indeterminateReasons.map((r) => r.code)).toEqual(["manifest-unparseable"]);
  });

  it("manifest-no-exports-map when package.json declares no exports field", async () => {
    writeFile("package.json", JSON.stringify({ name: "@fixture/pkg", version: "0.0.0" }));
    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("indeterminate");
    expect(result.indeterminateReasons.map((r) => r.code)).toEqual(["manifest-no-exports-map"]);
  });

  it("manifest-no-exports-map when the exports field is an empty object", async () => {
    writeManifest({});
    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("indeterminate");
    expect(result.indeterminateReasons.map((r) => r.code)).toEqual(["manifest-no-exports-map"]);
  });

  it("declaration-missing when dist/render-environment.js does not exist", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" } });
    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("indeterminate");
    expect(result.indeterminateReasons.map((r) => r.code)).toEqual(["declaration-missing"]);
  });

  it("declaration-unparseable when RENDER_ENVIRONMENT is not an object", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" } });
    writeFile("dist/render-environment.js", `export const RENDER_ENVIRONMENT = "nope";\n`);
    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("indeterminate");
    expect(result.indeterminateReasons.map((r) => r.code)).toEqual(["declaration-unparseable"]);
  });

  it("declaration-unparseable when dist/render-environment.js throws on import", async () => {
    writeManifest({ "./a": { import: "./dist/a.js" } });
    writeFile("dist/render-environment.js", `throw new Error("boom");\n`);
    const result = await checkEnvironmentConformance(dir);
    expect(result.verdict).toBe("indeterminate");
    expect(result.indeterminateReasons.map((r) => r.code)).toEqual(["declaration-unparseable"]);
  });
});

describe("checkEnvironmentConformance — real package integration", () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  it("reports satisfied against this package's own real, compiled dist/render-environment.js and manifest", async () => {
    if (!existsSync(join(packageRoot, "dist"))) {
      throw new Error(`environment-conformance.test.ts requires a built dist/ (run "npm run build" in ${packageRoot} first)`);
    }
    const result = await checkEnvironmentConformance(packageRoot);
    expect(result.verdict).toBe("satisfied");
    expect(result.agreedSubpaths).toEqual(
      expect.arrayContaining([
        "./atoms/server",
        "./blocks/server",
        "./shell/server",
        "./charts/server",
        "./theme/server",
        "./tokens",
        "./gate",
        "./render-environment",
      ]),
    );
    expect(result.violations).toEqual([]);
  });
});
