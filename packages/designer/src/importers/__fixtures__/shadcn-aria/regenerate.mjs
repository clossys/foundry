import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import assert from "node:assert/strict";

// Fixture-only runner: evaluate the two pure TypeScript modules without a build.
const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../..");
const mutant = process.argv.find(value => value.startsWith("--mutant="))?.slice(9);
const mutations = {
  sha: ['sha256(file.content) !== expected.get(file.path)', 'false'],
  root: ['if (missing.length) return', 'if (false) return'],
  blockers: ['if (!rewrite || rewrite.issues.length)', 'if (!rewrite)'],
  glyph: ['add("K7", file.path, "glyph", "Unbound icon artwork remains")', 'undefined'],
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".js") && context.parentURL?.startsWith(pathToFileURL(src).href)) {
      const target = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      try { readFileSync(target); return { url: target.href, shortCircuit: true }; } catch {}
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(pathToFileURL(src).href) && url.endsWith(".ts")) {
      let source = readFileSync(new URL(url), "utf8");
      if (mutant && mutations[mutant] && (mutant === "glyph" ? url.endsWith("/rewrite.ts") : url.endsWith("/shadcn-aria-components.ts"))) {
        const [before, after] = mutations[mutant];
        assert(source.includes(before), "mutation anchor exists"); source = source.replace(before, after);
      }
      return { format: "module", source: stripTypeScriptTypes(source), shortCircuit: true };
    }
    return next(url, context);
  },
});
const { importShadcnAriaComponents, generatedShadcnComponentFiles, materializeShadcnComponent } = await import(pathToFileURL(resolve(src, "importers/shadcn-aria-components.ts")).href);
const read = name => readFileSync(resolve(here, name), "utf8");
const items = readdirSync(here).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui");
const input = { items, styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } };
if (process.argv.includes("--probe")) {
  const tampered = structuredClone(input); tampered.items.find(item => item.name === "button").files[0].content += " ";
  assert.throws(() => importShadcnAriaComponents(tampered), /sha256 mismatch/, "sha: one changed byte is refused");
  const slots = JSON.parse(readFileSync(resolve(src, "catalog/slots/components.json"), "utf8"));
  slots.find(slot => slot.id === "components.button").contract.root = "rac:MissingRoot";
  assert.equal(importShadcnAriaComponents({ ...input, slots }).receipt.find(row => row.item === "button").runtime, "X", "root: incompatible root has no fill");
  assert.throws(() => materializeShadcnComponent(importShadcnAriaComponents(input), "button"), /unresolved/, "blockers: unsafe rewrite cannot materialize");
  const { rewriteShadcnAria } = await import(pathToFileURL(resolve(src, "importers/rewrite.ts")).href);
  assert(rewriteShadcnAria({ item: "button", leaf: "button", files: [{ path: "button.tsx", content: '<svg />' }], styles: "", leafByItem: {} }).issues.some(issue => issue.code === "K7"), "glyph: inline artwork is reported");
  console.log("probe pass");
  process.exit(0);
}
const files = generatedShadcnComponentFiles(input);
const result = importShadcnAriaComponents(input);
const destination = resolve(src, "catalog/fills/shadcn@aria");
mkdirSync(destination, { recursive: true });
for (const [name, bytes] of Object.entries(files)) writeFileSync(resolve(destination, name), bytes);
for (const item of ["button", "select", "calendar"]) writeFileSync(resolve(here, `${item}.golden.json`), JSON.stringify(result.rewrites[item], null, 2) + "\n");
console.log(JSON.stringify({ fills: result.fills.length, receipt: result.receipt.length, rejected: result.receipt.filter(row => row.status === "rejected").map(row => row.item), blockers: Object.fromEntries(["button", "select", "calendar"].map(item => [item, result.rewrites[item].issues.length])) }));
