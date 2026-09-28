/**
 * `findSecondBinders` — a product ships one brand overlay. Any other
 * stylesheet (`.css`, `.scss`, `.pcss`) under the applications directory that
 * declares a `--color-*` custom property, resets them with `--color-*`, or
 * declares one inside `@apply [--color-x:…]` is a second binding of the same
 * slots and is reported. Comments and quoted strings are ignored.
 * Dependency and tool-output directories are not scanned, nor `build/` and
 * `dist/` at the top of the applications directory or of one application.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Tool output and dependencies: never product source, at any depth. */
const SKIP_ANYWHERE = new Set(["node_modules", ".next", ".turbo", "coverage", ".git"]);
/**
 * `build/` and `dist/` are build output only at the top of the applications
 * directory or at an application's own root (`apps/build`, `apps/web/dist`).
 * Deeper, a folder with those names is ordinary source (`apps/web/src/build/`).
 */
const SKIP_AT_APP_ROOT = new Set(["build", "dist"]);
const APP_ROOT_MAX_DEPTH = 1;
const STYLESHEET_EXTENSIONS = [".css", ".scss", ".pcss"];
/** `--color-x:` and the `--color-*: initial` wildcard reset; also inside `@apply [--color-x:red]`. `var(--color-x)` reads have no colon and never match. */
const COLOR_DECLARATION_RE = /(?:^|[\s;{\[])(--color-(?:[a-z0-9-]+|\*))\s*:/g;
/** Comments and quoted strings in one left-to-right pass, so a quote inside a comment or a comment marker inside a string cannot confuse the other. */
const COMMENT_OR_STRING_RE = /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
const COMMENT_OR_STRING_OR_LINE_RE = /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|(?<![:\w(])\/\/[^\n]*/g;

export interface SecondBinderFinding {
  file: string;
  slots: string[];
}

function walk(dir: string, depth: number, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_ANYWHERE.has(entry.name)) continue;
      if (depth <= APP_ROOT_MAX_DEPTH && SKIP_AT_APP_ROOT.has(entry.name)) continue;
      walk(join(dir, entry.name), depth + 1, out);
    } else if (entry.isFile() && STYLESHEET_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
}

function stripCommentsAndStrings(source: string, file: string): string {
  const re = file.endsWith(".css") ? COMMENT_OR_STRING_RE : COMMENT_OR_STRING_OR_LINE_RE;
  return source.replace(re, " ");
}

export function findSecondBinders(appsDir: string, brandCssFile: string): SecondBinderFinding[] {
  const brand = resolve(brandCssFile);
  const files: string[] = [];
  walk(resolve(appsDir), 0, files);
  const findings: SecondBinderFinding[] = [];
  for (const file of files.sort()) {
    if (resolve(file) === brand) continue;
    const css = stripCommentsAndStrings(readFileSync(file, "utf8"), file);
    const slots = [...new Set([...css.matchAll(COLOR_DECLARATION_RE)].map((m) => m[1] as string))].sort();
    if (slots.length > 0) findings.push({ file, slots });
  }
  return findings;
}
