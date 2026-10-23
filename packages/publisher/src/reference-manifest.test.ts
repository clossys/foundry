// @vitest-environment node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const temporary: string[] = [];
const temp = () => {
  const path = mkdtempSync(join(tmpdir(), "reference-manifest-"));
  temporary.push(path);
  return path;
};
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
const run = (script: string, args: string[] = []) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
function tree(rootPath: string, path = rootPath): Record<string, string> {
  return Object.fromEntries(readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(item => {
    const full = join(path, item.name);
    return item.isDirectory() ? Object.entries(tree(rootPath, full)) : [[relative(rootPath, full), readFileSync(full, "utf8")]];
  }));
}

function examplesFixture() {
  const fixture = temp();
  for (const dir of ["scripts", "examples", "examples-other", "src", "node_modules"]) mkdirSync(join(fixture, dir));
  symlinkSync(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), join(fixture, "node_modules", "typescript"), "dir");
  writeFileSync(join(fixture, "package.json"), '{"type":"module"}');
  writeFileSync(join(fixture, "tsconfig.examples.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
    noUnusedLocals: true, verbatimModuleSyntax: true, skipLibCheck: true, types: [],
    paths: { "fixture-source": ["./src/source.ts"] },
  }, include: ["examples/**/*.ts"] }));
  writeFileSync(join(fixture, "src", "source.ts"), "const unusedOutside = 1; export const sourceValue = 2;");
  writeFileSync(join(fixture, "examples-other", "source.ts"), "const unusedSibling = 1; export const siblingValue = 3;");
  writeFileSync(join(fixture, "examples", "demo.ts"), 'import { sourceValue } from "fixture-source"; import { siblingValue } from "../examples-other/source.js"; export const demo = sourceValue + siblingValue;');
  const script = join(fixture, "scripts", "typecheck-examples.mjs");
  copyFileSync(join(root, "scripts", "typecheck-examples.mjs"), script);
  return { fixture, script };
}

describe("package reference manifest", () => {
  it("generates a complete, deterministic manifest and reference tree from source", () => {
    const first = temp(), second = temp();
    mkdirSync(join(first, "reference", "stale"), { recursive: true });
    writeFileSync(join(first, "reference", "stale", "old.md"), "stale");
    for (const output of [first, second]) {
      const generated = run(join(root, "scripts", "generate-reference.mjs"), ["--out", output]);
      expect(generated.status, generated.stderr).toBe(0);
    }
    const files = tree(first);
    expect(files).toEqual(tree(second));
    expect(existsSync(join(first, "reference", "stale", "old.md"))).toBe(false);
    const manifest = JSON.parse(files["manifest.json"]!);
    expect(files["manifest.json"]).toBe(JSON.stringify(manifest, null, 2) + "\n");
    expect(Object.keys(manifest)).toEqual(["schema", "package", "version", "counts", "entries"]);
    expect(manifest.schema).toBe("clossys.publisher.manifest/1");
    expect(manifest.package).toBe(pkg.name);
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.entries.length).toBeGreaterThan(0);
    const kinds = ["subpaths"];
    expect(Object.keys(manifest.counts)).toEqual(kinds);
    const expectedOrder = kinds.flatMap(kind => manifest.entries.filter((entry: any) => entry.kind === kind).map((entry: any) => entry.id).sort());
    expect(manifest.entries.map((entry: any) => entry.id)).toEqual(expectedOrder);
    for (const kind of kinds) expect(manifest.counts[kind]).toBe(manifest.entries.filter((entry: any) => entry.kind === kind).length);
    expect(manifest.counts.subpaths).toBe(Object.keys(pkg.exports).length);
    expect(manifest.entries.map((entry: any) => entry.subpath).sort()).toEqual(Object.keys(pkg.exports).sort());
    for (const [subpath, requiredExport] of [
      ["./web/consent", "ConsentExperience"],
      ["./consent-copy", "resolveConsentCopy"],
      ["./web/consent/preview", "createConsentPreview"],
    ]) {
      const selected = manifest.entries.find((entry: any) => entry.subpath === subpath);
      expect(selected.exports, subpath).toContain(requiredExport);
      expect(selected.summary).not.toContain("What every condition other than");
    }
    const core = manifest.entries.find((entry: any) => entry.subpath === "./core");
    expect(core.summary).toMatch(/^@clossys\/publisher\/core — public composition contract\./);
    const client = manifest.entries.find((entry: any) => entry.subpath === "./web/client");
    expect(client.exports).toContain("SignInForm");
    expect(client.exports).toContain("SignInFormProps");
    expect(client.summary).toBe("Browser forms use immutable package defaults, not consumer approval records.");
    for (const entry of manifest.entries) {
      expect(entry.reference).toBe(`reference/${entry.kind}/${entry.id}.md`);
      const doc = files[entry.reference];
      expect(doc).toBeDefined();
      expect(doc).toMatch(/^# /);
      expect(doc).toContain(`- Kind: ${entry.kind}`);
      expect(doc).toContain(entry.summary ?? "No summary.");
      const example = `examples/${entry.kind}/${entry.id}.tsx`;
      expect(entry.example).toBe(existsSync(join(root, example)) ? example : null);
      expect(Object.keys(entry)).toEqual(["id", "kind", "subpath", "exports", "summary", "reference", "example"]);
      expect(entry.id).toBe(entry.subpath.slice(2).replaceAll("/", "-"));
      expect(entry.exports).toEqual([...entry.exports].sort());
      expect(new Set(entry.exports).size).toBe(entry.exports.length);
      expect(doc).toContain("## Exports");
      for (const name of entry.exports) expect(doc).toContain("`" + name + "`");
    }
    expect(Object.keys(files).sort()).toEqual(["manifest.json", ...manifest.entries.map((entry: any) => entry.reference)].sort());
    for (const output of Object.values(files)) {
      expect(output).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(output).not.toMatch(/\b[0-9a-f]{40}\b/i);
      expect(output).not.toContain(root);
      expect(output).not.toContain(dirname(dirname(root)));
    }
  }, 10_000);

  it("returns a one-line CLI error for invalid arguments", () => {
    const result = run(join(root, "scripts", "generate-reference.mjs"), ["--unknown"]);
    expect(result.status).toBe(2);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
  });

  it("rejects source diagnostics outside examples, including the examples-other sibling", () => {
    const { fixture, script } = examplesFixture();
    const result = run(script);
    expect(result.status, result.stderr + result.stdout).toBe(2);
    expect(result.stderr + result.stdout).toContain("unusedOutside");
    expect(result.stderr + result.stdout).toContain("unusedSibling");
    expect(existsSync(join(fixture, "examples", "demo.js"))).toBe(false);
  });

  it("rejects a substantive type error in imported source", () => {
    const { fixture, script } = examplesFixture();
    writeFileSync(join(fixture, "src", "source.ts"), 'export const sourceValue: number = "invalid";');
    writeFileSync(join(fixture, "examples-other", "source.ts"), "export const siblingValue = 3;");
    const result = run(script);
    expect(result.status, result.stderr + result.stdout).toBe(2);
    expect(result.stderr + result.stdout).toContain("TS2322");
    expect(result.stderr + result.stdout).toContain("src/source.ts");
  });

  it("accepts an error-free program without emitting files", () => {
    const { fixture, script } = examplesFixture();
    writeFileSync(join(fixture, "src", "source.ts"), "export const sourceValue = 2;");
    writeFileSync(join(fixture, "examples-other", "source.ts"), "export const siblingValue = 3;");
    const result = run(script);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stderr).toBe("");
    expect(existsSync(join(fixture, "examples", "demo.js"))).toBe(false);
  });

  it("keeps strict diagnostics located inside examples", () => {
    const { fixture, script } = examplesFixture();
    writeFileSync(join(fixture, "examples", "demo.ts"), readFileSync(join(fixture, "examples", "demo.ts"), "utf8") + " const unusedInside = 1;");
    const result = run(script);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("unusedInside");
    expect(result.stderr + result.stdout).toContain("unusedOutside");
    expect(result.stderr + result.stdout).toContain("unusedSibling");
  });

  it.each(["config", "fileless"])("keeps %s failures", failure => {
    const { fixture, script } = examplesFixture();
    const path = join(fixture, "tsconfig.examples.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    if (failure === "config") config.compilerOptions.unknownExampleOption = true;
    else config.compilerOptions.types = ["unavailable-fixture-types"];
    writeFileSync(path, JSON.stringify(config));
    const result = run(script);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain(failure === "config" ? "unknownExampleOption" : "unavailable-fixture-types");
  });

  it("reports examples absent and refuses an examples directory without its configuration", () => {
    const fixture = temp();
    mkdirSync(join(fixture, "scripts"));
    const script = join(fixture, "scripts", "typecheck-examples.mjs");
    copyFileSync(join(root, "scripts", "typecheck-examples.mjs"), script);
    const absent = run(script);
    expect(absent.status, absent.stderr).toBe(0);
    expect(absent.stdout.trim().split("\n")).toHaveLength(1);
    expect(absent.stdout.trim()).not.toBe("");
    mkdirSync(join(fixture, "examples"));
    const unconfigured = run(script);
    expect(unconfigured.status).toBe(2);
    expect(unconfigured.stderr).toContain("tsconfig.examples.json");
  });
});
