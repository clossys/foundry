#!/usr/bin/env node
/**
 * One-time/repeatable codegen: reads `icon-source-data.json` (this
 * package's own vendored copy of the SVG path data for the 32 icons this
 * package ships — see THIRD-PARTY-NOTICES.md for provenance) and writes one
 * `src/icons/<PascalName>Icon.tsx` file per entry, plus `src/icons/index.ts`.
 * Not part of the package's build (`tsc` compiles the already-generated
 * `.tsx` files, same as every other package here) — this script exists so
 * the 32 files stay mechanically regenerable rather than hand-copied if the
 * source data ever changes, the same reasoning `tokens`' generated CSS
 * isn't hand-edited either.
 *
 * Run: node scripts/generate-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataPath = join(root, "scripts", "icon-source-data.json");
const outDir = join(root, "src", "icons");

/** kebab-case source name -> this package's exported component name. */
const NAME_MAP = {
  "alert-triangle": "AlertTriangleIcon",
  "book-open": "BookOpenIcon",
  "box": "BoxIcon",
  "building-2": "Building2Icon",
  "calendar": "CalendarIcon",
  "check": "CheckIcon",
  "check-circle": "CheckCircleIcon",
  "chevron-down": "ChevronDownIcon",
  "chevron-left": "ChevronLeftIcon",
  "chevron-right": "ChevronRightIcon",
  "chevron-up": "ChevronUpIcon",
  "clock": "ClockIcon",
  "credit-card": "CreditCardIcon",
  "external-link": "ExternalLinkIcon",
  "file-text": "FileTextIcon",
  "folder": "FolderIcon",
  "grid-3x3": "Grid3x3Icon",
  "home": "HomeIcon",
  "info": "InfoIcon",
  "list": "ListIcon",
  "lock": "LockIcon",
  "monitor": "MonitorIcon",
  "moon": "MoonIcon",
  "plug": "PlugIcon",
  "receipt": "ReceiptIcon",
  "search": "SearchIcon",
  "settings": "SettingsIcon",
  "sun": "SunIcon",
  "user": "UserIcon",
  "users": "UsersIcon",
  "x": "XIcon",
  "x-circle": "XCircleIcon",
};

const data = JSON.parse(readFileSync(dataPath, "utf8"));

mkdirSync(outDir, { recursive: true });

const exportLines = [];

for (const [kebabName, node] of Object.entries(data)) {
  const componentName = NAME_MAP[kebabName];
  if (!componentName) {
    throw new Error(`No component name mapped for source icon "${kebabName}"`);
  }

  const nodeLiteral = JSON.stringify(node, null, 2)
    // JSON.stringify quotes every key; re-emit as a plain TS array literal
    // (this file is generated, never hand-edited, so the exact formatting
    // only needs to satisfy Prettier-adjacent readability, not be typed by
    // a human).
    .replace(/"([a-zA-Z][\w-]*)":/g, '"$1":');

  const fileContents = `// GENERATED FILE — do not edit by hand. Run \`node scripts/generate-icons.mjs\`.
// Source: kebab name "${kebabName}" — see THIRD-PARTY-NOTICES.md for the
// origin of this path data.
import { createIcon } from "../createIcon.js";

export const ${componentName} = createIcon(
  "${componentName}",
  ${nodeLiteral} as const,
);
`;

  writeFileSync(join(outDir, `${componentName}.tsx`), fileContents);
  exportLines.push(`export { ${componentName} } from "./${componentName}.js";`);
}

exportLines.sort();

const indexContents = `// GENERATED FILE — do not edit by hand. Run \`node scripts/generate-icons.mjs\`.
${exportLines.join("\n")}
`;

writeFileSync(join(outDir, "index.ts"), indexContents);

console.log(`Generated ${Object.keys(data).length} icon components + index.ts`);
