#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = key => args[args.indexOf(key) + 1];
if (!args.includes("--shadcn") || !args.includes("--ai-elements")) throw new Error("provide --shadcn and --ai-elements checkout paths");
const trees = { shadcn: resolve(option("--shadcn")), "ai-elements": resolve(option("--ai-elements")) };
const sha256 = content => createHash("sha256").update(content).digest("hex");
const pins = Object.fromEntries(Object.entries(trees).map(([source, path]) => [source, execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()]));
const readJson = path => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const contract = readJson("src/catalog/rules/token-contract.json");
const tokenNames = new Set([...Object.values(contract.leaves).flatMap(leaf => Object.values(leaf.members ?? {}).map(member => member.target)), ...Object.keys(contract.aliases)]);
const roster = readJson("src/catalog/rules/source-roster.json");
const variables = [...new Set(roster.tokens.presets.flatMap(preset => Object.values(preset.theme.vars).flatMap(vars => Object.keys(vars))))].sort();
const adapterPath = resolve(root, "src/catalog/adapters/shadcn@aria.json");
const adapterText = readFileSync(adapterPath, "utf8");
const reportPath = resolve(root, "src/catalog/rules/shadcn-refresh-needs.json");
const previousReport = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : undefined;
const adapter = readJson("src/catalog/adapters/shadcn@aria.json");
const glyphs = readJson("src/importers/lucide-pin.json");
const requested = {
  shadcn: "sidebar command kbd item empty scroll-area sheet drawer dropdown-menu context-menu hover-card collapsible accordion alert-dialog aspect-ratio button-group input-group input-otp label native-select pagination carousel direction marker message message-scroller bubble attachment code-block questionnaire trace".split(" ").map(name => `apps/v4/registry/bases/aria/ui/${name}.tsx`),
  "ai-elements": "conversation prompt-input reasoning chain-of-thought tool sources inline-citation model-selector suggestion context task plan queue confirmation checkpoint file-tree terminal stack-trace test-results agent".split(" ").map(name => `packages/elements/src/${name}.tsx`),
};
const icons = new Map();
const sources = [];
const seen = new Set();
function need(name, origin) {
  if (!icons.has(name)) icons.set(name, new Set());
  icons.get(name).add(origin);
}
function inspect(source, path) {
  const id = `${source}/${path}`;
  if (seen.has(id)) return;
  seen.add(id);
  const full = resolve(trees[source], path);
  if (!existsSync(full)) throw new Error(`missing dependency ${id}`);
  const content = readFileSync(full, "utf8");
  sources.push({ source, path, sha256: sha256(content) });
  const ast = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (specifier === "lucide-react" && !node.importClause?.isTypeOnly) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) if (!binding.isTypeOnly) need((binding.propertyName ?? binding.name).text, id);
      }
      let target;
      if (specifier.startsWith("@/registry/bases/aria/")) target = resolve(trees[source], "apps/v4", specifier.slice(2));
      else if (specifier.startsWith("@repo/shadcn-ui/")) target = resolve(trees[source], "packages/shadcn-ui", specifier.slice("@repo/shadcn-ui/".length));
      else if (specifier.startsWith(".")) target = resolve(dirname(full), specifier);
      if (target) {
        const found = [target, `${target}.tsx`, `${target}.ts`, resolve(target, "index.tsx"), resolve(target, "index.ts")].find(file => existsSync(file) && /\.tsx?$/.test(file));
        if (found) inspect(source, relative(trees[source], found));
      }
    }
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "lucide" && node.initializer && ts.isStringLiteral(node.initializer)) need(node.initializer.text, id);
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
for (const [source, paths] of Object.entries(requested)) for (const path of paths) inspect(source, path);
need("PanelRightIcon", "sidebar counterpart requirement");
const requirements = [...icons].sort(([a], [b]) => a.localeCompare(b)).map(([name, uses]) => {
  const nameWithoutSuffix = name.endsWith("Icon") ? name.slice(0, -4) : name;
  const exact = glyphs.find(glyph => glyph.export === nameWithoutSuffix);
  const match = exact;
  if (match) {
    // Bind only authentic existing glyph identities; never substitute a nearby symbol.
    adapter.glyphs[name] = match.leaf;
    return { icon: name, status: "existing-lucide-fill", leaf: match.leaf, member: "default", pin: match.pin, sourceAddress: `lucide-react@${match.pin.version}/dist/esm/icons/${match.upstream}.js`, uses: [...uses].sort() };
  }
  return { icon: name, status: "NEED", reason: "No matching existing icon leaf; all icon leaves have a closed default member. Preserve this glyph identity until the asset contract permits it.", uses: [...uses].sort() };
});
adapter.glyphs = Object.fromEntries(Object.entries(adapter.glyphs).sort(([a], [b]) => a.localeCompare(b)));
const glyphBlock = JSON.stringify(adapter.glyphs, null, 2).split("\n").map((line, index) => index ? `  ${line}` : line).join("\n");
const updatedAdapterText = adapterText.replace(/("glyphs": )\{[\s\S]*?\n  \}/, `$1${glyphBlock}`);
writeFileSync(adapterPath, updatedAdapterText);
const report = {
  schemaVersion: 1,
  sources: {
    shadcn: { url: "https://github.com/shadcn-ui/ui", commit: pins.shadcn, license: "MIT" },
    "ai-elements": { url: "https://github.com/vercel/ai-elements", commit: pins["ai-elements"], license: "Apache-2.0", adoption: "inspected-only" },
  },
  themeVariables: { source: "apps/v4/registry/themes.ts", count: variables.length, covered: variables.filter(name => tokenNames.has(name)), needs: variables.filter(name => !tokenNames.has(name)).map(variable => ({ status: "NEED", variable, reason: "Absent from the frozen token contract" })) },
  presets: roster.tokens.presets.map(preset => ({ id: preset.id, commit: preset.theme.pin.commit })),
  icons: requirements,
  inspectedFiles: sources.sort((a, b) => `${a.source}/${a.path}`.localeCompare(`${b.source}/${b.path}`)),
  // Preserve measured component evidence only while all its source inputs match.
  ...(previousReport?.sources?.shadcn?.commit === pins.shadcn
    && previousReport?.sources?.["ai-elements"]?.commit === pins["ai-elements"]
    && previousReport?.componentAdoption?.adapterSha256 === sha256(updatedAdapterText)
    ? { componentAdoption: previousReport.componentAdoption } : {}),
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ themeVariables: variables.length, themeNeeds: report.themeVariables.needs.length, icons: requirements.length, existing: requirements.filter(row => row.status === "existing-lucide-fill").length, needs: requirements.filter(row => row.status === "NEED").length, inspectedFiles: sources.length }));
