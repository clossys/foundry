#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rosterPath = resolve(root, "src/catalog/rules/source-roster.json");
const roster = JSON.parse(readFileSync(rosterPath, "utf8"));
const args = process.argv.slice(2);
const upstream = args.includes("--upstream") ? args[args.indexOf("--upstream") + 1] : undefined;
const check = args.includes("--check");
if (args.includes("--upstream") && !upstream) throw new Error("--upstream needs a checkout path");
if (check && upstream) throw new Error("--check uses the committed source snapshot");
const paths = ["themes.ts", "base-colors.ts"];
const sources = Object.fromEntries(paths.map(name => [name, readFileSync(upstream
  ? resolve(upstream, "apps/v4/registry", name)
  : resolve(root, "src/importers/vendor", `shadcn-${name}.txt`), "utf8")]));
const sha256 = text => createHash("sha256").update(text).digest("hex");
const commit = upstream ? execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  : roster.tokens.presets[0].theme.pin.commit;
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("upstream must have an immutable commit");

// Read literal registry data without executing an upstream module or its imports.
function literal(node) {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression);
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => {
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw new Error("nonliteral theme property");
    return [property.name.text, literal(property.initializer)];
  }));
  throw new Error("nonliteral theme value");
}
const themeFile = ts.createSourceFile("themes.ts", sources["themes.ts"], ts.ScriptTarget.Latest, true);
let themes;
for (const statement of themeFile.statements) if (ts.isVariableStatement(statement)) {
  const declaration = statement.declarationList.declarations.find(row => row.name.getText(themeFile) === "THEMES");
  if (declaration?.initializer) themes = literal(declaration.initializer);
}
if (!themes) throw new Error("THEMES literal is absent");
const baseFile = ts.createSourceFile("base-colors.ts", sources["base-colors.ts"], ts.ScriptTarget.Latest, true);
const arrays = [];
const visit = node => { if (ts.isArrayLiteralExpression(node)) arrays.push(literal(node)); ts.forEachChild(node, visit); };
visit(baseFile);
if (arrays.length !== 1 || arrays[0].length !== new Set(arrays[0]).size) throw new Error("base color roster is ambiguous");
const names = arrays[0];
// Preserve established positions for existing presets, then append upstream additions.
const ordered = [...roster.tokens.presets.map(row => row.theme.baseColor).filter(name => names.includes(name)), ...names.filter(name => !roster.tokens.presets.some(row => row.theme.baseColor === name))];
const presets = ordered.map(name => {
  const matches = themes.filter(theme => theme.name === name);
  if (matches.length !== 1) throw new Error(`missing or duplicate base theme ${name}`);
  const theme = matches[0];
  return {
    id: `shadcn-${name}`, label: `shadcn ${name}`, ...(name === "neutral" ? { default: true } : {}),
    theme: {
      source: "shadcn@aria", baseColor: name,
      pin: { url: `https://github.com/shadcn-ui/ui/blob/${commit}/apps/v4/registry/themes.ts`, commit, file: `apps/v4/registry/themes.ts#${name}`, sha256: sha256(sources["themes.ts"]) },
      vars: Object.fromEntries(["light", "dark"].map(mode => [mode, Object.fromEntries(Object.entries(theme.cssVars[mode]).map(([key, value]) => [`--${key}`, value]))])),
    },
    namespace: { source: "tailwind-default" },
  };
});
const wanted = JSON.stringify(presets);
if (check) {
  if (JSON.stringify(roster.tokens.presets) !== wanted) throw new Error("preset values or provenance differ from the pinned theme snapshot");
  console.log(`Verified ${presets.length} base-color presets at ${commit}`);
} else {
  roster.tokens.presets = presets;
  writeFileSync(rosterPath, JSON.stringify(roster, null, 2) + "\n");
  for (const name of paths) writeFileSync(resolve(root, "src/importers/vendor", `shadcn-${name}.txt`), sources[name]);
  console.log(`Imported ${presets.length} base-color presets at ${commit}`);
}
