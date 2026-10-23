#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const paragraph = doc => {
  const text = doc?.getText().replace(/^\/\*\*|\*\/$/g, "")
    .split(/\r?\n/).map(line => line.replace(/^\s*\* ?/, "")).join("\n").trim();
  return text ? text.split(/\r?\n\s*\r?\n/)[0].replace(/\s+/g, " ").trim() || null : null;
};
const sourceFor = path => {
  const stem = path.replace(/\.js$/, "");
  const source = [stem + ".ts", stem + ".tsx"].find(existsSync);
  if (!source) throw new Error("Missing relative import source.");
  return source;
};

async function catalogs() {
  // Keep the temporary ESM graph beside the package so bare imports resolve
  // through the same node_modules tree. It is removed even on evaluation failure.
  const temporary = mkdtempSync(join(root, ".reference-"));
  const seen = new Set();
  function visit(source) {
    if (seen.has(source)) return;
    seen.add(source);
    const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      fileName: source, reportDiagnostics: true,
    });
    if (compiled.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error("Cannot transpile catalog source.");
    const target = join(temporary, relative(root, source).replace(/\.tsx?$/, ".js"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, compiled.outputText);
    const imports = ts.preProcessFile(compiled.outputText).importedFiles.map(item => item.fileName).sort(compare);
    for (const specifier of imports) {
      if (specifier.startsWith(".")) visit(sourceFor(resolve(dirname(source), specifier)));
    }
  }
  try {
    writeFileSync(join(temporary, "package.json"), '{"type":"module"}\n');
    visit(join(root, "src", "catalog", "index.ts"));
    return await import(pathToFileURL(join(temporary, "src", "catalog", "index.js")).href);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function exportSummaries(pkg) {
  const parsedFiles = new Map();
  function parse(source) {
    if (!parsedFiles.has(source)) {
      const parsed = ts.createSourceFile(source, readFileSync(source, "utf8"), ts.ScriptTarget.ES2022, true);
      if (parsed.parseDiagnostics.length) throw new Error("Cannot parse export source.");
      parsedFiles.set(source, parsed);
    }
    return parsedFiles.get(source);
  }
  function declaration(parsed, name, local = false) {
    return parsed.statements.find(statement => {
      if (!local && !statement.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) return false;
      return ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text === name)
        : statement.name && ts.isIdentifier(statement.name) && statement.name.text === name;
    });
  }
  function find(source, name, seen = new Set()) {
    const key = source + ":" + name;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const parsed = parse(source), direct = declaration(parsed, name);
    if (direct) return { summary: paragraph(direct.jsDoc?.[0]) };
    for (const statement of parsed.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
      const named = statement.exportClause.elements.find(item => item.name.text === name);
      if (!named) continue;
      const original = named.propertyName?.text ?? named.name.text;
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        return find(sourceFor(resolve(dirname(source), statement.moduleSpecifier.text)), original, seen);
      }
      const local = declaration(parsed, original, true);
      return local ? { summary: paragraph(local.jsDoc?.[0]) } : undefined;
    }
    const stars = parsed.statements.filter(item => ts.isExportDeclaration(item) && !item.exportClause && item.moduleSpecifier && ts.isStringLiteral(item.moduleSpecifier))
      .map(item => item.moduleSpecifier.text).sort(compare);
    for (const specifier of stars) {
      const found = find(sourceFor(resolve(dirname(source), specifier)), name, seen);
      if (found) return found;
    }
    return undefined;
  }
  return (kind, leaf, name) => {
    if (name === null) return null;
    const files = kind === "atoms" ? leaf.files : [pkg.exports[`./${kind}`].import.replace(/^\.\/dist\//, "src/")];
    for (const file of files) {
      const source = /\.tsx?$/.test(file) ? join(root, file) : sourceFor(join(root, file));
      const found = find(source, name);
      if (found) return found.summary;
    }
    if (kind === "icons") throw new Error("Icon catalog export is missing.");
    return null;
  };
}

const cell = value => String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
const value = item => typeof item === "object" && item !== null ? JSON.stringify(item) : String(item);
function reference(entry) {
  const lines = [`# ${entry.label}`, "", entry.summary ?? "No summary.", "",
    `- Kind: ${entry.kind}`, `- Export: ${entry.export === null ? "none" : "`" + entry.export + "`"}`,
    `- Lifecycle: ${entry.lifecycle}`];
  if (entry.props !== null) {
    lines.push("", "## Props", "", "| Name | Values | Default |", "| --- | --- | --- |");
    const rows = Array.isArray(entry.props) ? entry.props : Object.keys(entry.props).map(name => ({ name, values: entry.props[name] }));
    for (const row of rows) lines.push(`| ${cell(row.name)} | ${(row.values ?? []).map(item => cell(value(item))).join(", ")} | ${cell(row.default)} |`);
  }
  return lines.join("\n") + "\n";
}

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--out" || !args[1])) throw new Error("Usage: generate-reference.mjs [--out <dir>]");
  const out = args.length ? resolve(root, args[1]) : join(root, "dist");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const data = await catalogs(), summary = exportSummaries(pkg);
  const counts = {}, catalogRecords = {}, entries = [];
  const exclusions = { tokens: data.TOKEN_EXCLUSIONS, atoms: data.ATOM_EXPORT_EXCLUSIONS, blocks: data.BLOCK_EXPORT_EXCLUSIONS };
  for (const catalog of data.CATALOGS) {
    const { kind, groups } = catalog;
    counts[kind] = catalog.entries.length;
    catalogRecords[kind] = { kind, groups, entries: catalog.entries };
    if (kind in exclusions) catalogRecords[kind].exclusions = exclusions[kind] ?? {};
    for (const leaf of [...catalog.entries].sort((a, b) => compare(a.id, b.id))) {
      const exported = leaf.export ?? (kind === "icons" ? leaf.id : null);
      const contract = leaf.contract;
      const props = !contract ? null : kind === "atoms" ? contract.props : kind === "blocks" ? {
        requiredFields: contract.requiredFields, axes: contract.axes, slots: contract.slots, configs: contract.configs,
      } : null;
      const example = `examples/${kind}/${leaf.id}.tsx`;
      entries.push({ id: leaf.id, kind, label: leaf.label, lifecycle: leaf.lifecycle, ownerReview: leaf.ownerReview,
        export: exported, summary: summary(kind, leaf, exported), props,
        reference: `reference/${kind}/${leaf.id}.md`, example: existsSync(join(root, example)) ? example : null });
    }
  }
  const manifest = { schema: "clossys.designer.manifest/1", package: pkg.name, version: pkg.version,
    counts, catalogs: catalogRecords, entries };
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
