import { posix } from "node:path";
import ts from "typescript";
import type { SpecimenRecord, SpecimenRecordSource } from "../specimen/types.js";
import { bindPage, isBlocking, resolvePage } from "./index.js";
import type { BindOptions, BoundPage, InstallFinding, InstallOptions, InstallPin, InstallPins, ResolvedSlot } from "./index.js";

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
  /** A Server Component for app/page.tsx; installed modules retain their native client boundaries. */
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
  let module: string;
  try { module = nextModule(bound.page, resolved.slots); }
  catch (error) { return failure([...bound.findings, { code: "render-failed", detail: String(error) }]); }
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
    module, install: { page, pins, source, copy, ...(assets ? { assets } : {}) },
  };
}

/** Read finite copy data without executing a module or reflecting on a Next client reference. */
function literal(node: ts.Expression): unknown {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(item => literal(item));
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = Object.create(null);
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw new Error("copyKeys requires literal properties");
      const key = property.name.text;
      if (["__proto__", "constructor", "prototype"].includes(key) || Object.hasOwn(result, key)) throw new Error("copyKeys has an unsafe or duplicate property");
      result[key] = literal(property.initializer);
    }
    return result;
  }
  throw new Error("copyKeys requires nested string, array and object literals");
}

function bindCopy(map: unknown, text: Readonly<Record<string, string>>): unknown {
  if (typeof map === "string") {
    if (!Object.hasOwn(text, map)) throw new Error(`copyKeys names undeclared copy slot ${map}`);
    return text[map];
  }
  if (Array.isArray(map)) return map.map(item => bindCopy(item, text));
  return Object.fromEntries(Object.entries(map as Record<string, unknown>).map(([key, value]) => [key, bindCopy(value, text)]));
}

function nativeBinding(slot: ResolvedSlot): { name: string; copy?: unknown } {
  // resolvePage has already inlined these exact verified bytes in installed-file order.
  const content = JSON.parse(slot.item).files[slot.files.indexOf(slot.entry!.file)].content as string;
  const ast = ts.createSourceFile(slot.entry!.file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if ((ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) throw new Error(`${slot.record.id}: invalid entry syntax`);
  const exported = (node: ts.Node) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const candidates: string[] = [], constants = new Map<string, ts.Expression>();
  const names = new Set<string>();
  let hasDefault = false;
  const defaultExport = () => { if (hasDefault) throw new Error(`${slot.record.id}: duplicate default export`); hasDefault = true; };
  for (const statement of ast.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) defaultExport();
    if (!exported(statement)) continue;
    if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) { defaultExport(); continue; }
    const add = (name: string) => { if (names.has(name)) throw new Error(`${slot.record.id}: duplicate export ${name}`); names.add(name); };
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) { add(statement.name.text); candidates.push(statement.name.text); }
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const name = declaration.name.text; add(name);
      if (!declaration.initializer) continue;
      if (statement.declarationList.flags & ts.NodeFlags.Const) {
        constants.set(name, declaration.initializer);
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) candidates.push(name);
      }
    }
  }
  const name = slot.entry!.export ?? (hasDefault ? "default" : candidates.length === 1 ? candidates[0] : undefined);
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`${slot.record.id}: declare preview.export for the native component`);
  // Source adapters normalize descriptor metadata onto preview; retain that contract
  // even when an older install resolver has not copied it onto ResolvedSlot yet.
  const preview = slot.record.preview;
  const normalized = "copyKeys" in preview && typeof preview.copyKeys === "string" ? preview.copyKeys : undefined;
  if (slot.copyKeys && normalized && slot.copyKeys !== normalized) throw new Error(`${slot.record.id}: conflicting copyKeys metadata`);
  const copyKeys = slot.copyKeys ?? normalized;
  if (!copyKeys) return { name };
  const [root, ...path] = copyKeys.split(".");
  const initializer = constants.get(root!);
  if (!initializer) throw new Error(`${slot.record.id}: copyKeys must name a direct exported const literal`);
  const unchanged = (node: ts.Node): void => {
    if (node === initializer.parent) return;
    if (ts.isIdentifier(node) && node.text === root) throw new Error(`${slot.record.id}: copyKeys has a reference outside its literal declaration`);
    ts.forEachChild(node, unchanged);
  };
  unchanged(ast);
  let map = literal(initializer);
  for (const key of path) {
    if (!map || typeof map !== "object" || !Object.hasOwn(map, key)) throw new Error(`${slot.record.id}: missing copyKeys ${copyKeys}`);
    map = (map as Record<string, unknown>)[key];
  }
  if (!map || typeof map !== "object") throw new Error(`${slot.record.id}: copyKeys must select an object or array`);
  return { name, copy: map };
}

/** Compose on the server; createElement passes native client references through unchanged. */
function nextModule(page: BoundPage, resolved: readonly ResolvedSlot[]): string {
  const slots = [page.frame, ...page.sections, ...page.parts];
  const bindings = slots.map(slot => nativeBinding(resolved.find(item => item.slot === slot.slot)!));
  const specifier = (file: string) => {
    const path = posix.relative("app", file).replace(/\.[cm]?[jt]sx?$/, "");
    return path.startsWith(".") ? path : `./${path}`;
  };
  const table = Object.fromEntries(slots.map((slot, index) => [slot.slot, { props: slot.props, ...(bindings[index]!.copy !== undefined ? { copy: bindCopy(bindings[index]!.copy, slot.text) } : {}) }]));
  return [
    "// DRAFT — unapproved. Generated from admitted native records; install the verified items before use.",
    'import { createElement, type ElementType, type ReactNode } from "react";',
    ...slots.map((slot, index) => `import { ${bindings[index]!.name} as c${index} } from ${JSON.stringify(specifier(slot.entry.file))};`),
    `const components: Record<string, ElementType> = { ${slots.map((slot, index) => `${JSON.stringify(slot.slot)}: c${index}`).join(", ")} };`,
    `const slots: Record<string, { copy?: unknown; props: Record<string, unknown> }> = ${JSON.stringify(table, null, 2)};`,
    "function resolve(value: unknown, keyed = false): unknown {",
    "  if (Array.isArray(value)) return value.map(item => resolve(item, true));",
    '  if (!value || typeof value !== "object") return value;',
    "  const node = value as Record<string, unknown>;",
    '  if (typeof node.$element === "string") return mount(node.$element, keyed);',
    "  return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, resolve(item)]));",
    "}",
    "function mount(name: string, keyed = false): ReactNode {",
    "  const slot = slots[name], component = components[name];",
    "  if (!slot || !component) throw new Error(`native draft: no bound slot ${name}`);",
    "  const props = resolve(slot.props) as Record<string, unknown>;",
    "  if (slot.copy !== undefined) props.copy = slot.copy;",
    "  return createElement(component, keyed ? { ...props, key: name } : props);",
    "}",
    `export default function Page(): ReactNode { return mount(${JSON.stringify(page.frame.slot)}); }`,
    "",
  ].join("\n");
}
