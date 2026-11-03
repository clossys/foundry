import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecordError } from "../records/validate.js";
import { listSlots, readCandidate } from "../records/slots.js";
import { candidatesDir, jsonBytes, pinFile, slotFile } from "../records/slot-model/index.js";
import { sha256Hex } from "../records/hash.js";
import { canonicalLibrary } from "./__fixtures__/canonical-library.js";
import { libraryRecordSource, libraryRecordStore, listLibraryElements, locateLibraryElement, pinnedLibraryVersion } from "./library-source.js";

let root: string;
beforeEach(async () => { root = await canonicalLibrary(mkdtempSync(join(tmpdir(), "producer-slot-source-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
const card = () => listSlots(root, "designer").find(entry => entry.id === "components.card")!;
const candidate = () => join(candidatesDir(card().dir), "sample-card-v1.json");

describe("canonical specimen records through the common slot reader", () => {
  it("lists and locates IA candidates by slot/element or a unique bare name", () => {
    expect(listLibraryElements([root])).toEqual(["components.button/sample-button", "components.card/sample-card", "themes.preset/neutral"]);
    expect(locateLibraryElement([root], "sample-card")).toMatchObject({ slot: "components.card", element: "sample-card" });
    expect(locateLibraryElement([root], "components.card/sample-card")).toMatchObject({ slot: "components.card" });
    expect(locateLibraryElement([root], "../sample-card")).toBeUndefined();
    expect(locateLibraryElement([root], "missing")).toBeUndefined();
  });

  it("preserves inline payload, preview and theme after all old specimen stores are removed", async () => {
    const source = libraryRecordSource({ roots: [root], defaultTheme: "neutral" });
    const expected = JSON.parse(readFileSync(candidate(), "utf8"));
    const record = await source.read("sample-card");
    expect(record).toMatchObject({ id: "components.card/sample-card", version: 1, kind: "visual" });
    expect(record!.payload.path).toBe("sample-card.json");
    expect(record!.payload.raw).toBe(readFileSync(candidate(), "utf8"));
    expect(JSON.parse(record!.payload.raw).meta.source).toEqual(expected.meta.source);
    expect(record!.payload.files).toEqual(expected.files.map((file: { path: string; content: string; type?: string }) => ({ path: file.path, content: file.content, ...(file.type ? { type: file.type } : {}) })));
    expect((await libraryRecordStore([root]).load("sample-card"))!.preview).toEqual(expected.meta.preview);
    expect(record!.preview).toMatchObject({ width: 480, container: "canvas", copy: Object.fromEntries(Object.entries(expected.meta.preview.copy).map(([key, text]) => [key, { text }])) });
    expect(record!.preview.theme).toBeUndefined();
    expect(record!.contentHash).toBe(sha256Hex(readFileSync(candidate())));
    expect(await source.read("sample-card", 2)).toBeUndefined();
    expect(await source.theme()).toMatchObject({ id: "themes.preset/neutral" });
  });

  it.each(["frames.studio-shell/studio-shell", "sections.studio.agent-gallery/studio-agent-gallery", "sections.studio.checks/studio-checks"])("reads actual canonical Studio %s from its pin or remains unresolved", async id => {
    const consumer = fileURLToPath(new URL("../../../../clossys", import.meta.url));
    const source = libraryRecordSource({ roots: [consumer] });
    const [slot] = id.split("/");
    const entry = listSlots(consumer, "designer").find(entry => entry.id === slot);
    expect(entry).toBeDefined();
    const record = await source.read(id);
    const pin = entry!.pin;
    if (!pin) {
      expect(record).toBeUndefined();
      return;
    }
    const native = readCandidate(consumer, "designer", slot!, pin.candidate);
    const item = JSON.parse(native.bytes);
    expect(native.sha256).toBe(pin.sha256);
    expect(record).toBeDefined();
    expect(record!.contentHash).toBe(pin.sha256);
    expect(record!.payload.raw).toBe(native.bytes);
    expect(record!.payload.files).toEqual(item.files);
    expect(record!.kind).toBe("visual");
    expect(record!.preview).toMatchObject({ entry: item.meta.preview.fixtures.file, export: item.meta.preview.fixtures.export, fixtures: item.meta.preview.fixtures.props });
    expect(JSON.parse(record!.payload.raw).meta.source).toEqual(item.meta.source);
    expect(record!.version).toBe(Number(/-v(\d+)\.json$/.exec(pin.candidate)![1]));
  });

  it("loads every pinned canonical element in bounded time (a full slot scan per load hung Studio startup)", async () => {
    const consumer = fileURLToPath(new URL("../../../../clossys", import.meta.url));
    const pinned = listSlots(consumer, "designer").flatMap(entry => {
      const element = entry.pin && /^(.+)-v\d+\.json$/.exec(entry.pin.candidate)?.[1];
      return element ? [`${entry.id}/${element}`] : [];
    });
    expect(pinned.length).toBeGreaterThan(150);
    const store = libraryRecordStore([consumer]);
    const started = performance.now();
    for (const id of pinned) await store.load(id).catch(() => undefined);
    // O(slots) per load was ~70 ms each here (~15 s for one pass); per-slot reads take a few ms.
    expect(performance.now() - started).toBeLessThan(4000);
  }, 30_000);

  it("rejects candidate identity drift even after a temporary fixture is re-pinned to those bytes", async () => {
    const slot = card(), item = JSON.parse(readFileSync(candidate(), "utf8"));
    const bytes = jsonBytes({ ...item, name: "another-element" });
    writeFileSync(candidate(), bytes);
    writeFileSync(pinFile(slot.dir), jsonBytes({ ...slot.pin, sha256: sha256Hex(bytes) }));
    await expect(libraryRecordStore([root]).load("sample-card")).rejects.toThrow(/element identity/);
  });

  it("reads an older pin and exposes newer options only by explicit version", async () => {
    const slot = card();
    const draft = JSON.parse(readFileSync(candidate(), "utf8"));
    draft.files[0].content += "\n// newer option\n";
    writeFileSync(join(candidatesDir(slot.dir), "sample-card-v2.json"), jsonBytes(draft));
    expect(pinnedLibraryVersion(root, slot.id, "sample-card")).toBe(1);
    expect(await libraryRecordStore([root]).load("sample-card")).toMatchObject({ version: 1 });
    expect(await libraryRecordStore([root]).load("sample-card", 2)).toMatchObject({ version: 2 });
  });

  it("does not fall back to a newer candidate when the pin is missing or invalid", async () => {
    const slot = card();
    rmSync(pinFile(slot.dir));
    expect(await libraryRecordStore([root]).load("sample-card")).toBeUndefined();
    writeFileSync(pinFile(slot.dir), "{}\n");
    expect(await libraryRecordStore([root]).load("sample-card")).toBeUndefined();
    expect(await libraryRecordStore([root]).load("sample-card", 1)).toMatchObject({ version: 1 });
  });

  it("does not fall back when a pin names a missing candidate", async () => {
    const slot = card();
    writeFileSync(pinFile(slot.dir), jsonBytes({ ...slot.pin, candidate: "sample-card-v7.json" }));
    expect(pinnedLibraryVersion(root, slot.id, "sample-card")).toBe(7);
    expect(await libraryRecordStore([root]).load("sample-card")).toBeUndefined();
  });

  it("rejects pinned byte drift and malformed candidate content", async () => {
    writeFileSync(candidate(), readFileSync(candidate(), "utf8").replace("Weekly report ready", "Changed report title"));
    await expect(libraryRecordStore([root]).load("sample-card")).rejects.toBeInstanceOf(RecordError);
    writeFileSync(candidate(), "{}\n");
    await expect(libraryRecordStore([root]).load("sample-card")).rejects.toBeInstanceOf(RecordError);
  });

  it("rejects slot identity drift even when the payload remains valid", async () => {
    const slot = card(), doc = JSON.parse(readFileSync(slotFile(slot.dir), "utf8"));
    writeFileSync(slotFile(slot.dir), jsonBytes({ ...doc, id: "components.button" }));
    await expect(libraryRecordStore([root]).load("sample-card")).rejects.toBeInstanceOf(RecordError);
  });

  it("ignores legacy library and selection stores when canonical pins are absent", async () => {
    const slot = card(); rmSync(pinFile(slot.dir));
    mkdirSync(join(root, "library/components.card/sample-card/v1"), { recursive: true });
    writeFileSync(join(root, "selection.json"), jsonBytes({ pins: { "components.card": { element: "sample-card", version: 1 } } }));
    expect(await libraryRecordStore([root]).load("sample-card")).toBeUndefined();
    expect(readCandidate(root, "designer", slot.id, "sample-card-v1.json").bytes).toContain("sample-card");
  });

  it("requires a qualified id when two IA slots carry the same element name", () => {
    const other = listSlots(root, "designer").find(entry => entry.id === "themes.background")!;
    mkdirSync(candidatesDir(other.dir), { recursive: true });
    writeFileSync(join(candidatesDir(other.dir), "sample-card-v1.json"), readFileSync(candidate()));
    expect(() => locateLibraryElement([root], "sample-card")).toThrow(/2 slots/);
    expect(locateLibraryElement([root], "components.card/sample-card")).toMatchObject({ slot: "components.card" });
  });
});
