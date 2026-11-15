/**
 * The site build's Publisher pieces (moved from `@clossys/producer` `src/publish/`, system.md 14.2).
 *
 * Parity: `__fixtures__/golden.json` was captured from the int2 (base 85e74f01d) producer `src/publish/`
 * code before the move, on producer's publish fixture consumer (`src/publish/__fixtures__/install-consumer`).
 * The int2 fixture consumer (`test-fixtures/consumer`) has no pinned Writer locale, so producer's
 * `readWriter` refuses it and it has no Writer copy to build. The Writer input producer resolved is
 * `__fixtures__/writer-input.json`; this package reads only that resolved input, never the slot records.
 * The rebuilt output must be byte-equal to the golden.
 *
 * Direction: no file in this package imports `@clossys/producer`, and `src/build/` imports only Node
 * built-ins and its own files.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultInstallOut, firstComponentSource, INSTALL_MARKER, installOutRoot, writerText, type WriterInput } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "..");
const fixture = (name: string) => readFileSync(join(here, "__fixtures__", name), "utf8");

/** Same shape and key order as the capture. */
function buildOutput(input: WriterInput): string {
  const text = writerText(input);
  const aliases = Object.fromEntries(Object.keys(input.aliases).sort().map(key => [key, text.alias(key) ?? null]));
  const contexts = Object.fromEntries(
    [...new Set(input.records.map(record => record.context).filter((context): context is string => Boolean(context)))].sort().map(key => [key, text.alias(key) ?? null]),
  );
  const records = Object.fromEntries(input.records.map(record => record.id).sort().map(key => [key, text.record(key) ?? null]));
  const root = "/clossys/int2-consumer";
  const out = {
    aliases,
    contexts,
    records,
    componentExport: firstComponentSource("item"),
    install: { marker: INSTALL_MARKER, root: relative(tmpdir(), installOutRoot(root)), page: relative(tmpdir(), defaultInstallOut(root, "home")) },
  };
  return JSON.stringify(out, null, 2) + "\n";
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "dist" ? [] : sourceFiles(path);
    return /\.(?:[cm]?[jt]sx?)$/.test(name) ? [path] : [];
  });
}

/** Module specifiers of static imports, re-exports, dynamic imports and requires. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.push(match[1]!);
  return found;
}

describe("publisher build", () => {
  it("rebuilds the fixture output byte-equal to the int2 producer golden", () => {
    const input = JSON.parse(fixture("writer-input.json")) as WriterInput;
    expect(input.records.length).toBeGreaterThan(0);
    expect(buildOutput(input)).toBe(fixture("golden.json"));
  });

  it("imports nothing from @clossys/producer anywhere in the package", () => {
    const offenders = sourceFiles(join(packageRoot, "src"))
      .flatMap(path => specifiers(readFileSync(path, "utf8")).filter(spec => spec === "@clossys/producer" || spec.startsWith("@clossys/producer/")).map(spec => `${relative(packageRoot, path)}: ${spec}`));
    expect(offenders).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const declared = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].filter(field => pkg[field]?.["@clossys/producer"] !== undefined);
    expect(declared).toEqual([]);
  });

  it("src/build imports only Node built-ins and its own files", () => {
    const outside = sourceFiles(here)
      .filter(path => !path.endsWith(".test.ts"))
      .flatMap(path => specifiers(readFileSync(path, "utf8")).filter(spec => !spec.startsWith("node:") && !spec.startsWith("./")).map(spec => `${relative(here, path)}: ${spec}`));
    expect(outside).toEqual([]);
  });
});
