/**
 * `findSecondBinders` — a product ships one brand overlay. Any other
 * stylesheet under the applications directory that declares a `--color-*`
 * custom property is a second binding of the same slots and is reported.
 * Build output and dependency directories are not scanned.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist", "build", "coverage", ".git"]);
const COLOR_DECLARATION_RE = /(?:^|[\s;{])(--color-[a-z0-9-]+)\s*:/g;

export interface SecondBinderFinding {
  file: string;
  slots: string[];
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      out.push(join(dir, entry.name));
    }
  }
}

export function findSecondBinders(appsDir: string, brandCssFile: string): SecondBinderFinding[] {
  const brand = resolve(brandCssFile);
  const files: string[] = [];
  walk(resolve(appsDir), files);
  const findings: SecondBinderFinding[] = [];
  for (const file of files.sort()) {
    if (resolve(file) === brand) continue;
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const slots = [...new Set([...css.matchAll(COLOR_DECLARATION_RE)].map((m) => m[1] as string))].sort();
    if (slots.length > 0) findings.push({ file, slots });
  }
  return findings;
}
