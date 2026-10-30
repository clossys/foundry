#!/usr/bin/env node
/**
 * One-time/repeatable codegen: reads `icon-source-data.json` (this
 * package's own vendored copy of 40 icons' SVG path data — see
 * THIRD-PARTY-NOTICES.md for provenance) and writes one
 * `src/icons/<PascalName>.ts` file per entry (plain `IconNode` DATA, not a
 * component — see `src/icons/types.ts` and `README.md`'s "Icon glyph data"
 * section for why), plus `src/icons/index.ts`. Not part of the package's
 * build (`tsc` compiles the already-generated `.ts` files, same as every
 * other generated artifact in this repo) — this script exists so the 40
 * files stay mechanically regenerable rather than hand-copied if the source
 * data ever changes.
 *
 * ### Refreshing against a newer Lucide release
 *
 * This package's data is pinned at Lucide 1.23.0, apart from eight content
 * glyphs added later from Lucide 1.24.0 (see THIRD-PARTY-NOTICES.md for the
 * list and for why — insulation from upstream glyph renames and churn, not staleness
 * for its own sake). To pull a newer Lucide release for an EXISTING name in
 * `NAME_MAP` below:
 *
 *   1. Find the glyph's current kebab-case name in the target Lucide
 *      version (check THIRD-PARTY-NOTICES.md's rename table first — four of
 *      this set's names already diverged from Lucide's own current naming).
 *   2. Copy that glyph's `<svg>` children from `lucide-static` or
 *      `lucide-react`'s published source into `icon-source-data.json`,
 *      converting each child element to a `[tag, { ...attrs }]` tuple —
 *      the same shape every existing entry already uses.
 *   3. Update the "version 1.23.0" references in THIRD-PARTY-NOTICES.md and
 *      this package's CHANGELOG.md to the new pinned version.
 *   4. Run `node scripts/generate-icons.mjs` and `npm test -w packages/ui`
 *      — `src/icons/*.test.ts` (adapted from the pre-merge icons package)
 *      re-renders every glyph and checks it against the accessibility/
 *      colour contract, so a malformed conversion fails loudly.
 *
 * Adding a NEW glyph name: add its kebab source name and PascalCase target
 * name to `NAME_MAP` below, add its path data to `icon-source-data.json`,
 * then re-run this script. Follow this package's own README ("How the 40
 * were chosen") evidence method before adding one — this set is
 * deliberately curated, not a grab-bag.
 *
 * Run: node scripts/generate-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataPath = join(root, "scripts", "icon-source-data.json");
const outDir = join(root, "src", "icons");

/**
 * kebab-case source name -> this package's exported DATA constant name.
 * No "Icon" suffix (see README.md "Naming convention" under "Icon glyph
 * data" for the reasoning) — matches `lucide-react`'s own PascalCase export
 * naming, which most consumers evaluating this data will already recognize,
 * while remaining unambiguous that these are `IconNode` values, not
 * components: `const Clock: IconNode = [...]`, never `<Clock />` on its own.
 */
const NAME_MAP = {
  "alert-triangle": "AlertTriangle",
  "panel-left": "PanelLeft",
  "arrow-right": "ArrowRight",
  "book-open": "BookOpen",
  "box": "Box",
  "briefcase": "Briefcase",
  "building-2": "Building2",
  "calendar": "Calendar",
  "check": "Check",
  "check-circle": "CheckCircle",
  "chevron-down": "ChevronDown",
  "chevron-left": "ChevronLeft",
  "chevron-right": "ChevronRight",
  "chevron-up": "ChevronUp",
  "clock": "Clock",
  "credit-card": "CreditCard",
  "external-link": "ExternalLink",
  "file-check": "FileCheck",
  "file-text": "FileText",
  "folder": "Folder",
  "globe": "Globe",
  "grid-3x3": "Grid3x3",
  "home": "Home",
  "info": "Info",
  "landmark": "Landmark",
  "layers": "Layers",
  "list": "List",
  "lock": "Lock",
  "monitor": "Monitor",
  "moon": "Moon",
  "plug": "Plug",
  "receipt": "Receipt",
  "scale": "Scale",
  "search": "Search",
  "settings": "Settings",
  "shield-check": "ShieldCheck",
  "sun": "Sun",
  "user": "User",
  "users": "Users",
  "x": "X",
  "x-circle": "XCircle",
};

const data = JSON.parse(readFileSync(dataPath, "utf8"));

mkdirSync(outDir, { recursive: true });

const exportLines = [];

// The shell owns paint. Upstream half-unit dot circles remain the same geometry;
// omit their redundant currentColor fill under the shell's currentColor stroke.
const featureNode = node => node.map(([tag, attrs]) => {
  const copy = { ...attrs };
  if (tag === "circle" && copy.r === ".5" && copy.fill === "currentColor") delete copy.fill;
  return [tag, copy];
});
for (const [kebabName, originalNode] of Object.entries(data)) {
  const node = kebabName.startsWith("feature-") ? featureNode(originalNode) : originalNode;
  const constName = NAME_MAP[kebabName] ?? (kebabName.startsWith("feature-") ? kebabName.split("-").map(part => part[0].toUpperCase() + part.slice(1)).join("") : undefined);
  if (!constName) {
    throw new Error(`No export name mapped for source icon "${kebabName}"`);
  }

  const nodeLiteral = JSON.stringify(node, null, 2)
    // JSON.stringify quotes every key; re-emit as a plain TS array literal
    // (this file is generated, never hand-edited, so the exact formatting
    // only needs to satisfy Prettier-adjacent readability, not be typed by
    // a human).
    .replace(/"([a-zA-Z][\w-]*)":/g, '"$1":');

  const fileContents = `// GENERATED FILE — do not edit by hand. Run \`node scripts/generate-icons.mjs\` from a source checkout; the generator does not ship with this package.
// Source: kebab name "${kebabName}" — see THIRD-PARTY-NOTICES.md for the
// origin of this path data.
import type { IconNode } from "./types.js";

export const ${constName}: IconNode = ${nodeLiteral} as const;
`;

  writeFileSync(join(outDir, `${constName}.ts`), fileContents);
  exportLines.push(`export { ${constName} } from "./${constName}.js";`);
}

exportLines.sort();

const indexContents = `// GENERATED FILE — do not edit by hand. Run \`node scripts/generate-icons.mjs\` from a source checkout; the generator does not ship with this package.
${exportLines.join("\n")}
export type { IconNode } from "./types.js";
`;

writeFileSync(join(outDir, "index.ts"), indexContents);

console.log(`Generated ${Object.keys(data).length} icon data modules + index.ts`);

// Feature glyphs are isolated from the original semantic glyph pins.
const featureEntries = Object.entries(data).filter(([name]) => name.startsWith("feature-")).map(([name, node]) => [name, featureNode(node)]);
const pascal = name => name.split("-").map(part => part[0].toUpperCase() + part.slice(1)).join("");
const registry = '// GENERATED FILE — do not edit by hand. Run node scripts/generate-icons.mjs.\nimport type { IconNode } from "./types.js";\n' +
  'export const featureGlyphs = ' + JSON.stringify(Object.fromEntries(featureEntries.map(([name, node]) => ['assets.icon-set.glyph.' + name.slice(8), node])), null, 2) + ' as const satisfies Readonly<Record<string, IconNode>>;\n';
writeFileSync(join(outDir, "feature-glyphs.ts"), registry);
const iconSet = {
  $extensions: { "com.clossys.fill": {
    id: "lucide/assets.icon-set", slot: "assets.icon-set", source: "lucide", mode: "implementation",
    sourceAddress: "lucide-react@1.23.0/dist/esm/icons/", relation: "same-contract", builtOn: [], conforms: [], evidence: [],
    author: "third-party", trust: "pinned-upstream", license: "ISC",
    pin: { package: "lucide-react", version: "1.23.0", file: "src/icons/feature-glyphs.ts", sha256: createHash("sha256").update(registry).digest("hex") },
    status: "draft", reads: { tokens: [], assets: [] }
  } },
  assets: { "icon-set": { glyph: Object.fromEntries(featureEntries.map(([name, node]) => [name.slice(8), { $type: "glyph", $value: node }])) } }
};
writeFileSync(join(root, "src/catalog/fills/lucide/assets.icon-set.json"), JSON.stringify(iconSet, null, 2) + "\n");
