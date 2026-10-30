// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports: Record<string, { import: string }>;
  imports?: Record<string, { default: string }>;
}

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

// Inspect the artifact's own declarations, without asking ambient node_modules
// to resolve externals: hoisting can otherwise conceal a missing dependency.
function runtimeClosure(directory: string, entry: string, manifest: Manifest) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const visited = new Set<string>();
  const externals = new Map<string, string[]>();
  const undeclared: string[] = [];
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function follow(specifier: string) {
      // Package imports and self-references are internal artifact edges, not
      // dependencies. Follow the normal Node import/default condition here.
      if (specifier.startsWith("#")) {
        const target = manifest.imports?.[specifier]?.default;
        if (!target) throw new Error(`Missing packed imports mapping: ${specifier}`);
        visit(resolve(directory, target));
        return;
      }
      if (manifest.name && specifier.startsWith(`${manifest.name}/`)) {
        const target = manifest.exports[`.${specifier.slice(manifest.name.length)}`]?.import;
        if (!target) throw new Error(`Missing packed self export: ${specifier}`);
        visit(resolve(directory, target));
        return;
      }
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier);
        const resolved = [target, `${target}.js`, `${target}.mjs`, `${target}.cjs`, join(target, "index.js")]
          .find((candidate) => existsSync(candidate) && [".js", ".mjs", ".cjs", ".json"].includes(extname(candidate)));
        if (!resolved) throw new Error(`Missing packed runtime import: ${relative(directory, file)} -> ${specifier}`);
        if (extname(resolved) !== ".json") visit(resolved);
        return;
      }
      if (isBuiltin(specifier)) return;
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
      const edge = `${relative(directory, file)} -> ${specifier}`;
      externals.set(name, [...(externals.get(name) ?? []), edge]);
      if (!declared.has(name)) undeclared.push(edge);
    }
    function walk(node: ts.Node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        follow(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
        node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        follow(node.arguments[0].text);
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  visit(resolve(directory, entry));
  return { visited, externals, undeclared: undeclared.sort() };
}

function withPackedDesigner(run: (directory: string, manifest: Manifest) => void) {
  const temporary = mkdtempSync(join(tmpdir(), "designer-preview-dependencies-"));
  try {
    const [packed] = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], {
      cwd: packageDir, encoding: "utf8",
    })) as Array<{ filename: string }>;
    expect(packed).toBeDefined();
    execFileSync("tar", ["-xzf", join(temporary, packed!.filename), "-C", temporary]);
    const directory = join(temporary, "package");
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as Manifest;
    run(directory, manifest);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

it("declares the external runtime imports reached by the packed public studio route", () => {
  withPackedDesigner((directory, manifest) => {
    const closure = runtimeClosure(directory, manifest.exports["./studio/route"]!.import, manifest);
    expect(closure.visited.has(join(directory, "dist/components/preview-runtime/components/_parts/utils/index.js"))).toBe(true);
    expect(closure.undeclared).toEqual([]);
  });
}, 30_000);

it("detects dropping clsx from the packed manifest even when the workspace can resolve it", () => {
  withPackedDesigner((directory, manifest) => {
    const mutated = structuredClone(manifest);
    delete mutated.dependencies?.clsx;
    const closure = runtimeClosure(directory, manifest.exports["./studio/route"]!.import, mutated);
    expect(closure.undeclared).toContain("dist/components/preview-runtime/components/_parts/utils/index.js -> clsx");
  });
}, 30_000);

it("follows re-exports, literal dynamic imports, CommonJS imports and extensionless relatives", () => {
  const directory = mkdtempSync(join(tmpdir(), "designer-preview-import-forms-"));
  try {
    mkdirSync(join(directory, "nested"));
    writeFileSync(join(directory, "entry.js"), 'export * from "./nested"; import("./lazy.js"); require("./required.cjs"); import "node:fs"; import "#internal"; import "@example/self/lazy";');
    writeFileSync(join(directory, "nested/index.js"), 'export { value } from "@example/missing/subpath";');
    writeFileSync(join(directory, "lazy.js"), 'import("missing-dynamic/subpath");');
    writeFileSync(join(directory, "required.cjs"), 'require("missing-commonjs");');
    const closure = runtimeClosure(directory, "entry.js", {
      name: "@example/self",
      exports: { "./lazy": { import: "./lazy.js" } },
      imports: { "#internal": { default: "./required.cjs" } },
    });
    expect(closure.visited.size).toBe(4);
    expect(closure.undeclared).toEqual([
      "lazy.js -> missing-dynamic/subpath",
      "nested/index.js -> @example/missing/subpath",
      "required.cjs -> missing-commonjs",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
