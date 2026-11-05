import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// GATES-RED G5: every selected-Button consumer passes only variants the components.button slot
// contract names; the dropped Foundry-only variants (tonal, quiet) throw "NEED component selection".
const packageRoot = resolve(import.meta.dirname, "../..");
const slot = JSON.parse(readFileSync(resolve(packageRoot, "../../clossys/agents/designer/components.button/slot.json"), "utf8")) as { contract: { members: { names: string[] } } };
const contracted = new Set(slot.contract.members.names.filter(name => name.startsWith("variant.")).map(name => name.slice("variant.".length)));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__fixtures__" ? [] : sources(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe("selected Button variants", () => {
  it("frames, shell and blocks pass only contracted components.button variants", () => {
    const offenders: string[] = [];
    for (const file of ["src/frames", "src/shell", "src/blocks"].flatMap(dir => sources(resolve(packageRoot, dir)))) {
      const text = readFileSync(file, "utf8");
      for (const leaf of text.matchAll(/const (\w+) = componentLeaf<[^>]*>\("components\.button"\);/g)) {
        for (const use of text.matchAll(new RegExp(`<${leaf[1]}\\b[^>]*?\\bvariant=(?:"([\\w-]+)"|\\{([^}]*)\\})`, "g"))) {
          const values = use[1] ? [use[1]] : [...use[2]!.matchAll(/"([\w-]+)"/g)].map(match => match[1]!);
          for (const value of values) if (!contracted.has(value)) offenders.push(`${relative(packageRoot, file)} ${value}`);
        }
      }
    }
    expect(contracted.size).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
