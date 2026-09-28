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
});
