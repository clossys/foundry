import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findSecondBinders } from "./find-second-binders.js";

let dir: string;

function write(rel: string, content: string): string {
  const path = join(dir, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "designer-second-binders-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("findSecondBinders", () => {
  it("reports an application stylesheet that binds a --color-* slot", () => {
    const brand = write("brand/brand.css", ":root[data-brand-bound] { --color-accent: #2a78d6; }");
    const second = write("apps/web/globals.css", ":root { --color-accent: #000; --color-ink: #111; }");
    write("apps/admin/globals.css", '@import "../../brand/designer.css";\n.x { color: var(--color-accent); }');
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([{ file: second, slots: ["--color-accent", "--color-ink"] }]);
  });

  it("ignores comments, build output and the brand file itself", () => {
    const brand = write("apps/brand.css", ":root { --color-accent: #2a78d6; }");
    write("apps/web/a.css", "/* --color-accent: red; */ .x { margin: 0; }");
    write("apps/web/.next/b.css", ":root { --color-accent: red; }");
    write("apps/web/node_modules/p/c.css", ":root { --color-accent: red; }");
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([]);
  });

  it("reports the --color-* wildcard reset", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    const second = write("apps/web/globals.css", "@theme { --color-*: initial; }");
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([{ file: second, slots: ["--color-*"] }]);
  });

  it("scans .scss and .pcss stylesheets", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    const scss = write("apps/web/a.scss", ".x { --color-accent: red; }");
    const pcss = write("apps/web/b.pcss", ".x { --color-ink: red; }");
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([
      { file: scss, slots: ["--color-accent"] },
      { file: pcss, slots: ["--color-ink"] },
    ]);
  });

  it("reports a --color-* declaration inside @apply", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    const second = write("apps/web/a.css", ".x { @apply [--color-accent:red] p-4; }");
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([{ file: second, slots: ["--color-accent"] }]);
  });

  it("ignores --color-* text inside quoted strings", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    write("apps/web/a.css", '.x::before { content: "--color-accent: red"; }\n.y::after { content: \'a; --color-ink: red\'; }');
    write("apps/web/b.css", '/* it\'s a comment */ .x::before { content: "/*"; }\n.z { margin: 0; }');
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([]);
  });

  it("still reports a binding that follows a string or an apostrophe in a comment", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    const second = write("apps/web/a.css", '/* it\'s */ .x::before { content: "a"; }\n:root { --color-ink: red; }');
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([{ file: second, slots: ["--color-ink"] }]);
  });

  it("does not flag var(--color-*) reads", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    write("apps/web/a.css", ".x { color: var(--color-accent); border-color: var(--color-line, red); background: var(--color-*, blue); }");
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([]);
  });

  it("skips top-level build, dist and node_modules but not a nested folder with those names", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    write("apps/build/a.css", ":root { --color-accent: red; }");
    write("apps/dist/a.css", ":root { --color-accent: red; }");
    write("apps/node_modules/p/a.css", ":root { --color-accent: red; }");
    write("apps/web/dist/a.css", ":root { --color-accent: red; }");
    write("apps/web/node_modules/p/a.css", ":root { --color-accent: red; }");
    const nestedBuild = write("apps/web/src/build/theme.css", ":root { --color-accent: red; }");
    const nestedDist = write("apps/web/src/dist/theme.css", ":root { --color-accent: red; }");
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([
      { file: nestedBuild, slots: ["--color-accent"] },
      { file: nestedDist, slots: ["--color-accent"] },
    ]);
  });

  it("ignores // line comments in .scss and .pcss", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    write("apps/web/a.scss", "// --color-accent: red;\n.x { background: url(https://example.test/a.png); margin: 0; }");
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([]);
  });

  it("reports wildcard resets of a colour family, SCSS interpolation and uppercase names", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    const family = write("apps/web/a.css", "@theme { --color-red-*: initial; }");
    const interpolated = write("apps/web/b.scss", "@each $k in $keys { :root { --color-#{$k}: red; } }");
    const upper = write("apps/web/c.css", ":root { --COLOR-Accent: red; --Color-Ink: blue; }");
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([
      { file: family, slots: ["--color-red-*"] },
      { file: interpolated, slots: ["--color-#{$k}"] },
      { file: upper, slots: ["--COLOR-Accent", "--Color-Ink"] },
    ]);
  });

  it("scans .sass, .less and .postcss stylesheets", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    const sass = write("apps/web/a.sass", ":root\n  --color-accent: red\n");
    const less = write("apps/web/b.less", ".x { --color-ink: red; }");
    const postcss = write("apps/web/c.postcss", ".x { --color-line: red; }");
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([
      { file: sass, slots: ["--color-accent"] },
      { file: less, slots: ["--color-ink"] },
      { file: postcss, slots: ["--color-line"] },
    ]);
  });

  it("does not flag a --color-* feature query inside @container style()", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    write("apps/web/a.css", "@container style( --color-a: red) { .x { margin: 0; } }\n@container style(--color-b: red) { .y { margin: 0; } }");
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([]);
  });

  it("ignores a quoted string continued across lines with a backslash", () => {
    const brand = write("brand/brand.css", ":root { --color-accent: #2a78d6; }");
    write("apps/web/a.css", '.x::before { content: "line one \\\n --color-accent: red"; }');
    expect(findSecondBinders(join(dir, "apps"), brand)).toEqual([]);
  });
});
