import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { serializeFrontmatter, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { readWriter } from "./site-source.js";

let root: string, writer: string, dir: string;
const id = "strings.example";
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const binding = { cellId: "example.title", target: "sections.hero", kind: "CopyRef", extra: [2, 1] };
const section = { sectionId: "sections.hero", configId: "ground.base", passageAlias: "ps.example.hero", fields: [{ key: "header.heading", locale: "en", source: "writer", ref: { id: "title-1", extra: true } }], note: "retained" };
const declarations = (locales: unknown = { en: { aliases: { "example.title": "title-1" }, sections: [section], note: [2, 1] } }) => save(join(writer, "declarations.json"), { schema: "clossys.writer-declarations/1", locales, note: { fixture: true } });
function pin(body: string, locales = ["en"]) {
  const bytes = serializeFrontmatter({ slot: id, source: { kind: "original", ref: [] }, locales }, body);
  writeFileSync(join(dir, "candidates", "example-v1.md"), bytes);
  save(join(dir, "pin.json"), { candidate: "example-v1.md", sha256: sha256Hex(bytes), pinnedBy: "migration:SLOT-MODEL", at: "2026-10-31T00:00:00Z" });
}
const body = () => `## en\n### example.title\n<!-- ${JSON.stringify({ id: "title-1", bindings: ["opaque.path", binding], limits: { maxChars: 60 } })} -->\nNative title\n\\## literal heading\n\\<!-- literal comment -->\n\\\\literal slash\n\n### example.data\n<!-- {"id":"data-1","bindings":[],"custom":{"a":1}} -->\n\u0060\u0060\u0060json\n{"id":"data-1","context":"example.data","value":[1,2]}\n\u0060\u0060\u0060\n\n`;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "native-writer-reader-")));
  writer = join(root, "clossys", "agents", "writer");
  dir = join(writer, id);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "examples", label: "Examples", children: [{ id: "group", label: "Group", slots: [id] }] }] };
  save(join(writer, "ia.json"), ia);
  save(join(dir, "slot.json"), { schema: "clossys.slot/1", id, agent: "writer", kind: "strings", ia: slotPositions("writer", ia).get(id), contract: {}, inputs: [], uses: [] });
  mkdirSync(join(writer, "compiled", "en"), { recursive: true });
  save(join(writer, "compiled", "en", "copy.json"), { aliases: { "example.title": "legacy" }, records: [{ id: "legacy", context: "example.title", text: "Contradictory legacy" }] });
  declarations();
  pin(body());
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("native Writer source", () => {
  it("selects intact native pins over compiled legacy and newer drafts, preserving rows and explicit declarations", async () => {
    writeFileSync(join(dir, "candidates", "example-v2.md"), "invalid newer draft");
    const result = await readWriter(root);
    expect(result.locale).toBe("en");
    expect(result.aliases).toEqual({ "example.title": "title-1" });
    expect(result.sections).toEqual([section]);
    expect(result.records).toEqual([{ id: "title-1", context: "example.title", limits: { maxChars: 60 }, text: "Native title\n## literal heading\n<!-- literal comment -->\n\\literal slash" }]);
    expect(result.native!.rows[0]!.bindings).toEqual(["opaque.path", binding]);
    expect(result.native!.rows[1]!.record).toEqual({ id: "data-1", context: "example.data", custom: { a: 1 }, value: [1, 2] });
    expect(result.native!.declarations).toEqual(load(join(writer, "declarations.json")));
    expect(result).toHaveProperty("note", [2, 1]);
  });

  it("returns honest empty copy only with explicit empty declarations and no pin", async () => {
    rmSync(join(dir, "pin.json"));
    declarations({ en: { aliases: {}, sections: [] } });
    expect(await readWriter(root)).toMatchObject({ locale: "en", aliases: {}, sections: [], records: [], native: { rows: [] } });
  });

  it.each([
    ["invalid pin", () => writeFileSync(join(dir, "pin.json"), "{"), /Invalid Writer pin/],
    ["missing candidate", () => rmSync(join(dir, "candidates", "example-v1.md")), /ENOENT/],
    ["hash drift", () => writeFileSync(join(dir, "candidates", "example-v1.md"), "changed"), /hash mismatch/],
    ["invalid slot", () => save(join(dir, "slot.json"), { ...load(join(dir, "slot.json")), ia: { l1: "wrong", l2: "group", order: 0 } }), /Invalid Writer slot/],
    ["invalid IA", () => save(join(writer, "ia.json"), {}), /Invalid writer IA/],
    ["malformed declarations", () => writeFileSync(join(writer, "declarations.json"), "{"), /Invalid declarations JSON/],
    ["missing aliases", () => declarations({ en: { sections: [] } }), /explicit aliases/],
    ["missing sections", () => declarations({ en: { aliases: {} } }), /explicit aliases/],
    ["wrong locale", () => declarations({ fr: { aliases: {}, sections: [] } }), /Missing authored locale/],
    ["missing alias target", () => declarations({ en: { aliases: { title: "absent" }, sections: [] } }), /Missing record absent/],
    ["missing section target", () => declarations({ en: { aliases: {}, sections: [{ ...section, fields: [{ key: "title", ref: { id: "absent" } }] }] } }), /Missing record absent/],
    ["wrong field locale", () => declarations({ en: { aliases: {}, sections: [{ ...section, fields: [{ key: "title", locale: "fr", ref: { id: "title-1" } }] }] } }), /Field locale/],
    ["incomplete unpinned rows", () => rmSync(join(dir, "pin.json")), /Missing record title-1/],
    ["invalid envelope with matching hash", () => pin(body().replace("## en", "## fr")), /Invalid Writer candidate/],
    ["invalid body with matching hash", () => pin(body().replace("title-1", "")), /record metadata/],
  ] as const)("rejects %s without legacy fallback", async (_name, mutate, error) => {
    mutate();
    await expect(readWriter(root)).rejects.toThrow(error);
  });

  it("rejects declaration and candidate symlinks", async () => {
    const path = join(writer, "declarations.json"), outside = join(root, "declarations.json");
    writeFileSync(outside, readFileSync(path)); rmSync(path); symlinkSync(outside, path);
    await expect(readWriter(root)).rejects.toThrow(/regular Writer declarations/);
    rmSync(path); writeFileSync(path, readFileSync(outside));
    const candidate = join(dir, "candidates", "example-v1.md"), copy = join(root, "candidate.md");
    writeFileSync(copy, readFileSync(candidate)); rmSync(candidate); symlinkSync(copy, candidate);
    await expect(readWriter(root)).rejects.toThrow(/Symbolic links/);
  });

  it.each([["fr", "en", "en"], ["fr", "ar", "ar"]])("selects en first, otherwise lexical locale (%s, %s)", async (first, second, expected) => {
    pin([first, second].map(locale => `## ${locale}\n### same.context\n<!-- {"id":"title-1","bindings":[]} -->\n${locale}\n\n`).join(""), [first, second]);
    declarations(Object.fromEntries([first, second].map(locale => [locale, { aliases: { title: "title-1" }, sections: [] }])));
    expect(await readWriter(root)).toMatchObject({ locale: expected, records: [{ id: "title-1", text: expected }] });
  });

  it("retains an explicitly selected empty en locale ahead of populated fr", async () => {
    pin('## en\n\n## fr\n### example.title\n<!-- {"id":"title-1","bindings":[]} -->\nFrench\n\n', ["en", "fr"]);
    declarations({ en: { aliases: {}, sections: [] }, fr: { aliases: { title: "title-1" }, sections: [] } });
    expect(await readWriter(root)).toMatchObject({ locale: "en", aliases: {}, sections: [], records: [] });
  });

  it("does not use Writer legacy when another agent has introduced IA", async () => {
    mkdirSync(join(root, "clossys", "agents", "director"), { recursive: true });
    writeFileSync(join(root, "clossys", "agents", "director", "ia.json"), "{}");
    rmSync(join(writer, "ia.json"));
    await expect(readWriter(root)).rejects.toThrow(/Writer native IA is missing/);
  });

  it("refuses a Writer without IA and never reads compiled legacy", async () => {
    rmSync(join(writer, "ia.json"));
    rmSync(join(writer, "declarations.json"));
    await expect(readWriter(root)).rejects.toThrow(/Writer native IA is missing/);
  });

  it("reads the pinned rows, not compiled legacy, when no declarations are authored", async () => {
    rmSync(join(writer, "declarations.json"));
    const result = await readWriter(root);
    expect(result).toMatchObject({ locale: "en", aliases: {}, sections: [] });
    expect(result.records.map(record => record.id)).toEqual(["title-1"]);
    expect(JSON.stringify(result)).not.toContain("Contradictory legacy");
  });
});
