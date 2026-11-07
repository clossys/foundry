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
import { createSpecimenBuilder } from "@clossys/publisher/specimen";
import { aliasProvider, libraryRecordSource, PINNED_THEME_ID, pinnedLibraryTheme, SPECIMEN_STATE_FILE, libraryRecordStore, listLibraryElements, locateLibraryElement, pinnedLibraryVersion } from "./library-source.js";

let root: string;
beforeEach(async () => { root = await canonicalLibrary(mkdtempSync(join(tmpdir(), "producer-slot-source-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
const card = () => listSlots(root, "designer").find(entry => entry.id === "components.card")!;
const candidate = () => join(candidatesDir(card().dir), "sample-card-v1.json");
// The fixture's pinned Writer candidate (canonical-writer/strings.sample): the card declares these keys and owns no text.
const WRITER_COPY = { "card.action": "Open report", "card.body": "Review the numbers from the last seven days before they go out to the team.", "card.title": "Weekly report ready" };

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
    expect(expected.meta.preview.copy).toBeUndefined();
    const { inputs: _inputs, ...declared } = expected.meta.preview;
    expect((await libraryRecordStore([root]).load("sample-card"))!.preview).toEqual({ ...declared, copy: WRITER_COPY });
    expect(record!.preview).toMatchObject({ width: 480, container: "canvas", copy: Object.fromEntries(Object.entries(WRITER_COPY).map(([key, text]) => [key, { text }])) });
    expect(record!.preview.theme).toBeUndefined();
    expect(record!.contentHash).toBe(sha256Hex(readFileSync(candidate())));
    expect(await source.read("sample-card", 2)).toBeUndefined();
    expect(await source.theme()).toMatchObject({ id: "themes.preset/neutral" });
  });

  it("answers a specimen that names no theme with every pinned theme variable, light and dark", async () => {
    const consumer = fileURLToPath(new URL("../../../../clossys", import.meta.url));
    const theme = await libraryRecordSource({ roots: [consumer] }).theme();
    expect(theme).toEqual(pinnedLibraryTheme([consumer]));
    expect(theme!.id).toBe(PINNED_THEME_ID);
    // The base shadcn variables every component reads, not only the first `themes.*` leaf.
    for (const name of ["background", "foreground", "card", "popover", "muted", "muted-foreground", "border", "input", "ring", "primary", "accent", "radius"]) expect(theme!.light, name).toHaveProperty(name);
    for (const name of ["background", "foreground", "muted", "border", "popover"]) expect(theme!.dark, name).toHaveProperty(name);
    expect(theme!.light.background).not.toBe(theme!.dark!.background);
    // An explicit theme id still reads that one record.
    expect(await libraryRecordSource({ roots: [consumer] }).theme("themes.accent/accent")).toMatchObject({ id: "themes.accent/accent", light: { accent: expect.any(String) } });
  });

  it("mounts an item of a slot with a declared specimen state through the state module, its own bytes unchanged", async () => {
    const consumer = fileURLToPath(new URL("../../../../clossys", import.meta.url));
    const row = await libraryRecordStore([consumer]).load("components.toast/toast");
    expect(row).toBeDefined();
    const pin = listSlots(consumer, "designer").find(entry => entry.id === "components.toast")!.pin!;
    expect(row!.files[0]!.content).toBe(readCandidate(consumer, "designer", "components.toast", pin.candidate).bytes);
    const state = row!.files.find(file => file.path === SPECIMEN_STATE_FILE)!;
    expect(state.content).toContain('import { toast as openSpecimen } from "sonner";');
    expect(state.content).toContain('import * as Item from "../sonner";');
    expect(state.content).toContain('openSpecimen("Changes saved", { duration: Infinity })');
    expect(row!.preview).toMatchObject({ entry: SPECIMEN_STATE_FILE, export: "SpecimenState" });
    const record = await libraryRecordSource({ roots: [consumer] }).read("components.toast/toast");
    expect(record!.preview).toMatchObject({ entry: SPECIMEN_STATE_FILE, export: "SpecimenState" });
    // A slot with no declared state keeps its own preview.
    const card = await libraryRecordStore([consumer]).load("components.card/card");
    expect(card?.files.some(file => file.path === SPECIMEN_STATE_FILE)).toBe(false);
  });

  it.each(["frames.studio-shell/studio-shell", "sections.studio.home/studio-home", "sections.studio.checks/studio-checks"])("reads actual canonical Studio %s from its pin or remains unresolved", async id => {
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
    writeFileSync(candidate(), readFileSync(candidate(), "utf8").replace("Later", "Not now"));
    await expect(libraryRecordStore([root]).load("sample-card")).rejects.toBeInstanceOf(RecordError);
    writeFileSync(candidate(), "{}\n");
    await expect(libraryRecordStore([root]).load("sample-card")).rejects.toBeInstanceOf(RecordError);
  });

  it("passes a preview element tree naming the candidate's own exports and rejects any other component", async () => {
    const slot = card(), item = JSON.parse(readFileSync(candidate(), "utf8"));
    const repin = (children: unknown) => {
      const fixtures = { file: item.files[0].path, props: { children } };
      const bytes = jsonBytes({ ...item, meta: { ...item.meta, preview: { ...item.meta.preview, fixtures } } });
      writeFileSync(candidate(), bytes);
      writeFileSync(pinFile(slot.dir), jsonBytes({ ...slot.pin, sha256: sha256Hex(bytes) }));
    };
    repin([{ $component: "SampleCard", props: { title: "Title", body: "Body", action: "Open" } }, "Plain text"]);
    const preview = (await libraryRecordStore([root]).load("sample-card"))!.preview as Record<string, any>;
    expect(preview.fixtures.props.children[0]).toMatchObject({ $component: "SampleCard" });
    expect(preview.copy).toEqual(WRITER_COPY);
    repin([{ $component: "SampleCard", children: [{ $component: "SampleButton" }] }]);
    await expect(libraryRecordStore([root]).load("sample-card")).rejects.toThrow("the candidate exports no component SampleButton");
    repin([{ $copy: "studio.missing" }]);
    await expect(libraryRecordStore([root]).load("sample-card")).rejects.toThrow("Writer has no copy key studio.missing");
  });

  it("reads declared copy from the pinned Writer candidate, so a Writer re-pin changes the specimen text", async () => {
    const writer = listSlots(root, "writer").find(entry => entry.id === "strings.sample")!;
    const bytes = readFileSync(join(candidatesDir(writer.dir), "sample-v1.md"), "utf8").replace("Weekly report ready", "Monthly report ready");
    writeFileSync(join(candidatesDir(writer.dir), "sample-v2.md"), bytes);
    writeFileSync(pinFile(writer.dir), jsonBytes({ ...writer.pin, candidate: "sample-v2.md", sha256: sha256Hex(bytes) }));
    expect((await libraryRecordStore([root]).load("sample-card"))!.preview).toMatchObject({ copy: { ...WRITER_COPY, "card.title": "Monthly report ready" } });
  });

  it("reads a caller's Writer snapshot instead of scanning Writer per load (a scan per load held Studio's event loop for minutes)", async () => {
    const snapshot = { ...WRITER_COPY, "card.title": "Snapshot title" };
    expect((await libraryRecordStore([root], { writerCopy: snapshot }).load("sample-card"))!.preview).toMatchObject({ copy: snapshot });
    expect((await libraryRecordSource({ roots: [root], writerCopy: snapshot }).read("sample-card"))!.preview).toMatchObject({ copy: { "card.title": { text: "Snapshot title" } } });
    // The snapshot is the pass's Writer state: a declared key it lacks is refused like a missing Writer key.
    const { "card.body": _body, ...partial } = WRITER_COPY;
    await expect(libraryRecordStore([root], { writerCopy: partial }).load("sample-card")).rejects.toThrow(/card\.body/);
    expect(() => libraryRecordStore([root, root], { writerCopy: snapshot })).toThrow(/exactly one consumer root/);
  });

  it("refuses a preview.copy snapshot and an undeclared copy key", async () => {
    const slot = card(), item = JSON.parse(readFileSync(candidate(), "utf8"));
    const repin = (preview: unknown) => {
      const bytes = jsonBytes({ ...item, meta: { ...item.meta, preview } });
      writeFileSync(candidate(), bytes);
      writeFileSync(pinFile(slot.dir), jsonBytes({ ...slot.pin, sha256: sha256Hex(bytes) }));
    };
    repin({ ...item.meta.preview, copy: WRITER_COPY });
    await expect(libraryRecordStore([root]).load("sample-card")).rejects.toThrow(/copy/);
    repin({ ...item.meta.preview, inputs: { copy: ["card.action", "card.body"] } });
    await expect(libraryRecordStore([root]).load("sample-card")).rejects.toThrow(/card\.title/);
  });

  it("rejects slot identity drift even when the payload remains valid", async () => {
    const slot = card(), doc = JSON.parse(readFileSync(slotFile(slot.dir), "utf8"));
    writeFileSync(slotFile(slot.dir), jsonBytes({ ...doc, id: "components.button" }));
    // The common slot reader refuses a slot document whose id is not its IA position.
    await expect(libraryRecordStore([root]).load("sample-card")).rejects.toThrow("Slot designer/components.card does not match its IA position");
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

  it("resolves `@/` to the consumer's pinned candidate by its install path, the mapping the app build uses", async () => {
    const repo = fileURLToPath(new URL("../../../../", import.meta.url));
    const consumer = join(repo, "clossys"), registryBase = join(repo, "packages/designer/ui/src");
    const store = libraryRecordStore([consumer], { registryBase });
    const button = listSlots(consumer, "designer").find(entry => entry.id === "components.button")!;
    // registry:ui `button.tsx` installs at components/ui/button; the slot named after the file wins a shared path.
    expect((await store.alias!("components/ui/button", { registryDependencies: [] }))!.id).toBe(`components.button/${button.pin!.candidate.replace(/-v\d+\.json$/, "")}`);
    // The stock registry base answers only a declared registry dependency no pin installs.
    expect(await store.alias!("hooks/use-mobile", { registryDependencies: [] })).toBeUndefined();
    expect((await store.alias!("hooks/use-mobile", { registryDependencies: ["use-mobile"] }))!.id).toBe("registry/use-mobile");
    expect(await libraryRecordStore([consumer]).alias!("hooks/use-mobile", { registryDependencies: ["use-mobile"] })).toBeUndefined();
    expect(await store.alias!("components/ui/../../secret", { registryDependencies: ["secret"] })).toBeUndefined();
    // End to end: Sidebar's `@/components/ui/*` and `@/hooks/use-mobile` imports all bundle.
    const source = libraryRecordSource({ roots: [consumer], registryBase });
    const sidebar = await source.read("components.sidebar/sidebar");
    const built = await createSpecimenBuilder({ workspace: repo }).build(sidebar!, source);
    expect(built.errors).toEqual([]);
    expect(built.js).toContain("SidebarProvider");
  }, 60_000);

  it("names a shared install path's provider by slot name or identical bytes, else reports the ambiguity", () => {
    const index = new Map([
      ["components/ui/button", [{ id: "components.link/link", content: "a" }, { id: "components.button/button", content: "b" }]],
      ["components/ui/chart", [{ id: "components.area-chart/x", content: "same" }, { id: "components.bar-chart/y", content: "same" }]],
      ["components/ui/field", [{ id: "components.form/a", content: "1" }, { id: "components.fieldset/b", content: "2" }]],
    ]);
    expect(aliasProvider(index, "components/ui/button")).toBe("components.button/button");
    expect(aliasProvider(index, "components/ui/chart.tsx")).toBe("components.area-chart/x");
    expect(() => aliasProvider(index, "components/ui/field")).toThrow(/installed by 2 pinned candidates/);
    expect(aliasProvider(index, "components/ui/none")).toBeUndefined();
  });
});
