/**
 * Target record formats (system.md 4, 6, 12; designer.md 9.8): the JSON Schemas in
 * packages/producer/schemas/ against the Tallyhouse fixture (system.md 14.7) and the
 * hand-written types in ./types.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRecordHeader, validateAgainst, type JsonSchema } from "./schema.js";
import { RECORD_KEYS } from "./types.js";

const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));
const SCHEMAS = join(PACKAGE, "schemas");
const FIXTURE = join(PACKAGE, "test-fixtures", "tallyhouse");

const FORMATS = [
  "clossys.slot/2", "clossys.candidate/1", "clossys.pin/2", "clossys.pin-map/1", "clossys.check-result/1",
  "clossys.queue-entry/1", "clossys.ledger-entry/1", "clossys.view/1", "clossys.status/1", "clossys.slot-view/1",
  "clossys.render/1", "clossys.preview/1", "clossys.theme/1", "clossys.ia/1",
  // Also needed by the literal files: facts.json (writer.md 9.4) and loop candidate content (producer.md 10.2).
  "clossys.facts/1", "clossys.loop-version/1",
] as const;

/** Every literal file of the spec set, at the path the spec gives (system.md 2.2, 3; package files under packages/). */
const LITERAL_FILES = [
  ".clossys/checks/designer/sections.hero/hero-v2.json.json",
  ".clossys/checks/designer/themes.primary/primary-v2.json.json",
  ".clossys/checks/director/execution.roadmap.release/release-v1.md.json",
  ".clossys/checks/director/identity.naming.name/name-v1.md.json",
  ".clossys/checks/writer/sections.hero.copy/home.hero-v3.json.json",
  "clossys/agents/designer/assets.lockup/candidates/lockup-v1.svg",
  "clossys/agents/designer/sections.hero/candidates/hero-v2.json",
  "clossys/agents/designer/sections.hero/pin.json",
  "clossys/agents/designer/sections.hero/slot.json",
  "clossys/agents/designer/themes.primary/candidates/primary-v2.json",
  "clossys/agents/designer/themes.primary/slot.json",
  "clossys/agents/director/capability.team.structure/slot.json",
  "clossys/agents/director/execution.roadmap.release/candidates/release-v1.md",
  "clossys/agents/director/execution.roadmap.release/pin.json",
  "clossys/agents/director/execution.roadmap.release/slot.json",
  "clossys/agents/director/identity.naming.name/candidates/name-v1.md",
  "clossys/agents/director/identity.naming.name/pin.json",
  "clossys/agents/director/identity.naming.name/slot.json",
  "clossys/agents/producer/ledger.refine/entries/20261118T0915Z-refine-home-hero.json",
  "clossys/agents/producer/ledger.release/entries/20261118T1120Z-release-site.json",
  "clossys/agents/producer/loop.refine/candidates/refine-v2.json",
  "clossys/agents/producer/queue.approve/entries/20261118T1004Z-home-hero-copy.json",
  "clossys/agents/producer/queue.approve/entries/20261118T1131Z-release-site.json",
  "clossys/agents/producer/queue.fix/entries/20261118T0912Z-home-hero-copy.json",
  "clossys/agents/publisher/ia.json",
  "clossys/agents/publisher/layout.marketing-home/candidates/proof-first-v1.json",
  "clossys/agents/publisher/layout.marketing-home/slot.json",
  "clossys/agents/publisher/page.home/candidates/home-v2.json",
  "clossys/agents/publisher/release.site/candidates/site-v3.json",
  "clossys/agents/publisher/release.site/pin.json",
  "clossys/agents/writer/lexicon.sentence-length/candidates/sentence-length-v2.json",
  "clossys/agents/writer/lexicon.sentence-length/slot.json",
  "clossys/agents/writer/narratives.legal-document/candidates/privacy-v2.md",
  "clossys/agents/writer/sections.hero.copy/candidates/home.hero-v3.json",
  "clossys/agents/writer/sections.hero.copy/pin.json",
  "clossys/agents/writer/sections.hero.copy/slot.json",
  "clossys/facts.json",
  "packages/designer/views/slot-compare.md",
  "packages/producer/src/loops/loop.release/release-v1.json",
  "packages/producer/views/queue-inbox.md",
  "packages/publisher/src/catalog/defaults/chrome.site-header/header-v1.json",
] as const;

function loadSchemas(): Map<string, JsonSchema> {
  const byId = new Map<string, JsonSchema>();
  for (const name of readdirSync(SCHEMAS).filter((file) => file.endsWith(".json")).sort()) {
    const schema = JSON.parse(readFileSync(join(SCHEMAS, name), "utf8")) as JsonSchema;
    if (!schema.$id) throw new Error(`${name} has no $id`);
    if (byId.has(schema.$id)) throw new Error(`duplicate $id ${schema.$id}`);
    byId.set(schema.$id, schema);
  }
  return byId;
}

function walk(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

type Fixture = { file: string; text: string; header: Record<string, unknown> };
function fixtures(): Fixture[] {
  return walk(FIXTURE).map((full) => {
    const file = relative(FIXTURE, full).split(sep).join("/");
    const text = readFileSync(full, "utf8");
    return { file, text, header: readRecordHeader(file, text) as Record<string, unknown> };
  });
}

/** Loop candidates carry their LoopVersion under `content` (producer.md 10.4). */
function loopContent(fixture: Fixture): unknown {
  const slot = fixture.header.slot;
  if (typeof slot !== "string" || !slot.startsWith("producer/loop.")) return undefined;
  return (JSON.parse(fixture.text) as { content?: unknown }).content;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const schemas = loadSchemas();
const all = fixtures();

/** Read models have no committed file; these are the spec examples (system.md 12.2-12.5, designer.md 9.8), `…` filled in. */
const READ_SAMPLES: Record<string, Record<string, unknown>> = {
  "clossys.status/1": {
    schema: "clossys.status/1", at: "2026-11-18T10:05:00Z", workspace: "tallyhouse",
    agents: {
      director: { slots: 24, byState: { pinned: 24, confirm: 0, sample: 0, unresolved: 0, failing: 0, needsRefresh: 0 } },
      designer: { slots: 96, byState: { pinned: 31, confirm: 0, sample: 65, unresolved: 0, failing: 0, needsRefresh: 0 } },
      writer: { slots: 46, records: 74, byState: { pinned: 73, confirm: 1, sample: 0, unresolved: 0, failing: 0, needsRefresh: 0 } },
      publisher: { slots: 20, byState: { pinned: 14, confirm: 0, sample: 6, unresolved: 0, failing: 0, needsRefresh: 0 } },
      producer: { slots: 4, byState: { pinned: 1, confirm: 0, sample: 3, unresolved: 0, failing: 0, needsRefresh: 0 } },
    },
    queue: [{ id: "20261118T1004Z-home-hero-copy", queue: "queue.approve", decider: "owner", subject: "writer/sections.hero.copy#home.hero",
      ask: "Confirm the new home hero copy (v3) picked by Writer", default: "keep home.hero-v2.json", raisedAt: "2026-11-18T10:04:12Z" }],
    ledger: [{ id: "20261116T1240Z-fill-hero", loop: "loop.fill", status: "done", outcome: "designer/sections.hero pinned hero-v2.json", at: "2026-11-16T13:02:40Z" }],
    releases: [{ publication: "site", pinned: "site-v2.json", stale: true, reason: "writer/sections.hero.copy#home.hero changed after site-v2" }],
  },
  "clossys.slot-view/1": {
    schema: "clossys.slot-view/1", ref: "writer/sections.hero.copy#home.hero",
    slot: { id: "sections.hero.copy", agent: "writer", kind: "copy", status: "live",
      ia: { l0: "copy", l1: "copy/section-copy", l2: "copy/section-copy/story" },
      brief: { purpose: "Words for each hero placed on a page.", mustDo: [], inputs: [], acceptance: [{ check: "copy.required" }] },
      briefSha256: "3c1fd2aaac5a520c46b0cc9c4c04b4260662a49b817a435a004e8fcf4d8a2b7d", tightenCount: 1, contract: { unit: "designer/sections.hero" } },
    candidates: [{ name: "home.hero-v3.json", record: "home.hero", sha256: "9ac6a62e571641d7071bae79ca067f995dbc00d8296f54d77bb7c8611a7bac48",
      createdBy: { actor: "agent", agent: "writer", skill: "packages/writer/actions/writer.candidates/skill.md",
        skillSha256: "1fd773f9039d79a0d6fda2cd1498a7aa84a28fd52b9fa0ff7090d0e4f3c6cb87", model: "claude-opus-5-5", tier: "mid" },
      createdAt: "2026-11-18T09:48:20Z", briefCurrent: true, check: { status: "pass", failed: [] },
      rationale: [{ purpose: "orient", field: "header.heading", why: "States the promise itself." }], renders: [] }],
    pin: [{ record: "home.hero", candidate: "home.hero-v3.json", sha256: "9ac6a62e571641d7071bae79ca067f995dbc00d8296f54d77bb7c8611a7bac48",
      decidedBy: "agent:writer", basis: "agent", at: "2026-11-18T10:04:12Z", state: "confirm" }],
    consumedBy: ["publisher/page.home"], queue: ["20261118T1004Z-home-hero-copy"], ledger: ["20261116T1420Z-fill-copy"],
  },
  "clossys.render/1": {
    schema: "clossys.render/1", ref: "writer/sections.hero.copy/home.hero-v3.json", compare: "writer/sections.hero.copy/home.hero-v2.json",
    inputsSha256: "7d0e2c41aa000000000000000000000000000000000000000000000000000000", renderedAt: "2026-11-18T10:05:20Z",
    by: { actor: "code", cli: "clossys render", version: "1.0.0" },
    specimens: [{ candidate: "home.hero-v3.json", specimen: "copy-in-context", locale: "en", width: 1280,
      png: ".clossys/renders/compare/home.hero-v3--home.hero-v2/home.hero-v3-en-1280.png" }],
  },
  "clossys.preview/1": {
    schema: "clossys.preview/1", publication: "site", buildId: "preview-4be1f07a93c2", url: "http://localhost:4600/",
    routes: [{ path: "/", page: "home", locales: ["en", "fr"] }],
    overrides: [{ ref: "writer/sections.hero.copy/home.hero-v3.json", sha256: "9ac6a62e571641d7071bae79ca067f995dbc00d8296f54d77bb7c8611a7bac48" }],
    sample: [],
  },
  "clossys.theme/1": {
    schema: "clossys.theme/1",
    vars: { light: { "--primary": "oklch(0.45 0.09 160)" }, dark: { "--primary": "oklch(0.78 0.11 160)" } },
    sources: { "--primary": { slot: "designer/themes.primary", candidate: "primary-v2.json", sha256: "b27b9711f060855c30347291e6df43fa04ec9fa87bf8c17818f694ae462fac52", sample: false } },
    inputsSha256: "7d0e2c41aa000000000000000000000000000000000000000000000000000000",
  },
};

describe("record schemas", () => {
  it("ships one schema per format, each inside the validator's keyword subset", () => {
    expect([...schemas.keys()].sort()).toEqual([...FORMATS].sort());
    for (const schema of schemas.values()) expect(() => validateAgainst(schema, {})).not.toThrow();
  });

  it("keeps every shared $defs entry identical across schema files", () => {
    const seen = new Map<string, string>();
    for (const [id, schema] of schemas) {
      for (const [name, def] of Object.entries(schema.$defs ?? {})) {
        const text = JSON.stringify(def);
        if (seen.has(name)) expect({ id, name, def: text }).toEqual({ id, name, def: seen.get(name) });
        else seen.set(name, text);
      }
    }
  });
});

describe("Tallyhouse fixture", () => {
  it("holds every literal file of the spec set, and nothing else", () => {
    expect(all.map((fixture) => fixture.file)).toEqual([...LITERAL_FILES].sort());
  });

  it.each(LITERAL_FILES.map((file) => [file]))("%s validates against the schema named in its schema field", (file) => {
    const fixture = all.find((item) => item.file === file)!;
    const id = fixture.header.schema as string;
    const schema = schemas.get(id);
    expect(schema, `no schema for ${id}`).toBeDefined();
    expect(validateAgainst(schema!, fixture.header)).toEqual([]);
    const content = loopContent(fixture);
    if (content !== undefined) expect(validateAgainst(schemas.get("clossys.loop-version/1")!, content)).toEqual([]);
  });

  it("covers every committed format with at least one fixture file", () => {
    const covered = new Set(all.map((fixture) => fixture.header.schema));
    for (const id of FORMATS.filter((format) => !(format in READ_SAMPLES) && format !== "clossys.loop-version/1")) {
      expect(covered.has(id), id).toBe(true);
    }
    expect(all.some((fixture) => loopContent(fixture) !== undefined)).toBe(true);
  });

  it.each(Object.keys(READ_SAMPLES).map((id) => [id]))("%s spec example validates", (id) => {
    expect(validateAgainst(schemas.get(id)!, READ_SAMPLES[id])).toEqual([]);
  });
});

/** One valid record per schema id, for the mutation cases. */
function samples(): [string, Record<string, unknown>][] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const fixture of all) {
    const id = fixture.header.schema as string;
    if (!byId.has(id)) byId.set(id, fixture.header);
    const content = loopContent(fixture);
    if (content !== undefined && !byId.has("clossys.loop-version/1")) byId.set("clossys.loop-version/1", content as Record<string, unknown>);
  }
  for (const [id, sample] of Object.entries(READ_SAMPLES)) byId.set(id, sample);
  return [...byId.entries()].sort(([a], [b]) => a.localeCompare(b));
}

describe("mutations die", () => {
  it("has a valid sample for every schema", () => {
    expect(samples().map(([id]) => id)).toEqual([...FORMATS].sort());
  });

  it.each(samples())("%s: dropping any required field fails", (id, sample) => {
    const schema = schemas.get(id)!;
    expect(schema.required?.length ?? 0).toBeGreaterThan(0);
    for (const field of schema.required ?? []) {
      const broken = clone(sample);
      delete broken[field];
      expect(validateAgainst(schema, broken), `without ${field}`).not.toEqual([]);
    }
  });

  it.each(samples())("%s: an unknown top-level field fails", (id, sample) => {
    expect(validateAgainst(schemas.get(id)!, { ...clone(sample), unknownField: true })).not.toEqual([]);
  });

  it.each(samples().filter(([, sample]) => "schema" in sample))("%s: a wrong schema string fails", (id, sample) => {
    const schema = schemas.get(id)!;
    for (const wrong of [id.replace(/\/\d+$/, "/9"), "clossys.slot/1", "clossys.other/1"]) {
      if (wrong === id) continue;
      expect(validateAgainst(schema, { ...clone(sample), schema: wrong }), wrong).not.toEqual([]);
    }
  });

  it("a pin/2 or pin-map/1 record without its candidate sha256 fails", () => {
    const pin = clone(all.find((fixture) => fixture.header.schema === "clossys.pin/2")!.header);
    delete pin.sha256;
    expect(validateAgainst(schemas.get("clossys.pin/2")!, pin)).toContainEqual({ path: "$.sha256", message: "is required" });

    const map = clone(all.find((fixture) => fixture.header.schema === "clossys.pin-map/1")!.header) as { records: Record<string, Record<string, unknown>> };
    delete map.records["home.hero"]!.sha256;
    expect(validateAgainst(schemas.get("clossys.pin-map/1")!, map)).toContainEqual({ path: "$.records.home.hero.sha256", message: "is required" });
  });

  it("a candidate header with a bad actor, ref or id fails", () => {
    const schema = schemas.get("clossys.candidate/1")!;
    const header = all.find((fixture) => fixture.file.endsWith("name-v1.md"))!.header;
    const cases: [string, (h: Record<string, unknown>) => void][] = [
      ["actor", (h) => { (h.createdBy as Record<string, unknown>).actor = "robot"; }],
      ["agent actor without skillSha256", (h) => { delete (h.createdBy as Record<string, unknown>).skillSha256; }],
      ["ref rel", (h) => { ((h.refs as Record<string, unknown>[])[0]!).rel = "likes"; }],
      ["ref to", (h) => { ((h.refs as Record<string, unknown>[])[0]!).to = "director:identity.brand.essence"; }],
      ["id", (h) => { h.id = "director/identity.naming.name/name.md"; }],
      ["createdAt", (h) => { h.createdAt = "2026-11-16 09:24"; }],
    ];
    for (const [name, mutate] of cases) {
      const broken = clone(header);
      mutate(broken);
      expect(validateAgainst(schema, broken), name).not.toEqual([]);
    }
  });
});

describe("types match schemas", () => {
  it("declares a key list for every schema", () => {
    expect(Object.keys(RECORD_KEYS).sort()).toEqual([...FORMATS].sort());
  });

  it.each(Object.entries(RECORD_KEYS))("%s: the type's keys equal the schema's properties", (id, keys) => {
    const properties = Object.keys(schemas.get(id)?.properties ?? {});
    expect([...keys].sort()).toEqual(properties.sort());
  });
});

describe("readRecordHeader", () => {
  it("reads the clossys header from JSON, Markdown front matter and SVG metadata", () => {
    expect(readRecordHeader("a/slot.json", '{"schema":"clossys.slot/2","id":"x.y"}')).toEqual({ schema: "clossys.slot/2", id: "x.y" });
    expect(readRecordHeader("a/x-v1.json", '{"name":"n","clossys":{"schema":"clossys.candidate/1"}}')).toEqual({ schema: "clossys.candidate/1" });
    expect(readRecordHeader("a/x-v1.svg", '<svg><metadata>{"clossys":{"schema":"clossys.candidate/1"}}</metadata></svg>')).toEqual({ schema: "clossys.candidate/1" });
    const md = [
      "---", "clossys:", "  schema: clossys.view/1", "  createdBy: { actor: package, package: \"@clossys/designer\", version: \"1.0.0\" }",
      "  count: 3", "  flag: true", "  list: [a, b.c]", "  rows:", "    - { to: facts, key: retention.years, rel: cites }",
      "    - purpose: name", "      why: Plain words, with a comma.", "      sources: []", "  inputs:", "    - clossys slot <ref> --json",
      "  at: 2026-11-16T09:24:10Z  # a comment", "  skill: packages/writer/skill/SKILL.md#refine-brief", "---", "", "# Body", "",
    ].join("\n");
    expect(readRecordHeader("a/view.md", md)).toEqual({
      schema: "clossys.view/1",
      createdBy: { actor: "package", package: "@clossys/designer", version: "1.0.0" },
      count: 3, flag: true, list: ["a", "b.c"],
      rows: [{ to: "facts", key: "retention.years", rel: "cites" }, { purpose: "name", why: "Plain words, with a comma.", sources: [] }],
      inputs: ["clossys slot <ref> --json"],
      at: "2026-11-16T09:24:10Z",
      skill: "packages/writer/skill/SKILL.md#refine-brief",
    });
  });

  it("refuses a file with no header", () => {
    expect(() => readRecordHeader("a/x.json", '{"name":"n"}')).toThrow(/no clossys header/);
    expect(() => readRecordHeader("a/x.md", "# no front matter\n")).toThrow(/front matter/);
    expect(() => readRecordHeader("a/x.svg", "<svg></svg>")).toThrow(/metadata/);
    expect(() => readRecordHeader("a/x.txt", "")).toThrow(/unsupported/);
  });
});
