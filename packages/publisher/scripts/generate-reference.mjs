#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function sourceTarget(subpath, conditions) {
  const target = [conditions.import, conditions.development, conditions.default]
    .find(item => typeof item === "string" && !basename(item).startsWith("refuse-"));
  if (!target?.startsWith("./dist/") || !target.endsWith(".js")) throw new Error(`Missing API target for ${subpath}.`);
  const stem = target.replace(/^\.\/dist\//, "src/").replace(/\.js$/, "");
  const source = [stem + ".ts", stem + ".tsx"].find(item => existsSync(join(root, item)));
  if (!source) throw new Error(`Missing API source for ${subpath}.`);
  if (conditions.types !== target.replace(/\.js$/, ".d.ts")) throw new Error(`Types target does not correspond to API source for ${subpath}.`);
  return join(root, source);
}
function summary(source) {
  // A directive prologue may precede a module's leading documentation.
  const first = source.statements.find(item => !(ts.isExpressionStatement(item) && ts.isStringLiteral(item.expression)));
  const doc = first?.jsDoc?.[0];
  const text = doc?.getText().replace(/^\/\*\*|\*\/$/g, "")
    .split(/\r?\n/).map(line => line.replace(/^\s*\* ?/, "")).join("\n").trim();
  return text ? text.split(/\r?\n\s*\r?\n/)[0].replace(/\s+/g, " ").trim() || null : null;
}
function reference(entry) {
  return [`# ${entry.id}`, "", entry.summary ?? "No summary.", "", `- Kind: ${entry.kind}`,
    "- Export: none", "", "## Exports", "", ...entry.exports.map(name => "`" + name + "`"), ""].join("\n");
}

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--out" || !args[1])) throw new Error("Usage: generate-reference.mjs [--out <dir>]");
  const out = args.length ? resolve(root, args[1]) : join(root, "dist");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const subpaths = Object.keys(pkg.exports).sort((a, b) => compare(a.slice(2).replaceAll("/", "-"), b.slice(2).replaceAll("/", "-")));
  const sources = subpaths.map(subpath => sourceTarget(subpath, pkg.exports[subpath]));
  const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
  if (config.error) throw new Error("Cannot read TypeScript configuration.");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length) throw new Error("Cannot parse TypeScript configuration.");
  const program = ts.createProgram(sources, { ...parsed.options, noEmit: true });
  if (program.getSyntacticDiagnostics().length) throw new Error("Cannot parse API sources.");
  const checker = program.getTypeChecker();
  const entries = subpaths.map((subpath, index) => {
    const source = program.getSourceFile(sources[index]);
    if (!source) throw new Error(`Cannot read API source for ${subpath}.`);
    const symbol = checker.getSymbolAtLocation(source);
    if (!symbol) throw new Error(`Cannot evaluate API module for ${subpath}.`);
    const id = subpath.slice(2).replaceAll("/", "-");
    const example = `examples/subpaths/${id}.tsx`;
    return { id, kind: "subpaths", subpath,
      exports: checker.getExportsOfModule(symbol).map(item => item.name).sort(compare), summary: summary(source),
      reference: `reference/subpaths/${id}.md`, example: existsSync(join(root, example)) ? example : null };
  });
  const manifest = { schema: "clossys.publisher.manifest/1", package: pkg.name, version: pkg.version,
    counts: { subpaths: subpaths.length }, entries };
  rmSync(join(out, "reference"), { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const entry of entries) {
    const path = join(out, entry.reference);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, reference(entry));
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
} catch (error) {
  console.error(`Reference generation failed: ${String(error.message).replace(/\s+/g, " ")}`);
  process.exitCode = 2;
}
