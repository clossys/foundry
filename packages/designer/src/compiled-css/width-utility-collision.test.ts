import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Named spacing tokens (`--spacing-sm`, `--spacing-md`, ...) generate
 * utilities in every spacing-driven family, so `max-w-md` compiles to
 * `max-width: var(--spacing-md, 12px)` (a 12px-wide column), not Tailwind's
 * usual 28rem. `w-*`, `h-*` and `size-*` capture the same names on purpose;
 * for `max-w-*` and `min-w-*` it is always a mistake, so spell those widths
 * as explicit arbitrary values (for example `max-w-[28rem]`).
 */
const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = join(packageDir, "src");

function spacingNames(): string[] {
  const tokens = readFileSync(join(packageDir, "styles", "tokens.css"), "utf8");
  const names = new Set<string>();
  for (const match of tokens.matchAll(/--spacing-([a-z0-9]+):/g)) names.add(match[1] as string);
  return [...names];
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
    else if (entry.endsWith(".tsx") && !/\.test\.tsx$/.test(entry)) files.push(full);
  }
  return files;
}

describe("width utilities vs named spacing tokens", () => {
  const names = spacingNames();

  it("reads the named spacing tokens from tokens.css", () => {
    expect(names).toEqual(expect.arrayContaining(["sm", "md", "lg", "2xl"]));
  });

  it("no source file uses max-w-* or min-w-* with a spacing token name", () => {
    const pattern = new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:max|min)-w-(?:${names.join("|")})(?![\\w-])`, "g");
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(pattern)) {
        offenders.push(`${file.slice(srcDir.length + 1)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
