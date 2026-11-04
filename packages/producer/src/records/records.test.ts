import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  hashFiles,
  sha256Hex,
  treeHash,
  loadReferencesManifest,
  manifestReferenceHash,
  validateReferencesManifest,
  ELEMENT_SCHEMA,
  listVersions,
  readElementVersion,
  SLOT_CONTRACT_SCHEMA,
  validateElement,
  validatePreview,
  validateSlotContract,
  verifyElementVersion,
  workspaceSlotStatus,
  writeElementVersion,
  type ElementRecord,
  type Hash,
  type NewElementVersion,
  type PreviewRecord,
  type ReferenceRef,
} from "./index.js";
import { candidatesDir, iaPath, jsonBytes, pinFile, slotDir, slotFile, slotPositions, type IaDoc } from "./slot-model/index.js";

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

describe("preview.json and slot contract schemas", () => {
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
  const upstream = new Map([["tailark-oss/mist-hero-section-1@8139698", H("a")]]);
  const referenceHash = (ref: ReferenceRef) => upstream.get(`${ref.registry}/${ref.item}@${ref.version}`);

  it("reads a whole Designer slot model from disk, including a tampered candidate", () => {
    const ia: IaDoc = { schema: "clossys.ia/1", source: "consumer#fixture", extensions: [], nodes: [{ id: "sections.content", label: "Content", children: [{ id: "heroes", label: "Heroes", slots: ["sections.hero", "sections.faq"] }] }] };
    const dirOf = (slot: string) => slotDir(root, "designer", slot);
    const put = (path: string, bytes: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, bytes); };
    put(iaPath(root, "designer"), jsonBytes(ia));
    for (const [id, position] of slotPositions("designer", ia)) put(slotFile(dirOf(id)), jsonBytes({ schema: "clossys.slot/1", id, agent: "designer", kind: "element", ia: position, contract: {}, inputs: [], uses: [] }));
    const ref = JSON.stringify(source);
    const bytes = jsonBytes({ name: "hero", type: "registry:block", files: [{ path: "hero.tsx", type: "registry:file", content: "export const x = 1\n" }],
      meta: { slot: "sections.hero", source: { kind: "registry", ref: [ref] }, element: { id: "hero", slot: "sections.hero", checks: [], deps: { npm: {}, elements: [] } } } });
    put(join(candidatesDir(dirOf("sections.hero")), "hero-v1.json"), bytes);
    put(pinFile(dirOf("sections.hero")), jsonBytes({ candidate: "hero-v1.json", sha256: sha256Hex(bytes), decidedBy: "owner:fixture", at: AT(1) }));
    const read = (hashes = referenceHash) => workspaceSlotStatus(root, { referenceHash: hashes });
    expect(read().map((row) => [row.slot, row.status])).toEqual([
      ["sections.hero", "pinned"],
      ["sections.faq", "missing"],
    ]);
    expect(read(() => H("b")).find((row) => row.slot === "sections.hero")!.status).toBe("stale");
    writeFileSync(join(candidatesDir(dirOf("sections.hero")), "hero-v1.json"), bytes.replace("x = 1", "x = 2"));
    expect(read().find((row) => row.slot === "sections.hero")!.status).toBe("failing");
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
