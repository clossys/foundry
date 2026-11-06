/**
 * Write (or --check) the retained render bytes in src/blocks/items/legacy-*-ssr.test.json:
 * every case whose block is still published (FeatureGrid, NavGrid, ContentSection) and whose
 * name is in legacy-ssr.test.json, rendered from the built Designer exactly as
 * RetiredCatalog.cleanup.test.tsx renders it (static markup, provenance attributes removed), under the
 * same marketing component selection the test harness supplies as its ambient selection.
 * Retiring cases and props are never touched. Build Designer first. These bytes are
 * re-captured only through this generator, with the reason in the commit; never by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { FeatureGrid } = await import("../dist/blocks/FeatureGrid.js");
const { NavGrid } = await import("../dist/blocks/NavGrid.js");
const { ContentSection } = await import("../dist/blocks/ContentSection.js");
const { withoutDsAttrs } = await import("../dist/catalog-core/provenance-attrs.js");
const { ConsumerComponentProvider } = await import("../dist/runtime/component-leaf.client.js");
const { marketingComponentSelection } = await import("../dist/studio/marketing-component-selection.js");
const selection = marketingComponentSelection();

const retainedBlocks = { FeatureGrid, NavGrid, ContentSection };
const files = ["legacy-ssr.test.json", "legacy-catalog-ssr.test.json", "legacy-headless-catalog-ssr.test.json"]
  .map(name => resolve(root, "src/blocks/items", name));
const decode = value => {
  if (Array.isArray(value)) return value.map(decode);
  if (!value || typeof value !== "object") return value;
  if (typeof value.$tag === "string") return createElement(value.$tag, value.props, decode(value.children));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === "onSelect" ? () => {} : decode(child)]));
};
const legacyNames = new Set(JSON.parse(readFileSync(files[0], "utf8")).map(entry => entry.name));
const stale = [];
let rendered = 0;
for (const file of files) {
  const before = readFileSync(file, "utf8");
  const cases = JSON.parse(before).map(fixture => {
    if (!Object.hasOwn(retainedBlocks, fixture.block) || !legacyNames.has(fixture.name)) return fixture;
    rendered++;
    const { html: _html, error: _error, ...rest } = fixture;
    try { return { ...rest, html: withoutDsAttrs(renderToStaticMarkup(createElement(ConsumerComponentProvider, { value: selection }, createElement(retainedBlocks[fixture.block], decode(fixture.props))))) }; }
    catch (error) { return { ...rest, error: error instanceof Error ? error.message : String(error) }; }
  });
  const after = JSON.stringify(cases, null, 2) + "\n";
  if (after === before) continue;
  if (process.argv.includes("--check")) stale.push(file);
  else writeFileSync(file, after);
}
if (stale.length) throw new Error(`Legacy item goldens are stale: run node scripts/generate-legacy-item-goldens.mjs (${stale.join(", ")})`);
console.log(`Legacy item goldens: ${rendered} retained cases ${process.argv.includes("--check") ? "current" : "written"}`);
