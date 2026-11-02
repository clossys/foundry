import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SpecimenRecord, SpecimenRecordSource } from "../specimen/types.js";
import { resolveNativeNextFonts, type NativeNextFontsOptions } from "./native-next-fonts.js";

const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
// Deliberately synthetic byte arrays exercise the compiler, never font validity, admission or a Next build.
function fixture() {
  const fontBytes = new Uint8Array([1, 2, 3]), licenseBytes = new Uint8Array([4, 5]);
  const descriptor = (path: string, bytes: Uint8Array) => ({ path, sha256: hash(bytes), bytes: bytes.length, source: { ref: "synthetic:fixture", version: "1", sha256: hash(bytes) } });
  const font = { kind: "local", family: "Synthetic Face", fallback: ["sans-serif"],
    licenses: [{ id: "synthetic", spdx: "LicenseRef-Synthetic", ...descriptor("licenses/synthetic.txt", licenseBytes) }],
    files: [{ ...descriptor("fonts/synthetic.ttf", fontBytes), weight: "400", style: "normal", subsets: ["synthetic"], languages: ["und"], license: "synthetic", coverage: { ref: "synthetic:coverage", sha256: "a".repeat(64) } }] };
  const item = { name: "synthetic-face", type: "registry:font", meta: { slot: "themes.font-sans", font } };
  const binding = { slot: "themes.font-sans" as const, element: item.name, version: 1, contentHash: "" };
  const record: SpecimenRecord = { id: `themes.font-sans/${item.name}`, version: 1, kind: "data", payload: { path: "synthetic.json", files: [], raw: "" }, preview: {}, contentHash: "" };
  function update() { Object.assign(record, { payload: { ...record.payload, raw: JSON.stringify(item) } }); Object.assign(record, { contentHash: hash(record.payload.raw) }); binding.contentHash = record.contentHash; }
  update();
  const source: SpecimenRecordSource = { read: async () => record, theme: async () => undefined };
  const readFile = async (path: string) => path.startsWith("fonts/") ? fontBytes : licenseBytes;
  return { fontBytes, licenseBytes, font, item, binding, record, update, options: { bindings: [binding], source, readFile } };
}
describe("native Next local font snapshot", () => {
  it("emits direct native declarations and deterministic content-addressed bytes as an unapproved draft", async () => {
    const f = fixture(), result = await resolveNativeNextFonts(f.options);
    expect(result).toMatchObject({ status: "DRAFT", approved: false, selectionGranted: false, findings: [] });
    expect(result.evidence[0]).toMatchObject({ id: f.record.id, version: 1, contentHash: f.binding.contentHash });
    expect(result.files[0]).toEqual({ path: "src/clossys/fonts.ts", contents: expect.stringContaining("import localFont from 'next/font/local';") });
    expect(result.files[0]!.contents).toContain('"variable":"--font-sans"');
    expect(result.files[0]!.contents).toContain(`./fonts/${hash(f.fontBytes)}.ttf`);
    expect(result.files[0]!.contents).not.toMatch(/next\/font\/google|https?:/);
    expect(result.files.every(file => file.path.startsWith("src/clossys/"))).toBe(true);
    expect(await resolveNativeNextFonts(f.options)).toEqual(result);
    const emitted = result.files.find(file => file.path.endsWith(".ttf"))!.contents;
    f.fontBytes[0] = 99; f.licenseBytes[0] = 99; f.item.meta.font.family = "changed";
    expect(emitted).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.evidence[0]!.font.family).toBe("Synthetic Face");
  });
  it.each(["sans", "heading", "serif", "mono"] as const)("keeps the existing %s role variable", async role => {
    const f = fixture(), slot = `themes.font-${role}` as const;
    f.item.meta.slot = slot; f.update(); Object.assign(f.record, { id: `${slot}/${f.binding.element}` });
    const result = await resolveNativeNextFonts({ ...f.options, bindings: [{ ...f.binding, slot }] });
    expect(result.findings).toEqual([]); expect(result.files[0]!.contents).toContain(`"variable":"--font-${role}"`);
  });
  it.each(["name", "slot", "type"])("rejects a mismatched registry %s", async field => {
    const f = fixture();
    if (field === "name") f.item.name = "different";
    if (field === "slot") f.item.meta.slot = "themes.font-mono";
    if (field === "type") f.item.type = "registry:theme";
    f.update(); const result = await resolveNativeNextFonts(f.options);
    expect(result.files).toEqual([]); expect(result.findings).toHaveLength(1);
  });
  it("does nothing without bindings", async () => {
    const f = fixture();
    for (const bindings of [undefined, []]) {
      const result = await resolveNativeNextFonts({ ...f.options, bindings });
      expect(result).toMatchObject({ findings: [], files: [], evidence: [], approved: false, selectionGranted: false });
    }
  });
  it.each([null, {}, { length: 0 }, "", [null], [{}], [1], new Array(1)].map(bindings => ({ bindings })))("rejects malformed runtime bindings $bindings before provider reads", async ({ bindings }) => {
    const f = fixture(); let reads = 0;
    const result = await resolveNativeNextFonts({ ...f.options, bindings: bindings as unknown as NativeNextFontsOptions["bindings"],
      source: { theme: async () => undefined, read: async () => { reads++; return f.record; } },
      readFile: async () => { reads++; return f.fontBytes; },
    });
    expect(result.files).toEqual([]); expect(result.evidence).toEqual([]);
    expect(result.findings[0]!.code).toBe("NEED"); expect(reads).toBe(0);
  });
  it.each(["slot", "element", "version", "contentHash"] as const)("rejects malformed runtime reference %s", async field => {
    const f = fixture();
    const bindings: unknown = [{ ...f.binding, [field]: null }];
    const result = await resolveNativeNextFonts({ ...f.options, bindings: bindings as NativeNextFontsOptions["bindings"] });
    expect(result.files).toEqual([]); expect(result.findings[0]!.code).toBe("NEED");
  });
  it("contains uncloneable bindings and snapshot exceptions without leaking details", async () => {
    const f = fixture();
    const uncloneable: unknown = [{ ...f.binding, extra: () => undefined }];
    const result = await resolveNativeNextFonts({ ...f.options, bindings: uncloneable as NativeNextFontsOptions["bindings"] });
    expect(result.files).toEqual([]); expect(result.findings[0]!.detail).toBe("font bindings snapshot failed");
    const failed = await resolveNativeNextFonts({ ...f.options, get bindings() { throw new TypeError("/host/private/path"); } });
    expect(failed.files).toEqual([]); expect(failed.findings[0]!.code).toBe("NEED");
    expect(JSON.stringify(failed)).not.toContain("/host/private/path");
  });
  it.each(["id", "version", "contentHash", "raw"] as const)("rejects current candidate %s drift", async field => {
    const f = fixture();
    if (field === "id") Object.assign(f.record, { id: "themes.font-sans/other" });
    if (field === "version") Object.assign(f.record, { version: 2 });
    if (field === "contentHash") Object.assign(f.record, { contentHash: "b".repeat(64) });
    if (field === "raw") Object.assign(f.record, { payload: { ...f.record.payload, raw: f.record.payload.raw + " " } });
    const result = await resolveNativeNextFonts(f.options); expect(result.files).toEqual([]); expect(result.findings[0]!.code).toBe("NEED");
  });
  it.each(["font", "license"])("rejects actual %s byte drift before any output", async kind => {
    const f = fixture(); (kind === "font" ? f.fontBytes : f.licenseBytes)[0] = 99;
    const result = await resolveNativeNextFonts(f.options);
    expect(result.files).toEqual([]); expect(result.findings[0]!.detail).toMatch(/byte digest or length/);
  });
  it.each(["font", "license"])("rejects actual %s byte length drift", async kind => {
    const f = fixture(); f.options.readFile = async path => (path.startsWith("fonts/") === (kind === "font")) ? new Uint8Array([1]) : path.startsWith("fonts/") ? f.fontBytes : f.licenseBytes;
    expect((await resolveNativeNextFonts(f.options)).files).toEqual([]);
  });
  it("requires actual records and local payloads rather than FillDocs or Google provider metadata", async () => {
    const f = fixture();
    for (const replacement of [undefined, { themes: { font: "synthetic" } }]) {
      const result = await resolveNativeNextFonts({ ...f.options, source: { ...f.options.source, read: async () => replacement as unknown as SpecimenRecord } });
      expect(result.files).toEqual([]); expect(result.findings).toHaveLength(1);
    }
    Object.assign(f.item.meta, { font: { provider: "google", family: "Synthetic Face" } }); f.update();
    expect((await resolveNativeNextFonts(f.options)).files).toEqual([]);
  });
  it("rejects duplicate bindings and unsafe descriptors before provider reads", async () => {
    const f = fixture();
    expect((await resolveNativeNextFonts({ ...f.options, bindings: [f.binding, f.binding] })).files).toEqual([]);
    f.font.files[0]!.path = "../synthetic.ttf"; f.update(); let reads = 0;
    const result = await resolveNativeNextFonts({ ...f.options, readFile: async () => { reads++; return f.fontBytes; } });
    expect(result.files).toEqual([]); expect(reads).toBe(0);
  });
  it("allows unique normal and italic styles and deduplicates identical verified content", async () => {
    const f = fixture();
    f.font.files.push({ ...f.font.files[0]!, path: "fonts/italic.ttf", style: "italic" }); f.update();
    const result = await resolveNativeNextFonts(f.options);
    expect(result.findings).toEqual([]);
    expect(result.files.filter(file => file.path.endsWith(".ttf"))).toHaveLength(1);
    expect(result.files.filter(file => file.path.endsWith(".txt"))).toHaveLength(1);
    expect(result.files[0]!.contents).toContain('"style":"normal"');
    expect(result.files[0]!.contents).toContain('"style":"italic"');
  });
  it("rejects Latin and Cyrillic subsets with identical weight/style before asset reads", async () => {
    const f = fixture();
    f.font.files[0]!.subsets = ["latin"]; f.font.files[0]!.languages = ["en"];
    f.font.files.push({ ...f.font.files[0]!, path: "fonts/cyrillic.ttf", subsets: ["cyrillic"], languages: ["ru"] });
    f.update(); let reads = 0;
    const result = await resolveNativeNextFonts({ ...f.options, readFile: async () => { reads++; return f.fontBytes; } });
    expect(result.files).toEqual([]); expect(result.evidence).toEqual([]); expect(reads).toBe(0);
    expect(result.findings[0]).toMatchObject({ code: "NEED", detail: expect.stringContaining("cannot distinguish subsets") });
  });
  it("rejects conflicting same-path descriptors across canonical roles", async () => {
    const first = fixture(), second = fixture(); second.fontBytes[0] = 88;
    second.font.files[0]!.sha256 = hash(second.fontBytes);
    second.font.files[0]!.source = { ...second.font.files[0]!.source, sha256: hash(second.fontBytes) };
    second.item.meta.slot = "themes.font-heading"; second.update();
    Object.assign(second.record, { id: "themes.font-heading/synthetic-face" });
    const result = await resolveNativeNextFonts({ ...first.options,
      bindings: [first.binding, { ...second.binding, slot: "themes.font-heading" }],
      source: { theme: async () => undefined, read: async id => id.startsWith("themes.font-heading/") ? second.record : first.record },
    });
    expect(result.files).toEqual([]); expect(result.findings[0]!.detail).toMatch(/conflicting asset identity/);
  });
  it("reports missing bytes and hides provider exception details", async () => {
    const f = fixture();
    const missing = await resolveNativeNextFonts({ ...f.options, readFile: async () => undefined });
    expect(missing.files).toEqual([]); expect(missing.findings).toHaveLength(1);
    const failed = await resolveNativeNextFonts({ ...f.options, readFile: async () => { throw new TypeError("/host/private/path"); } });
    expect(JSON.stringify(failed)).not.toContain("/host/private/path"); expect(failed.findings).toHaveLength(1);
  });
  it("native template consumes generated variables at the html computation site", () => {
    const layout = readFileSync(new URL("../../templates/site/app/layout.tsx", import.meta.url), "utf8");
    const empty = readFileSync(new URL("../../templates/site/src/clossys/fonts.ts", import.meta.url), "utf8");
    expect(layout).toContain('import { nativeFontVariables } from "../src/clossys/fonts"');
    expect(layout).toMatch(/<html[^>]*className=\{nativeFontVariables\}/);
    expect(empty).toContain("export const nativeFontVariables = '';");
  });
});
