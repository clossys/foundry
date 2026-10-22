import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Stack boundary. Blocks compose atoms, tokens and local block files; atoms
 * build on react-aria-components, tokens, utilities and other atoms; no other
 * UI library appears anywhere in this package's shipped source. ladder.test.ts
 * checks layer direction; this file checks every bare and relative specifier
 * against a per-directory allow-list, parsed with the TypeScript AST so
 * `import type`, `export ... from` and `import()` are counted exactly.
 */
const srcDir = dirname(fileURLToPath(import.meta.url));
const SHARED = ["icons/", "tokens/", "internal/peer-version.js", "internal/declared-peer-ranges.js", "internal/brandmark.js"];
const RULES = {
  atoms: { bare: /^(?:react|react-aria-components(?:\/package\.json)?|tailwind-merge)$/, local: ["atoms/", ...SHARED] },
  blocks: { bare: /^react$/, typeOnlyBare: /^react-aria-components$/, local: ["blocks/", "atoms/", ...SHARED] },
} as const;
const BARREL_EXTRA: Record<string, RegExp> = { "blocks/index.ts": /^react-aria-components\/package\.json$/ };
/** Every other directory: React, react-aria-components (shell), Node built-ins (CLIs), Tailwind (stylesheet compilers). */
const OTHER_BARE = /^(?:react|react-aria-components(?:\/package\.json)?|node:[a-z_/]+)$/;
const TAILWIND_DIRS = ["compiled-css", "hero-css"];
/** The one computed `import()`: the conformance CLI loads a consumer's declaration file by path. */
const COMPUTED_IMPORT_FILES = ["environment-conformance-worker.ts"];
/**
 * Blocks that still import react-aria-components at runtime. Expiry: remove an
 * entry when its block moves the usage behind an atom. This list may only shrink.
 */
const RUNTIME_RAC_EXCEPTIONS = ["blocks/CommandMenu.tsx", "blocks/Toolbar.tsx", "blocks/internal/disclosure-row.tsx"];
const KNOWN_PEERS = ["@internationalized/date", "react", "react-aria-components", "react-dom", "tailwind-merge", "tailwindcss"];
const UI_LIBRARY = /radix|base-ui|headlessui|tanstack|shadcn|@mui\/|chakra|ariakit|mantine/;

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if ([".ts", ".tsx"].includes(extname(full)) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const COMPUTED = "<computed specifier>";
type Ref = { spec: string; typeOnly: boolean };
function importsOf(file: string): Ref[] {
  const refs: Ref[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = ts.isImportDeclaration(node) ? !!node.importClause?.isTypeOnly : node.isTypeOnly;
      refs.push({ spec: node.moduleSpecifier.text, typeOnly });
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const [arg] = node.arguments;
      refs.push({ spec: arg && ts.isStringLiteralLike(arg) ? arg.text : COMPUTED, typeOnly: false });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      refs.push({ spec: node.argument.literal.text, typeOnly: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true));
  return refs;
}

/** Every disallowed specifier as `file: specifier`, before any exception applies. */
function rawViolations(): string[] {
  const found: string[] = [];
  for (const file of collect(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join("/");
    const top = rel.split("/")[0]!;
    const rule = top === "atoms" || top === "blocks" ? RULES[top] : undefined;
    for (const { spec, typeOnly } of importsOf(file)) {
      let ok: boolean;
      if (spec.startsWith(".")) {
        const target = relative(srcDir, resolve(dirname(file), spec)).split(sep).join("/");
        ok = !rule || rule.local.some(prefix => target.startsWith(prefix)) || (rel.includes(".check.") && target === "index.js");
      } else if (rule) {
        ok = rule.bare.test(spec) || (typeOnly && "typeOnlyBare" in rule && rule.typeOnlyBare.test(spec)) || !!BARREL_EXTRA[rel]?.test(spec);
      } else {
        ok = OTHER_BARE.test(spec) || (spec === "tailwindcss" && TAILWIND_DIRS.includes(top)) || (spec === COMPUTED && COMPUTED_IMPORT_FILES.includes(rel));
      }
      if (!ok) found.push(`${rel}: ${spec}${typeOnly ? " (type)" : ""}`);
    }
  }
  return found.sort();
}

describe("stack import boundary", () => {
  const raw = rawViolations();
  const isException = (v: string) => RUNTIME_RAC_EXCEPTIONS.some(file => v === `${file}: react-aria-components`);

  it("allows only the per-directory specifiers in atoms, blocks and every other source file", () => {
    expect(raw.filter(v => !isException(v))).toEqual([]);
  });

  it("keeps the runtime react-aria-components exception list shrink-only and still needed", () => {
    expect(RUNTIME_RAC_EXCEPTIONS.length).toBeLessThanOrEqual(3);
    expect([...new Set(raw.filter(isException).map(v => v.split(":")[0]))].sort()).toEqual([...RUNTIME_RAC_EXCEPTIONS].sort());
  });

  it("declares no installed dependencies, a fixed optional peer set and no UI library in package.json", () => {
    const pkg = JSON.parse(readFileSync(join(srcDir, "..", "package.json"), "utf8"));
    expect(Object.keys(pkg).filter(key => /^(?:d|optionalD|bundleD|bundledD)ependencies$/.test(key))).toEqual([]);
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual(KNOWN_PEERS);
    for (const name of KNOWN_PEERS) expect(pkg.peerDependenciesMeta[name], name).toEqual({ optional: true });
    const names = [...Object.keys(pkg.peerDependencies), ...Object.keys(pkg.devDependencies ?? {})];
    expect(names.filter(name => UI_LIBRARY.test(name))).toEqual([]);
  });
});
