import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// GATES-RED G5: the selected components.menu / components.popover leaves are stock shadcn@aria
// (DropdownMenu, Popover). Neither takes a `trigger` prop and neither has Foundry static members
// (Menu.Item, Menu.Section, Menu.Separator), so such a call silently drops its trigger. Callers
// compose the declared parts (DropdownMenuTrigger/MenuItem/..., DialogTrigger + Popover) instead.
const SRC = join(import.meta.dirname, "..");
const ROOTS = ["blocks", "frames", "shell", "runtime", "studio"].map(dir => join(SRC, dir));
const LEAF = /const (\w+) = componentLeaf<[^;]*?>\("components\.(menu|popover)"\);/g;

function files(dir: string): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__fixtures__" ? [] : files(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

describe("stock menu and popover leaves", () => {
  it("are never given a trigger prop or a Foundry static member", () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap(files)) {
      const source = readFileSync(file, "utf8");
      for (const [, name, leaf] of source.matchAll(LEAF)) {
        if (new RegExp(`<${name}\\b[^>]*\\btrigger=`).test(source)) offenders.push(`${relative(SRC, file)}: <${name} trigger=> on components.${leaf}`);
        for (const [member] of source.matchAll(new RegExp(`\\b${name}\\.[A-Z]\\w*`, "g"))) offenders.push(`${relative(SRC, file)}: ${member} on components.${leaf}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
