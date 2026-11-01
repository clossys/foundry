import { posix } from "node:path";
import type { SpecimenRecord, SpecimenRecordSource } from "../specimen/types.js";
import { bindPage, isBlocking, resolvePage } from "./index.js";
import type { BindOptions, BoundPage, InstallFinding, InstallOptions, InstallPin, InstallPins } from "./index.js";

/** A current record admitted by the consumer, independently of production pins. */
export interface NativeNextDraftCandidate extends InstallPin { readonly contentHash: string }
export interface NativeNextDraftOptions {
  /** Native page input; its admission and provenance remain the caller's responsibility. */
  readonly page: InstallOptions["page"];
  readonly candidates: Readonly<Record<string, NativeNextDraftCandidate>>;
  readonly source: SpecimenRecordSource;
  readonly copy: BindOptions["copy"];
  readonly assets?: BindOptions["assets"];
}
type DraftInstall = Omit<InstallOptions, "substrate" | "runner"> & Pick<BindOptions, "copy" | "assets">;
export interface NativeNextDraftResult {
  readonly status: "DRAFT";
  readonly approved: false;
  readonly findings: readonly InstallFinding[];
  readonly page?: BoundPage;
  /** A Client Component for app/page.tsx; selected registry modules must be client-compatible. */
  readonly module?: string;
  /** Pass to installAndBind with the consumer's substrate and real shadcn runner. */
  readonly install?: DraftInstall;
}

/**
 * Resolve current native records, bind Writer copy, and emit a Next App Router draft.
 * Every reachable record is checked before resolution uses it. Installation subsequently
 * reads the verified snapshot, never unchecked replacement bytes. This does not verify
 * page admission, grant approval, write files, or create production pins.
 */
export async function resolveNativeNextDraft(options: NativeNextDraftOptions): Promise<NativeNextDraftResult> {
  const { page, candidates, copy, assets } = structuredClone({
    page: options.page, candidates: options.candidates, copy: options.copy, assets: options.assets,
  });
  const pins: InstallPins = Object.fromEntries(Object.entries(candidates).map(([slot, pin]) => [slot, { element: pin.element, version: pin.version }]));
  const records = new Map<string, SpecimenRecord>();
  const verification: InstallFinding[] = [];
  const checked: SpecimenRecordSource = {
    theme: async () => undefined,
    async read(id, version) {
      const slot = Object.keys(candidates).find(name => `${name}/${candidates[name]!.element}` === id);
      const candidate = slot === undefined ? undefined : candidates[slot];
      if (!candidate || candidate.version !== version || !/^[a-f0-9]{64}$/.test(candidate.contentHash)) {
        verification.push({ code: "hash-mismatch", ...(slot ? { slot } : {}), detail: `${id}: no current candidate with a sha256 content hash` });
        return undefined;
      }
      const record = await options.source.read(id, version);
      if (!record) return undefined;
      if (record.id !== id || record.version !== version || record.contentHash !== candidate.contentHash) {
        verification.push({ code: "hash-mismatch", slot, detail: `${id}@v${version}: source identity or content hash differs from the current candidate` });
        return undefined;
      }
      const snapshot = structuredClone(record);
      records.set(`${id}@${version}`, snapshot);
      return structuredClone(snapshot);
    },
  };
  const resolved = await resolvePage(page, pins, checked);
  const failure = (findings: readonly InstallFinding[]): NativeNextDraftResult => ({ status: "DRAFT", approved: false, findings });
  if (verification.length) return failure(verification);
  if (resolved.findings.some(isBlocking)) return failure(resolved.findings);
  const bound = bindPage({ page, slots: resolved.slots, copy, ...(assets ? { assets } : {}) });
  if (!bound.page || bound.findings.some(isBlocking)) return failure(bound.findings);
  const source: SpecimenRecordSource = {
    theme: async () => undefined,
    async read(id, version) {
      const record = version === undefined
        ? [...records.values()].filter(record => record.id === id).sort((a, b) => b.version - a.version)[0]
        : records.get(`${id}@${version}`);
      return record ? structuredClone(record) : undefined;
    },
  };
  return {
    status: "DRAFT", approved: false, findings: bound.findings, page: bound.page,
    module: nextModule(bound.page), install: { page, pins, source, copy, ...(assets ? { assets } : {}) },
  };
}

/** Same native entry, $element and copyKeys composition used by install-and-bind renderers. */
function nextModule(page: BoundPage): string {
  const slots = [page.frame, ...page.sections, ...page.parts];
  const specifier = (file: string) => {
    const path = posix.relative("app", file).replace(/\.[cm]?[jt]sx?$/, "");
    return path.startsWith(".") ? path : `./${path}`;
  };
  const table = Object.fromEntries(slots.map(slot => [slot.slot, { id: slot.id, export: slot.entry.export, copyKeys: slot.copyKeys, props: slot.props, text: slot.text }]));
  return [
    '"use client";',
    "// DRAFT — unapproved. Generated from admitted native records; install the verified items before use.",
    'import { createElement, type ReactNode } from "react";',
    ...slots.map((slot, index) => `import * as m${index} from ${JSON.stringify(specifier(slot.entry.file))};`),
    `const modules: Record<string, Record<string, any>> = { ${slots.map((slot, index) => `${JSON.stringify(slot.slot)}: m${index}`).join(", ")} };`,
    `const slots: Record<string, { id: string; export?: string; copyKeys?: string; props: Record<string, unknown>; text: Record<string, string> }> = ${JSON.stringify(table, null, 2)};`,
    "function resolve(value: unknown, keyed = false): unknown {",
    "  if (Array.isArray(value)) return value.map(item => resolve(item, true));",
    '  if (!value || typeof value !== "object") return value;',
    "  const node = value as Record<string, unknown>;",
    '  if (typeof node.$element === "string") return mount(node.$element, keyed);',
    "  return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, resolve(item)]));",
    "}",
    "function copyOf(map: unknown, text: Record<string, string>): unknown {",
    '  if (typeof map === "string") return Object.hasOwn(text, map) ? text[map] : "";',
    "  if (Array.isArray(map)) return map.map(item => copyOf(item, text));",
    '  if (map && typeof map === "object") return Object.fromEntries(Object.entries(map).map(([key, item]) => [key, copyOf(item, text)]));',
    "  return map;",
    "}",
    "function mount(name: string, keyed = false): ReactNode {",
    "  const slot = slots[name], mod = modules[name];",
    "  if (!slot || !mod) throw new Error(`native draft: no bound slot ${name}`);",
    '  const component = slot.export ? mod[slot.export] : mod.default ?? Object.values(mod).find(value => typeof value === "function");',
    '  if (!component || (typeof component !== "function" && typeof component !== "object")) throw new Error(`native draft: ${slot.id} exports no component`);',
    "  const props = resolve(slot.props) as Record<string, unknown>;",
    "  if (slot.copyKeys) {",
    '    const map = slot.copyKeys.split(".").reduce<any>((value, key) => value == null ? undefined : value[key], mod);',
    '    if (!map || typeof map !== "object") throw new Error(`native draft: ${slot.id} has no export ${slot.copyKeys}`);',
    "    props.copy = copyOf(map, slot.text);",
    "  }",
    "  return createElement(component, keyed ? { ...props, key: name } : props);",
    "}",
    `export default function Page(): ReactNode { return mount(${JSON.stringify(page.frame.slot)}); }`,
    "",
  ].join("\n");
}
