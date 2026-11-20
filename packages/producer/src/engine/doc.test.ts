import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CITATION, CITED_SECTIONS, ENGINE_DOC, EVENT_KINDS, citedIds, engineDoc } from "./doc.js";
import { ENGINE_SURFACE } from "./side-door.js";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const producer = join(repo, "packages", "producer");
const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  if (["node_modules", "dist", "__fixtures__", "generated"].includes(name)) return [];
  const path = join(dir, name);
  return statSync(path).isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|mjs|cjs|js)$/.test(name) ? [path] : [];
});

describe("docs/engine.md (engine/doc.ts)", () => {
  it("is the generated text of the engine's constants", () => {
    expect(readFileSync(join(repo, ENGINE_DOC), "utf8")).toBe(engineDoc());
  });

  it("resolves every spec citation in the Producer source to a section it holds", () => {
    const known = new Set(CITED_SECTIONS.map(row => `${row.doc} ${row.id}`));
    const missing: string[] = [];
    let citations = 0;
    for (const file of [...sourceFiles(join(producer, "src")), ...sourceFiles(join(producer, "scripts"))]) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(CITATION)) {
        for (const id of citedIds(match[2]!)) {
          citations++;
          if (!known.has(`${match[1]} ${id}`)) missing.push(`${relative(repo, file).split(sep).join("/")}: ${match[1]} ${id}`);
        }
      }
    }
    expect(citations).toBeGreaterThan(100);
    expect([...new Set(missing)]).toEqual([]);
  });

  it("names only paths that exist: section homes, writer files and the engine surface", () => {
    for (const row of CITED_SECTIONS) expect(existsSync(join(repo, row.home)), `${row.doc} ${row.id}: ${row.home}`).toBe(true);
    for (const row of ENGINE_SURFACE) expect(existsSync(join(repo, row.file)), row.file).toBe(true);
    for (const row of EVENT_KINDS) expect(readFileSync(join(repo, row.file), "utf8"), `${row.kind} in ${row.file}`).toContain(row.literal);
  });

  it("reads citation ids, ranges and steps", () => {
    const ids = (text: string) => [...text.matchAll(CITATION)].map(match => [match[1], citedIds(match[2]!)]);
    expect(ids("(system.md 14.4 step 6)")).toEqual([["system", ["14.4"]]]);
    expect(ids("system.md 4, 6.5, 12; designer.md 9.8")).toEqual([["system", ["4", "6.5", "12"]]]);
    expect(ids("flows.md F8 step 2, N13 and producer.md 2-3")).toEqual([["flows", ["F8", "N13"]], ["producer", ["2", "3"]]]);
  });
});
