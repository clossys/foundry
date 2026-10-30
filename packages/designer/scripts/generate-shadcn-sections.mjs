import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const entries = { "section-header": "SectionHeader", content: "Content", "empty-state": "EmptyState" };
const ports = Object.fromEntries(await Promise.all(Object.entries(entries).map(async ([leaf, primary]) => {
  const text = await readFile(resolve(root, `src/sections/shadcn-aria/${primary}.tsx`), "utf8");
  const content = text
    .replace('"../../components/SemanticContent.js"', '"@clossys/designer/components"')
    .replace('import { cx } from "../../components/internal/cx.js";', 'import { mergeUiClasses as cx } from "@clossys/designer/components";')
    .replace(/"\.\.\/\.\.\/blocks\/(?:ContentSection|EmptyState)\.js"/g, '"@clossys/designer/blocks"')
    .replace('"./SectionHeader.js"', '"../section-header/index.js"');
  return [leaf, { path: `sections/${leaf}/${primary}.tsx`, content }];
})));
const path = resolve(root, "src/importers/shadcn-sections.data.json");
const text = JSON.stringify({ ports }, null, 2) + "\n";
if (check) {
  if (await readFile(path, "utf8") !== text) throw new Error("shadcn sections: source-port snapshot is stale");
} else {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
