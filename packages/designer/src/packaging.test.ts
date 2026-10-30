// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureSegment = /(^|\/)__fixtures__(\/|$)/;
const normalized = (path: string) => path.split(sep).join("/");

function entryPoints(value: unknown): string[] {
  if (typeof value === "string") return value.startsWith("./dist/") || value.startsWith("dist/") ? [value.replace(/^\.\//, "")] : [];
  if (value && typeof value === "object") return Object.values(value).flatMap(entryPoints);
  return [];
}

for (const name of ["designer", "publisher", "writer"]) {
  const packageRoot = join(repoRoot, "packages", name);
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const entries = [...new Set([...entryPoints(manifest.exports), ...entryPoints(manifest.bin)])];

  describe(`${name} production package boundary`, () => {
    it("keeps fixture modules out of the actual compiler graph and retains public entry points", () => {
      const configPath = join(packageRoot, "tsconfig.json");
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      expect(config.error).toBeUndefined();
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
      expect(parsed.errors).toEqual([]);
      expect(parsed.fileNames.length).toBeGreaterThan(0);
      const program = ts.createProgram(parsed.fileNames, parsed.options);
      const sources = new Set(program.getSourceFiles().map(source => normalized(relative(packageRoot, source.fileName))).filter(path => path.startsWith("src/")));
      expect(sources.size).toBeGreaterThan(0);
      expect([...sources].filter(path => fixtureSegment.test(path))).toEqual([]);

      const codeEntries = entries.filter(path => /\.(?:js|d\.ts)$/.test(path));
      expect(codeEntries.length).toBeGreaterThan(0);
      for (const entry of codeEntries) {
        const stem = entry.replace(/^dist\//, "src/").replace(/\.d\.ts$|\.js$/, "");
        const source = [".ts", ".tsx"].map(extension => stem + extension).find(path => existsSync(join(packageRoot, path)));
        expect(source, `source for public entry ${entry}`).toBeDefined();
        expect(sources.has(source!), `compiler includes public entry ${entry}`).toBe(true);
      }
    }, 30_000);

    it("packs public and adjacent runtime files while refusing stale fixture output", () => {
      mkdirSync(join(repoRoot, "tmp"), { recursive: true });
      const root = mkdtempSync(join(repoRoot, "tmp", "package-boundary-"));
      const write = (path: string, content = "export {};\n") => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
      };
      write("package.json", JSON.stringify(manifest));
      write("README.md", "Package boundary fixture.\n");
      write("LICENSE", "MIT\n");
      const runtime = ["src/packaging-boundary/runtime.ts", "dist/packaging-boundary/runtime.js", "src/__fixtures__-runtime/control.ts", "dist/__fixtures__-runtime/control.js"];
      for (const path of [...entries, ...runtime]) write(path);
      // Model both a fresh fixture compile and output left by an older build.
      // The manifest must exclude these even when no compiler has cleaned dist.
      for (const directory of ["", "packaging-boundary/"]) {
        write(`src/${directory}__fixtures__/stale.ts`);
        for (const extension of ["js", "js.map", "d.ts", "d.ts.map"]) write(`dist/${directory}__fixtures__/stale.${extension}`);
      }
      const output = execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const [packed] = JSON.parse(output) as { files: { path: string }[] }[];
      const files = new Set(packed!.files.map(file => file.path));
      expect(files.size).toBeGreaterThan(0);
      expect([...files].filter(path => fixtureSegment.test(path))).toEqual([]);
      expect(entries.length).toBeGreaterThan(0);
      for (const path of [...entries, ...runtime]) expect(files.has(path), `packed runtime ${path}`).toBe(true);
    }, 30_000);
  });
}
