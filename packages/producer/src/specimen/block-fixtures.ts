/**
 * Section and frame contract fixtures (foundry-build-0048 U28), derived by the same
 * `derive contract-fixtures --from-references` mechanism as the component fixtures (reference-fixtures.ts).
 *
 * - The file and export come from the slot's own adopted reference row (src/catalog/slot-contracts/<layer>.json),
 *   restyled to the Designer's selected style, exactly as for components. A block reference with several code
 *   files mounts the file its registry item declares `registry:page` (the block's entry), else the code file
 *   named after the item, else its only code file. The export is the item's PascalCase name, else the
 *   module's default export (`export default function ...`, mounted as `default`), else its only component.
 * - A section's props are its generated props type (src/generated/props/<id>.ts `<Name>Props`): `copy`, typed by
 *   the contract's `copy.fields`, is filled with DRAFT placeholder copy that satisfies the type (every field,
 *   within its `maxLength`); `variant` is declared and left unset.
 * - A frame has no generated props type. It mounts with `children`: one DRAFT placeholder per region the
 *   contract declares (`contract.slots`), naming the section or component the region accepts. The fixture
 *   tree mounts no other slot (the element certifier refuses `$element`), so a declared section is named in
 *   its region's placeholder, never mounted.
 *
 * A slot this cannot determine (retired in place, no adopted reference, no single entry file or export) is a
 * gap with the reason, never a fixture that passes vacuously.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { CONTRACT_FIXTURE_SCHEMA, type ContractFixture } from "../records/slot-model/contract-fixture.js";

/** The derivation's data for sections and frames, in one table. */
export const BLOCK_FIXTURE_RULES = {
  draft: "DRAFT",
  section: { props: ["copy", "variant"], filled: "copy" },
  frame: { props: ["children"] },
  entryType: "registry:page",
  retired: "retired in place (src/catalog/retired.json): not live, so no fixture is derived",
} as const;

export interface CopyField { readonly key: string; readonly role?: string; readonly required?: boolean; readonly maxLength?: Readonly<Record<string, number>> }
export interface FrameRegion { readonly id: string; readonly required?: boolean; readonly accepts?: string }

const CODE = /\.(?:tsx|ts|jsx|js)$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const pascal = (name: string) => name.split(/[-.]/).filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join("");

/** Whether a module has a default export (`export default ...` or `export { X as default }`). */
export function hasDefaultExport(source: string): boolean {
  return /export\s+default\s/.test(source) || /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(source);
}

/** One DRAFT placeholder string: the role (or the key's last part), within the field's English maxLength. */
export function draftText(field: CopyField): string {
  const last = field.key.split(".").pop()!.replace(/\[\]$/, "");
  const text = `${BLOCK_FIXTURE_RULES.draft} ${field.role ?? last}`;
  const max = field.maxLength?.en;
  return typeof max === "number" && max > 0 && text.length > max ? text.slice(0, max) : text;
}

/**
 * DRAFT copy that satisfies the generated `<Name>Copy` type: dotted keys nest, a `[]` part is an array of one
 * entry, every field (required or not) gets a placeholder. The same key rules as src/generated/props/generate.ts.
 */
export function draftCopy(fields: readonly CopyField[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const field of fields) {
    const parts = field.key.split(".");
    let node: Record<string, unknown> = root;
    parts.forEach((raw, index) => {
      const array = raw.endsWith("[]");
      const name = array ? raw.slice(0, -2) : raw;
      const leaf = index === parts.length - 1;
      if (leaf) {
        if (array) { const list = Array.isArray(node[name]) ? node[name] as unknown[] : []; list.push(draftText(field)); node[name] = list; }
        else if (!(name in node)) node[name] = draftText(field);
        return;
      }
      if (array) {
        const list = Array.isArray(node[name]) ? node[name] as Record<string, unknown>[] : [{}];
        node[name] = list;
        node = list[0]!;
      } else {
        if (!object(node[name])) node[name] = {};
        node = node[name] as Record<string, unknown>;
      }
    });
  }
  return root;
}

/** Why `copy` does not satisfy the contract's copy fields: a required field unset or empty, or a key no field declares. */
export function draftCopyIssues(fields: readonly CopyField[], copy: unknown): string[] {
  if (!object(copy)) return ["props.copy must be an object"];
  const issues: string[] = [];
  const leaves = new Map<string, unknown[]>();
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) { for (const item of value) if (object(item)) walk(item, `${path}[]`); else leaves.set(`${path}[]`, [...(leaves.get(`${path}[]`) ?? []), item]); return; }
    if (object(value)) { for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key); return; }
    leaves.set(path, [...(leaves.get(path) ?? []), value]);
  };
  walk(copy, "");
  const declared = new Set(fields.map(field => field.key));
  for (const key of leaves.keys()) if (!declared.has(key)) issues.push(`props.copy sets ${key}, which no contract copy field declares`);
  for (const [key, values] of leaves) if (values.some(value => typeof value !== "string" || !value)) issues.push(`props.copy ${key} must be non-empty text`);
  for (const field of fields) if (field.required && !leaves.has(field.key)) issues.push(`props.copy is missing the required field ${field.key}`);
  return issues;
}

/** The region placeholders a frame fixture mounts as children, in contract order. */
export function frameChildren(regions: readonly FrameRegion[]): string[] {
  return regions.map(region => `${BLOCK_FIXTURE_RULES.draft} ${region.id}${region.accepts && region.accepts !== "host-node" ? ` (${region.accepts})` : ""}`);
}

/** The props one section or frame contract fixture sets, from its contract. */
export function blockProps(layer: "sections" | "frames", contract: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (layer === "sections") {
    const copy = object(contract.copy) && Array.isArray(contract.copy.fields) ? contract.copy.fields as CopyField[] : [];
    return { copy: draftCopy(copy) };
  }
  const regions = Array.isArray(contract.slots) ? (contract.slots as unknown[]).filter((slot): slot is FrameRegion => object(slot) && typeof slot.id === "string") : [];
  return { children: frameChildren(regions) };
}

interface ItemFile { readonly path: string }
export interface BlockItem { readonly registry: string; readonly name: string; readonly version: string; readonly dir: string; readonly files?: readonly ItemFile[] }

/** The `registry:page` files the item's own registry JSON declares (its block entry), if it ships one. */
function entryFiles(designerRoot: string, item: BlockItem): Set<string> {
  const doc = (item.files ?? []).find(file => posix.basename(file.path) === `${item.name}.json`);
  const path = doc && join(designerRoot, "references", item.dir, doc.path);
  if (!path || !existsSync(path)) return new Set();
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { files?: { path?: string; type?: string }[] };
  return new Set((parsed.files ?? []).filter(file => file.type === BLOCK_FIXTURE_RULES.entryType && typeof file.path === "string").map(file => file.path!));
}

/**
 * The file and export a block reference item mounts, from the files it ships (`own`: path to value exports,
 * with `default` for a default export), or `{ gap }`.
 */
export function blockMount(designerRoot: string, item: BlockItem, own: ReadonlyMap<string, readonly string[]> | undefined): { file: string; export: string } | { gap: string } {
  const code = (item.files ?? []).filter(file => CODE.test(file.path) && own?.has(file.path));
  const entries = entryFiles(designerRoot, item);
  const main = code.find(file => entries.has(file.path))
    ?? code.find(file => posix.basename(file.path).replace(CODE, "") === item.name)
    ?? (code.length === 1 ? code[0] : undefined);
  if (!main) return { gap: `${item.registry}/${item.name} ships ${code.length} code files and no ${BLOCK_FIXTURE_RULES.entryType} entry or ${item.name} file` };
  const exports = own!.get(main.path) ?? [];
  const root = pascal(item.name);
  if (exports.includes(root)) return { file: main.path, export: root };
  if (exports.includes("default")) return { file: main.path, export: "default" };
  const components = exports.filter(name => /^[A-Z]/.test(name));
  if (components.length === 1) return { file: main.path, export: components[0]! };
  return { gap: `${main.path} has no default export, no ${root} and ${components.length} other components` };
}

/** The contract fixture a section or frame mounts at `file#export`. */
export function blockFixture(layer: "sections" | "frames", contract: Readonly<Record<string, unknown>>, mount: { file: string; export: string }): ContractFixture {
  return { schema: CONTRACT_FIXTURE_SCHEMA, fixtures: { file: mount.file, export: mount.export, props: blockProps(layer, contract) } };
}

/** The props list a section or frame contract declares for its fixture to type against. */
export const blockContractProps = (layer: "sections" | "frames"): string[] => [...(layer === "sections" ? BLOCK_FIXTURE_RULES.section.props : BLOCK_FIXTURE_RULES.frame.props)].sort();
