import { createHash } from "node:crypto";
import { parseLocalFontPayload, type LocalFontPayload } from "@clossys/designer/catalog";
import type { SpecimenRecord, SpecimenRecordSource } from "../specimen/types.js";

const roles = { "themes.font-sans": "sans", "themes.font-heading": "heading", "themes.font-serif": "serif", "themes.font-mono": "mono" } as const;
export interface NativeNextFontBinding {
  readonly slot: keyof typeof roles; readonly element: string; readonly version: number; readonly contentHash: string;
}
export interface NativeNextFontsOptions {
  readonly bindings?: readonly NativeNextFontBinding[];
  readonly source: SpecimenRecordSource;
  /** Caller confines this read-only provider to its admitted relative assets. No lookup fallback. */
  readonly readFile: (path: string) => Promise<Uint8Array | undefined>;
}
export interface NativeNextFontsResult {
  readonly status: "DRAFT"; readonly approved: false; readonly selectionGranted: false;
  readonly findings: readonly { readonly code: "NEED"; readonly detail: string }[];
  readonly evidence: readonly { readonly id: string; readonly version: number; readonly contentHash: string; readonly font: LocalFontPayload }[];
  readonly files: readonly { readonly path: string; readonly contents: string | Uint8Array }[];
}
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function object(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function fontSlot(v: unknown): v is keyof typeof roles { return typeof v === "string" && Object.hasOwn(roles, v); }
function fail(message: string): never { throw new TypeError(message); }
/** Resolve exact canonical references into a verified snapshot and direct native Next font declarations. */
export async function resolveNativeNextFonts(options: NativeNextFontsOptions): Promise<NativeNextFontsResult> {
  const base = { status: "DRAFT", approved: false, selectionGranted: false } as const;
  try {
    let input: unknown;
    try { input = structuredClone(options.bindings); } catch { fail("font bindings snapshot failed"); }
    if (input === undefined) return { ...base, findings: [], evidence: [], files: [] };
    if (!Array.isArray(input)) fail("font bindings must be an array");
    const bindings = Array.from(input, (binding: unknown): NativeNextFontBinding => {
      if (!object(binding) || Object.keys(binding).length !== 4 || !fontSlot(binding.slot) || typeof binding.element !== "string" || !/^[a-z0-9][a-z0-9.-]*$/.test(binding.element) || binding.element.includes("..") || typeof binding.version !== "number" || !Number.isSafeInteger(binding.version) || binding.version < 1 || typeof binding.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(binding.contentHash)) fail("valid canonical font reference required");
      return { slot: binding.slot, element: binding.element, version: binding.version, contentHash: binding.contentHash };
    });
    if (!bindings.length) return { ...base, findings: [], evidence: [], files: [] };
    const seen = new Set<string>();
    const evidence: NativeNextFontsResult["evidence"][number][] = [];
    for (const binding of bindings.sort((a, b) => a.slot.localeCompare(b.slot))) {
      if (seen.has(binding.slot)) fail("unique canonical font reference required");
      seen.add(binding.slot);
      const id = `${binding.slot}/${binding.element}`;
      let record: SpecimenRecord | undefined;
      try { record = structuredClone(await options.source.read(id, binding.version)); } catch { fail("canonical font source read failed"); }
      if (!record || record.id !== id || record.version !== binding.version || record.contentHash !== binding.contentHash || sha256(record.payload.raw) !== binding.contentHash) fail(`${id}: canonical candidate identity or hash differs`);
      let item: unknown;
      try { item = JSON.parse(record.payload.raw); } catch { fail("canonical font candidate is not JSON"); }
      if (!object(item) || item.type !== "registry:font" || item.name !== binding.element || !object(item.meta) || item.meta.slot !== binding.slot) fail(`${id}: native registry font required`);
      const font = parseLocalFontPayload(item.meta.font);
      const faces = new Set<string>();
      for (const file of font.files) {
        const face = JSON.stringify([file.weight, file.style]);
        if (faces.has(face)) fail("ambiguous font faces: next/font/local cannot distinguish subsets with the same weight and style");
        faces.add(face);
      }
      evidence.push({ id, version: binding.version, contentHash: binding.contentHash, font });
    }
    const assets = new Map<string, Uint8Array>();
    const reads = new Map<string, { hash: string; bytes: number; snapshot: Uint8Array }>();
    async function asset(descriptor: { path: string; sha256: string; bytes: number; source: { sha256: string } }, target: string): Promise<void> {
      const previous = reads.get(descriptor.path);
      if (previous && (previous.hash !== descriptor.sha256 || previous.bytes !== descriptor.bytes)) fail("conflicting asset identity");
      let supplied = previous?.snapshot;
      if (!supplied) { try { supplied = await options.readFile(descriptor.path); } catch { fail("admitted asset read failed"); } }
      if (!(supplied instanceof Uint8Array)) fail("admitted font or license bytes missing");
      const snapshot = new Uint8Array(supplied);
      if (snapshot.byteLength !== descriptor.bytes || sha256(snapshot) !== descriptor.sha256 || descriptor.source.sha256 !== descriptor.sha256) fail("font or license byte digest or length differs");
      reads.set(descriptor.path, { hash: descriptor.sha256, bytes: descriptor.bytes, snapshot });
      const existing = assets.get(target);
      if (existing && sha256(existing) !== descriptor.sha256) fail("conflicting output bytes");
      assets.set(target, snapshot);
    }
    const fontExtensions = new Map<string, string>();
    const declarations: string[] = [];
    const variables: string[] = [];
    for (const binding of bindings) {
      const row = evidence.find(row => row.id === `${binding.slot}/${binding.element}`);
      if (!row) fail("font snapshot missing");
      const role = roles[binding.slot], name = `${role}Font`;
      for (const license of row.font.licenses) await asset(license, `src/clossys/fonts/licenses/${license.sha256}.txt`);
      const src = [];
      for (const file of row.font.files) {
        const ext = file.path.split(".").at(-1);
        if (!ext) fail("font extension missing");
        if (fontExtensions.has(file.sha256) && fontExtensions.get(file.sha256) !== ext) fail("conflicting font extension for identical bytes");
        fontExtensions.set(file.sha256, ext);
        const filename = `${file.sha256}.${ext}`;
        await asset(file, `src/clossys/fonts/${filename}`);
        src.push({ path: `./fonts/${filename}`, weight: file.weight, style: file.style });
      }
      declarations.push(`const ${name} = localFont(${JSON.stringify({ src, variable: `--font-${role}`, fallback: row.font.fallback, display: "swap" })});`);
      variables.push(`${name}.variable`);
    }
    const module = ["import localFont from 'next/font/local';", ...declarations, `export const nativeFontVariables = [${variables.join(", ")}].join(' ');`, ""].join("\n");
    return { ...base, findings: [], evidence, files: [{ path: "src/clossys/fonts.ts", contents: module }, ...[...assets].sort(([a], [b]) => a.localeCompare(b)).map(([path, contents]) => ({ path, contents }))] };
  } catch (error) {
    return { ...base, findings: [{ code: "NEED", detail: error instanceof TypeError || error instanceof SyntaxError ? error.message : "font source read failed" }], evidence: [], files: [] };
  }
}
