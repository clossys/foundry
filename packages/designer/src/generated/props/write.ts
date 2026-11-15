import { readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSectionProps } from "./generate.js";
import { liveSections } from "./sources.js";

/** Writes the generated props modules next to this file and removes stale ones. */
export function writeSectionProps(folder = dirname(fileURLToPath(import.meta.url))): number {
  const files = generateSectionProps(liveSections());
  for (const name of readdirSync(folder)) if (name.startsWith("sections.") && name.endsWith(".ts") && !files.has(name)) unlinkSync(join(folder, name));
  for (const [name, text] of files) writeFileSync(join(folder, name), text);
  return files.size;
}

// Run from the built package: node dist/generated/props/write.js src/generated/props
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(`props: ${writeSectionProps(process.argv[2])} files`);
