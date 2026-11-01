import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The ref-verbatim pin gate has its own tests (ref-verbatim-gate.test.ts); these
// record tests pin synthetic versions, so the gate passes them here.
vi.mock("@clossys/designer/ref-verbatim", () => ({
  checkElement: (_root: string, target: { slot: string; element: string; version: number }) => ({
    key: `${target.slot}/${target.element}@v${target.version}`,
    findings: [],
  }),
}));
import {
  hashFiles,
  sha256Hex,
  treeHash,
  loadReferencesManifest,
  manifestReferenceHash,
  validateReferencesManifest,
  createRelease,
  deriveSlotStatus,
  ELEMENT_SCHEMA,
  emptySelection,
  latestRelease,
  listVersions,
  pin as rawPin,
  pinsAt,
  readElementVersion,
  restore as rawRestore,
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

// Synthetic record fixtures still carry explicit owner decisions; approval enforcement stays real.
function approvePin(input: { root: string; element: { slot: string; id: string; version: number; hash: string } }) {
  const file = join(input.root, "approvals.json");
  const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { schema: "clossys.owner-approvals/1", records: [] };
  const id = `fixture-${data.records.length + 1}`;
  data.records.push({ id, actor: "owner", owner: "fixture-owner", reference: "test owner decision", at: "2026-10-29T00:00:00Z", action: "pin", slot: input.element.slot, element: input.element.id, version: input.element.version, hash: input.element.hash });
  writeFileSync(file, JSON.stringify(data));
  return id;
}
function ensurePinFixture(input: Parameters<typeof rawPin>[1]): void {
  const dir = join(input.root, "library", input.element.slot, input.element.id, `v${input.element.version}`);
  if (existsSync(join(dir, "element.json"))) return;
  const bytes = fixtureBytes.get(input.element.hash);
  if (bytes === undefined) throw new Error("Fixture hash must name genuine payload bytes");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fixture.json"), bytes);
  const record = { ...elementBase({ id: input.element.id, slot: input.element.slot, layer: input.element.slot.split(".")[0]! }),
    version: input.element.version, hash: hashFiles(dir, ["fixture.json"]), payload: ["fixture.json"] };
  writeFileSync(join(dir, "element.json"), JSON.stringify(record));
  writeFileSync(join(dir, "preview.json"), JSON.stringify(preview));
}
const pin = (selection: Parameters<typeof rawPin>[0], input: Parameters<typeof rawPin>[1]) => {
  ensurePinFixture(input);
  return rawPin(selection, { ...input, approval: approvePin(input) });
};
const restore = (selection: Parameters<typeof rawRestore>[0], event: string, input: Parameters<typeof rawRestore>[2]) => {
  const target = selection.history.find(row => row.id === event)!;
  return rawRestore(selection, event, { ...input, approval: target ? approvePin({ ...input, element: { slot: target.slot, id: target.element!, version: target.version!, hash: target.hash! } }) : undefined });
};

const fixtureBytes = new Map<string, string>();
const H = (c: string): Hash => {
  const bytes = JSON.stringify({ fixture: c });
  const hash = treeHash([{ path: "fixture.json", sha256: sha256Hex(bytes) }]);
  fixtureBytes.set(hash, bytes);
  return hash;
};
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
    let s = pin(emptySelection(), { root, element: el(1, H("1")), at: AT(1), by: "owner", from: "option" });
    s = pin(s, { root, element: el(2, H("2")), at: AT(2), by: "owner", from: "version" });
    const before = s.history;
    s = restore(s, "e1", { root, at: AT(3), by: "owner", reason: "back to v1" });
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
    const s = pin(emptySelection(), { root, element: el(1, H("1")), at: AT(1), by: "owner" });
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
    const s = pin(emptySelection(), { root, element: { slot: "sections.hero", id: "hero", version: 1, hash: H("1") }, at: AT(1), by: "owner" });
    const release = createRelease(s, { number: 1, at: AT(2), by: "owner" });
    expect(release.pins).toEqual(s.pins);
    expect(release.selectionEvent).toBe("e1");
    writeRelease(root, release);
    expect(() => writeRelease(root, release)).toThrow(/immutable/);
    expect(latestRelease(root)).toEqual(release);
  });
});

describe("Designer references manifest", () => {
  const referencesRoot = fileURLToPath(new URL("../../../designer/references/", import.meta.url));

  it("validates against the Producer schema and its item hashes recompute with treeHash", () => {
    const manifest = loadReferencesManifest(join(referencesRoot, "manifest.json"));
    expect(manifest.items.length).toBeGreaterThan(0);
    for (const item of manifest.items) {
      expect(hashFiles(join(referencesRoot, item.dir), item.files.map((file) => file.path)), item.dir).toBe(item.hash);
    }
    const resolve = manifestReferenceHash([manifest]);
    const first = manifest.items[0]!;
    expect(resolve({ registry: first.registry, item: first.name, version: first.version })).toBe(first.hash);
  });

  it("keeps source sanitization approvals finite and verifies the preserved upstream tree", () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../../designer/references/manifest.json", import.meta.url)), "utf8"));
    const item = manifest.items.find((row: { adaptations?: unknown[] }) => row.adaptations?.length);
    expect(item).toBeDefined();
    expect(validateReferencesManifest(manifest)).toMatchObject({ ok: true });
    const original = item.adaptations[0].upstream.hash;
    item.adaptations[0].upstream.hash = H("0");
    let checked = validateReferencesManifest(manifest);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.issues.some(issue => issue.path.endsWith(".upstream.hash"))).toBe(true);
    item.adaptations[0].upstream.hash = original;
    item.adaptations[0].kind = "arbitrary-rewrite";
    checked = validateReferencesManifest(manifest);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.issues.some(issue => issue.path.endsWith(".kind"))).toBe(true);
  });

  it("rejects a manifest whose item hash no longer matches its files (mutation)", () => {
    const manifest = JSON.parse(readFileSync(join(referencesRoot, "manifest.json"), "utf8"));
    manifest.items[0].files[0].sha256 = "0".repeat(64);
    const result = validateReferencesManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.path)).toContain("$.items[0].hash");
  });
});

describe("slot status derivation", () => {
  const record = (overrides: Partial<ElementRecord> = {}): ElementRecord => ({ ...fullElement(), hash: H("1"), ...overrides });
  const upstream = new Map([["tailark-oss/mist-hero-section-1@8139698", H("a")]]);
  const referenceHash = (ref: ReferenceRef) => upstream.get(`${ref.registry}/${ref.item}@${ref.version}`);

  it("derives pinned, missing, failing, stale and unreleased", () => {
    let s = pin(emptySelection(), { root, element: { slot: "sections.hero", id: "hero", version: 1, hash: H("1") }, at: AT(1), by: "o" });
    s = pin(s, { root, element: { slot: "sections.pricing", id: "pricing", version: 1, hash: H("2") }, at: AT(2), by: "o" });
    s = pin(s, { root, element: { slot: "sections.faq", id: "faq", version: 1, hash: H("3") }, at: AT(3), by: "o" });
    const release = createRelease(s, { number: 1, at: AT(4), by: "o" });
    s = pin(s, { root, element: { slot: "sections.stats", id: "stats", version: 1, hash: H("4") }, at: AT(5), by: "o" });

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
    let s = pin(emptySelection(), { root, element: { slot: "components.button", id: "button", version: 1, hash: H("5") }, at: AT(1), by: "o" });
    s = pin(s, { root, element: { slot: "sections.hero", id: "hero", version: 1, hash: H("1") }, at: AT(2), by: "o" });
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
    s = pin(s, { root, element: { slot: "components.button", id: "button", version: 2, hash: H("6") }, at: AT(3), by: "o" });
    expect(derive().flags).toContain("stale");
  });

  it("reads a whole workspace from disk, including a tampered payload", () => {
    const library = join(root, "library");
    writeFileSync(join(root, "approvals.json"), JSON.stringify({ schema: "clossys.owner-approvals/1", records: [{ id: "status-fixture-create", actor: "owner", owner: "fixture-owner", reference: "explicit fixture create decision", at: "2026-10-29T00:00:00Z", action: "create", slot: "sections.hero", element: "hero" }] }));
    const v1 = writeElementVersion(library, {
      element: elementBase({ lineage: { mode: "original" } }),
      designerFlow: { path: "create", ownerRequest: "status-fixture-create" },
      preview,
      files: { "hero.tsx": "export const x = 1\n" },
    });
    const s = pin(emptySelection(), { root, element: v1.element, at: AT(1), by: "o" });
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


describe("exact-part record contract", () => {
  const record = () => ({
    ...fullElement(), payload: ["index.tsx", "LICENSE"],
    lineage: { mode: "verbatim", source, exactParts: {
      schema: "ref-exact-parts/1", payload: { "index.tsx": "a".repeat(64), LICENSE: "b".repeat(64) },
      files: { "index.tsx": { sha256: "a".repeat(64), segments: [{
        start: 0, endExclusive: 12, edits: [], source: {
          reference: 0, path: "upstream.tsx", upstream: "fixture:authored@" + "a".repeat(40),
          fileSha256: "c".repeat(64), start: 10, endExclusive: 22, sha256: "a".repeat(64),
          license: { path: "fixture/LICENSE", sha256: "b".repeat(64), payloadPath: "LICENSE" },
        },
      }] } }, closure: { roots: ["index.tsx"], imports: [] },
    } },
  });

  it("accepts the closed opt-in shape alongside unchanged source identities", () => {
    expect(validateElement(record()).ok).toBe(true);
  });

  it("rejects unknown proof fields/kinds, original proofs, bad indices and byte boundaries", () => {
    const mutations = [
      (r: any) => { r.lineage.exactParts.allow = true; },
      (r: any) => { r.lineage.exactParts.files["index.tsx"].segments[0].source.reference = 1; },
      (r: any) => { r.lineage.exactParts.files["index.tsx"].segments[0].source.start = 22; },
      (r: any) => { r.lineage.exactParts.files["index.tsx"].segments[0].start = 1; },
      (r: any) => { r.lineage.exactParts.files["index.tsx"].segments[0].edits = [{ kind: "logic", start: 0, endExclusive: 1, from: "x", to: "y" }]; },
      (r: any) => { r.lineage.mode = "original"; delete r.lineage.source; },
      (r: any) => { r.lineage.exactParts.payload["index.tsx"] = "wrong"; },
      (r: any) => { r.lineage.exactParts.closure.imports = [{ file: "index.tsx", specifier: "./x", target: { kind: "ambient", path: "x.tsx" } }]; },
    ];
    for (const mutation of mutations) {
      const changed = JSON.parse(JSON.stringify(record())); mutation(changed);
      expect(validateElement(changed).ok).toBe(false);
    }
  });
});
