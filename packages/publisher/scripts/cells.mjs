#!/usr/bin/env node
/** Migrate consumer data into cells without executing the consumer's source. */
import { readFile, lstat } from "node:fs/promises";
import { resolve, extname, dirname, join } from "node:path";
import ts from "typescript";
import { compileContentMaps, contentMapToCells, routePackToCells } from "../dist/content-map/cells.js";

const usage = "Usage: cells.mjs migrate --from <file> [--to <root>|--root <root>] [--repo <repository>] [--input map|route-pack] [--export <name>] [--date YYYY-MM-DD]\n       cells.mjs compile [--root <root>] [--repo <repository>] [--check]\nDefault cell root: <repository>/clossys/agents/publisher";

function options(args) {
  const [verb, ...rest] = args;
  if (!["migrate", "compile"].includes(verb)) throw new Error(usage);
  const allowed = verb === "migrate" ? ["from", "to", "root", "repo", "input", "export", "date"] : ["root", "repo", "check"];
  const result = {};
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index]?.replace(/^--/, "");
    if (!rest[index]?.startsWith("--") || !allowed.includes(name) || Object.hasOwn(result, name)) throw new Error(usage);
    if (name === "check") result.check = true;
    else {
      const value = rest[++index];
      if (!value || value.startsWith("--")) throw new Error(usage);
      result[name] = value;
    }
  }
  if (verb === "migrate" && (!result.from || result.to && result.root)) throw new Error(usage);
  if (result.input && !["map", "route-pack"].includes(result.input)) throw new Error(usage);
  if (result.export && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(result.export)) throw new Error("Expected a static exported identifier");
  if (result.date && (!/^\d{4}-\d{2}-\d{2}$/.test(result.date) || !Number.isFinite(new Date(`${result.date}T00:00:00Z`).getTime()) || new Date(`${result.date}T00:00:00Z`).toISOString().slice(0, 10) !== result.date)) throw new Error("Expected an ISO migration date");
  return { verb, ...result };
}

async function repositoryRoot(explicit) {
  let directory = resolve(explicit ?? process.cwd());
  for (;;) {
    try {
      const marker = await lstat(join(directory, ".git"));
      if (marker.isDirectory() || marker.isFile()) return directory;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (explicit || parent === directory) throw new Error("Cannot resolve a repository root; use --root or --to explicitly");
    directory = parent;
  }
}

async function cellRoot(parsed) {
  if (parsed.to || parsed.root) return resolve(parsed.to ?? parsed.root);
  return join(await repositoryRoot(parsed.repo), "clossys", "agents", "publisher");
}

/** The input is data in a TypeScript envelope, never an import or eval target. */
function literalRoutePack(source, exportedName) {
  const file = ts.createSourceFile("input.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length) throw new Error("Malformed TypeScript migration input");
  const declarations = new Map();
  const exported = new Set();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isExported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const name = declaration.name.text;
      if (declarations.has(name)) throw new Error("Duplicate top-level migration declaration");
      declarations.set(name, { initializer: declaration.initializer, constant: Boolean(statement.declarationList.flags & ts.NodeFlags.Const) });
      if (isExported) exported.add(name);
    }
  }
  const unwrap = node => ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
  if (!exportedName) {
    const candidates = [...exported].filter(name => {
      const initializer = declarations.get(name).initializer;
      if (!initializer) return false;
      const node = unwrap(initializer);
      return ts.isObjectLiteralExpression(node) && node.properties.some(property => ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === "routes");
    });
    if (candidates.length !== 1) throw new Error("Name exactly one exported route-pack object with --export");
    exportedName = candidates[0];
  }
  if (!exported.has(exportedName)) throw new Error("Requested route pack must be an exported const declaration");
  const cache = new Map();
  const visiting = new Set();
  const identifier = name => {
    if (cache.has(name)) return structuredClone(cache.get(name));
    if (visiting.has(name)) throw new Error("Cyclic migration data references are refused");
    const declaration = declarations.get(name);
    if (!declaration?.constant || !declaration.initializer) throw new Error("Migration data references must name initialized const declarations");
    visiting.add(name);
    const result = value(declaration.initializer);
    visiting.delete(name);
    cache.set(name, result);
    return structuredClone(result);
  };
  const value = original => {
    const node = unwrap(original);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) {
      const number = Number(node.text);
      if (!Number.isFinite(number)) throw new Error("Migration numbers must be finite");
      return number;
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(node)) return identifier(node.text);
    if (ts.isArrayLiteralExpression(node)) {
      const result = [];
      for (const item of node.elements) {
        if (ts.isSpreadElement(item)) {
          const spread = value(item.expression);
          if (!Array.isArray(spread)) throw new Error("Only literal arrays can be spread in migration data");
          result.push(...spread);
        } else result.push(value(item));
      }
      return result;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const result = Object.create(null);
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw new Error("Migration objects require literal property assignments");
        const name = property.name.text;
        if (Object.hasOwn(result, name)) throw new Error("Duplicate migration object properties are refused");
        result[name] = value(property.initializer);
      }
      return result;
    }
    throw new Error("Migration input contains an executable or unsupported expression");
  };
  return identifier(exportedName);
}

let parsed;
try { parsed = options(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 2; }
if (parsed) {
  try {
    if (parsed.verb === "migrate") {
      const path = resolve(parsed.from);
      const source = await readFile(path, "utf8");
      const kind = parsed.input ?? (extname(path) === ".ts" ? "route-pack" : "map");
      const input = kind === "route-pack" && extname(path) === ".ts" ? literalRoutePack(source, parsed.export) : JSON.parse(source);
      const settings = parsed.date ? { date: parsed.date } : {};
      const root = await cellRoot(parsed);
      if (kind === "route-pack") await routePackToCells(input, root, settings);
      else await contentMapToCells(input, root, settings);
      console.log("Publisher cells migration complete");
    } else {
      await compileContentMaps(await cellRoot(parsed), { check: Boolean(parsed.check) });
      console.log(parsed.check ? "Publisher compiled cells are current" : "Publisher cells compiled");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Publisher cells command failed");
    process.exitCode = 1;
  }
}
