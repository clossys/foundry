import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRelease,
  deriveSlotStatus,
  ELEMENT_SCHEMA,
  emptySelection,
  latestRelease,
  listVersions,
  pin,
  pinsAt,
  readElementVersion,
  restore,
  SLOT_CONTRACT_SCHEMA,
  unpin,
  validateElement,
  validatePreview,
  validateRelease,
  validateSelection,
  validateSlotContract,
  verifyElementVersion,
  workspaceSlotStatus,
  writeElementVersion,
  writeRelease,
  writeSelection,
  type ElementRecord,
  type Hash,
  type NewElementVersion,
  type PreviewRecord,
  type ReferenceRef,
} from "./index.js";

const H = (c: string): Hash => `sha256:${c.repeat(64)}`;
const AT = (minute: number) => `2026-10-30T10:${String(minute).padStart(2, "0")}:00Z`;

const preview: PreviewRecord = {
  schema: "clossys.preview/1",
  fixtures: { links: { primary: "#" } },
  copy: { "home.hero.header.heading": "Sample heading" },
  container: "section-in-frame",
  theme: "light",
  width: 1280,
};

const source: ReferenceRef = { registry: "tailark-oss", item: "mist-hero-section-1", version: "8139698", hash: H("a") };

function elementBase(overrides: Partial<NewElementVersion["element"]> = {}): NewElementVersion["element"] {
  return {
    schema: "clossys.element/1",
    id: "hero",
    package: "designer",
    layer: "sections",
    slot: "sections.hero",
    kind: "registry:block",
    lineage: { mode: "customized", source },
    license: { spdx: "MIT", attribution: "upstream authors" },
    creator: { agent: "designer", model: "example-model" },
    reason: "copy slots bound to the slot contract",
    createdAt: AT(0),
    checks: [{ id: "theme-vars-only", type: "fixed", status: "pass" }],
    deps: { npm: { "lucide-react": "^1.65.0" }, elements: [] },
    reads: { copyKeys: ["home.hero.header.heading"], themeVars: ["--primary", "--background"] },
    ...overrides,
  };
}

function fullElement(): ElementRecord {
  return { ...elementBase(), version: 1, hash: H("b") };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "producer-records-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("element.json schema", () => {
  it("accepts a complete record", () => {
    expect(validateElement(fullElement())).toEqual({ ok: true, value: fullElement() });
  });

  it("rejects a record missing any required field (mutation, one field at a time)", () => {
    for (const field of ELEMENT_SCHEMA.required!) {
      const record: Record<string, unknown> = { ...fullElement() };
      delete record[field];
      const result = validateElement(record);
      expect(result.ok, `without ${field}`).toBe(false);
      if (!result.ok) expect(result.issues).toContainEqual({ path: `$.${field}`, message: "is required" });
    }
  });

  it("enforces lineage rules, hash shape, slot-in-layer and closed objects", () => {
    const bad = (patch: Record<string, unknown>) => validateElement({ ...fullElement(), ...patch }).ok;
    expect(bad({ lineage: { mode: "verbatim" } })).toBe(false);
    expect(bad({ lineage: { mode: "original", source } })).toBe(false);
    expect(bad({ lineage: { mode: "original" } })).toBe(true);
    expect(bad({ lineage: { mode: "customized", source, parent: { version: 1, hash: H("c") } } })).toBe(false);
    expect(bad({ hash: "sha256:xyz" })).toBe(false);
    expect(bad({ slot: "frames.hero" })).toBe(false);
    expect(bad({ designerOnly: true })).toBe(false);
    expect(bad({ checks: [{ id: "x", type: "fixed", status: "maybe" }] })).toBe(false);
  });
});

describe("preview.json, release and slot contract schemas", () => {
  it("accepts valid records and rejects missing fields", () => {
    expect(validatePreview(preview).ok).toBe(true);
    const { width: _width, ...noWidth } = preview;
    expect(validatePreview(noWidth).ok).toBe(false);
    expect(validatePreview({ ...preview, container: "modal" }).ok).toBe(false);

    const contract = {
      schema: "clossys.slot-contract/1",
      slot: "copy.home-hero",
      package: "writer",
      layer: "copy",
      purpose: "Home hero heading and lead",
      inputs: [{ name: "proposition", kind: "cell", required: true }],
      limits: { "heading.maxChars": 60 },
      references: [],
      checkSuite: "writer.text/1",
      specimenKind: "text",
    };
    expect(validateSlotContract(contract).ok).toBe(true);
    for (const field of SLOT_CONTRACT_SCHEMA.required!) {
      const copy: Record<string, unknown> = { ...contract };
      delete copy[field];
      expect(validateSlotContract(copy).ok, `without ${field}`).toBe(false);
    }
    expect(validateSlotContract({ ...contract, specimenKind: "audio" }).ok).toBe(false);
    expect(validateRelease({ schema: "clossys.release/1", number: 0, at: AT(0), by: "x", pins: {}, selectionEvent: null }).ok).toBe(false);
  });
});

describe("library/<slot>/<element>/v<n>/", () => {
  const files = { "registry-item.json": '{"name":"hero"}\n', "hero.tsx": "export function Hero() { return null }\n" };

  it("writes immutable, hash-verified versions and numbers them in order", () => {
    const v1 = writeElementVersion(root, { element: elementBase(), preview, files });
    expect(v1.dir).toBe(join(root, "sections.hero", "hero", "v1"));
    expect(v1.element.version).toBe(1);
    expect(v1.element.payload).toEqual(["hero.tsx", "registry-item.json"]);
    expect(verifyElementVersion(root, "sections.hero", "hero", 1)).toEqual([]);

    const v2 = writeElementVersion(root, {
      element: elementBase({ lineage: { mode: "customized", source, parent: { version: 1, hash: v1.element.hash } } }),
      preview,
      files: { ...files, "hero.tsx": "export function Hero() { return 1 }\n" },
    });
    expect(v2.element.version).toBe(2);
    expect(v2.element.hash).not.toBe(v1.element.hash);
    expect(listVersions(root, "sections.hero", "hero")).toEqual([1, 2]);
    expect(readElementVersion(root, "sections.hero", "hero", 1).element).toEqual(v1.element);
  });

  it("detects a payload edited after write (mutation)", () => {
    const v1 = writeElementVersion(root, { element: elementBase(), preview, files });
    writeFileSync(join(v1.dir, "hero.tsx"), "export function Hero() { return 'edited' }\n");
    const issues = verifyElementVersion(root, "sections.hero", "hero", 1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe("$.hash");
  });

  it("refuses an invalid record and leaves nothing behind", () => {
    expect(() => writeElementVersion(root, { element: elementBase({ reason: "" }), preview, files })).toThrow(/reason/);
    expect(listVersions(root, "sections.hero", "hero")).toEqual([]);
    expect(() => writeElementVersion(root, { element: elementBase(), preview, files: { "../escape.tsx": "x" } })).toThrow(/invalid payload path/);
  });
});

describe("selection.json pins and history", () => {
  const el = (version: number, hash: Hash) => ({ slot: "sections.hero", id: "hero", version, hash });

  it("records pins as events; restore is a new event and history is never rewritten", () => {
    let s = pin(emptySelection(), { element: el(1, H("1")), at: AT(1), by: "owner", from: "option" });
    s = pin(s, { element: el(2, H("2")), at: AT(2), by: "owner", from: "version" });
    const before = s.history;
    s = restore(s, "e1", { at: AT(3), by: "owner", reason: "back to v1" });
    expect(s.history.slice(0, 2)).toEqual(before);
    expect(s.history[2]).toMatchObject({ id: "e3", action: "restore", restores: "e1", version: 1 });
    expect(s.pins["sections.hero"]).toEqual({ element: "hero", version: 1, hash: H("1"), event: "e3" });
    expect(pinsAt(s, AT(2))["sections.hero"]?.version).toBe(2);
    expect(pinsAt(s, AT(0))).toEqual({});
    s = unpin(s, "sections.hero", { at: AT(4), by: "owner" });
    expect(s.pins).toEqual({});
    expect(validateSelection(s).ok).toBe(true);

    writeSelection(root, s);
    expect(JSON.parse(readFileSync(join(root, "selection.json"), "utf8"))).toEqual(s);
  });

  it("rejects pins that disagree with history, forged restores and out-of-order events", () => {
    const s = pin(emptySelection(), { element: el(1, H("1")), at: AT(1), by: "owner" });
    expect(validateSelection({ ...s, pins: {} }).ok).toBe(false);
    const forged = {
      ...s,
      history: [...s.history, { id: "e2", at: AT(2), by: "x", action: "restore", slot: "sections.hero", element: "hero", version: 9, hash: H("9"), restores: "e1" }],
      pins: { "sections.hero": { element: "hero", version: 9, hash: H("9"), event: "e2" } },
    };
    expect(validateSelection(forged).ok).toBe(false);
    const outOfOrder = { ...s, history: [...s.history, { ...s.history[0]!, id: "e2", at: AT(0) }] };
    expect(validateSelection(outOfOrder).ok).toBe(false);
  });
});

describe("releases/<n>.json", () => {
  it("snapshots the pins and never overwrites a release", () => {
    const s = pin(emptySelection(), { element: { slot: "sections.hero", id: "hero", version: 1, hash: H("1") }, at: AT(1), by: "owner" });
    const release = createRelease(s, { number: 1, at: AT(2), by: "owner" });
    expect(release.pins).toEqual(s.pins);
    expect(release.selectionEvent).toBe("e1");
    writeRelease(root, release);
    expect(() => writeRelease(root, release)).toThrow(/immutable/);
    expect(latestRelease(root)).toEqual(release);
  });
});

describe("slot status derivation", () => {
  const record = (overrides: Partial<ElementRecord> = {}): ElementRecord => ({ ...fullElement(), hash: H("1"), ...overrides });
  const upstream = new Map([["tailark-oss/mist-hero-section-1@8139698", H("a")]]);
  const referenceHash = (ref: ReferenceRef) => upstream.get(`${ref.registry}/${ref.item}@${ref.version}`);

  it("derives pinned, missing, failing, stale and unreleased", () => {
    let s = pin(emptySelection(), { element: { slot: "sections.hero", id: "hero", version: 1, hash: H("1") }, at: AT(1), by: "o" });
    s = pin(s, { element: { slot: "sections.pricing", id: "pricing", version: 1, hash: H("2") }, at: AT(2), by: "o" });
    s = pin(s, { element: { slot: "sections.faq", id: "faq", version: 1, hash: H("3") }, at: AT(3), by: "o" });
    const release = createRelease(s, { number: 1, at: AT(4), by: "o" });
    s = pin(s, { element: { slot: "sections.stats", id: "stats", version: 1, hash: H("4") }, at: AT(5), by: "o" });

    const records: Record<string, ElementRecord> = {
      "sections.hero": record(),
      "sections.pricing": record({ slot: "sections.pricing", id: "pricing", hash: H("2"), checks: [{ id: "contrast", type: "measured", status: "fail" }] }),
      "sections.faq": record({ slot: "sections.faq", id: "faq", hash: H("3"), lineage: { mode: "verbatim", source: { ...source, item: "mist-faqs-1" } } }),
      "sections.stats": record({ slot: "sections.stats", id: "stats", hash: H("4"), lineage: { mode: "original" } }),
    };
    upstream.set("tailark-oss/mist-faqs-1@8139698", H("a"));
    const rows = (hashes = upstream) =>
      deriveSlotStatus({
        slots: ["sections.hero", "sections.pricing", "sections.faq", "sections.stats", "sections.cta"],
        selection: s,
        release,
        referenceHash: (ref) => hashes.get(`${ref.registry}/${ref.item}@${ref.version}`),
        readPinned: (slot) => ({ record: records[slot]!, issues: [] }),
      });
    const status = (list: ReturnType<typeof rows>) => Object.fromEntries(list.map((row) => [row.slot, row.status]));

    expect(status(rows())).toEqual({
      "sections.cta": "missing",
      "sections.faq": "pinned",
      "sections.hero": "pinned",
      "sections.pricing": "failing",
      "sections.stats": "unreleased",
    });

    // Upstream reference changes after the pin: the faq slot goes stale (mutation).
    const moved = new Map(upstream);
    moved.set("tailark-oss/mist-faqs-1@8139698", H("f"));
    const after = rows(moved);
    expect(status(after)["sections.faq"]).toBe("stale");
    expect(after.find((row) => row.slot === "sections.faq")!.detail.join(" ")).toMatch(/changed after the pin/);
    expect(status(after)["sections.hero"]).toBe("pinned");
  });

  it("marks a slot stale when a dependency element's pin moves", () => {
    let s = pin(emptySelection(), { element: { slot: "components.button", id: "button", version: 1, hash: H("5") }, at: AT(1), by: "o" });
    s = pin(s, { element: { slot: "sections.hero", id: "hero", version: 1, hash: H("1") }, at: AT(2), by: "o" });
    const hero = record({ deps: { npm: {}, elements: [{ slot: "components.button", element: "button", version: 1, hash: H("5") }] } });
    const derive = () =>
      deriveSlotStatus({
        slots: ["sections.hero"],
        selection: s,
        release: createRelease(s, { number: 1, at: AT(9), by: "o" }),
        referenceHash,
        readPinned: (slot) => ({ record: slot === "sections.hero" ? hero : record({ slot: "components.button", layer: "components", id: "button", hash: H("5"), lineage: { mode: "original" } }), issues: [] }),
      }).find((row) => row.slot === "sections.hero")!;
    expect(derive().status).toBe("pinned");
    s = pin(s, { element: { slot: "components.button", id: "button", version: 2, hash: H("6") }, at: AT(3), by: "o" });
    expect(derive().flags).toContain("stale");
  });

  it("reads a whole workspace from disk, including a tampered payload", () => {
    const library = join(root, "library");
    const v1 = writeElementVersion(library, {
      element: elementBase({ lineage: { mode: "original" } }),
      preview,
      files: { "hero.tsx": "export const x = 1\n" },
    });
    const s = pin(emptySelection(), { element: v1.element, at: AT(1), by: "o" });
    writeSelection(root, s);
    writeRelease(root, createRelease(s, { number: 1, at: AT(2), by: "o" }));
    const read = () => workspaceSlotStatus(root, { slots: ["sections.hero", "sections.faq"], referenceHash });
    expect(read().map((row) => [row.slot, row.status])).toEqual([
      ["sections.faq", "missing"],
      ["sections.hero", "pinned"],
    ]);
    writeFileSync(join(v1.dir, "hero.tsx"), "export const x = 2\n");
    expect(read().find((row) => row.slot === "sections.hero")!.status).toBe("failing");
    expect(existsSync(join(root, "releases", "1.json"))).toBe(true);
  });
});
