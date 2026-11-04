/**
 * `clossys migrate copy-keys`: rename a consumer's camelCase copy-port ids to the
 * kebab-case ids the Foundry catalog now declares. Plumbing only: no copy is
 * written or judged.
 *
 * - The mapping is derived from the catalog: a consumer key `page.previousLabel`
 *   becomes `page.previous-label` only when the catalog contract of the same slot
 *   declares `page.previous-label`. A camelCase key the catalog does not declare
 *   in either form is a finding and stays as it is.
 * - Designer and Writer `slot.json`: only `"key": "<id>"` values change.
 * - Writer candidates: only the record id changes, in its `### <id>` heading and
 *   the `"id"` of the meta comment under it. Record text stays byte-identical.
 * - A pin that matched its candidate before the rename is carried to the renamed
 *   bytes (`sha256` only; `pinnedBy` and `at` stay). A pin that already drifted is
 *   left as it is.
 *
 * Deterministic and idempotent: a second run plans no change.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { sha256Hex } from "../records/hash.js";
import { listSlots } from "../records/slots.js";
import { designerIa, writerIa, type FoundrySlot } from "../records/slot-model/foundry-ia.js";
import { candidatesDir, pinFile, slotFile } from "../records/slot-model/layout.js";

export type CopyKeyAgent = "designer" | "writer";
/** Slot id -> the copy keys its catalog contract declares. */
export type CopyKeyCatalog = Readonly<Record<CopyKeyAgent, ReadonlyMap<string, ReadonlySet<string>>>>;

export interface CopyKeyRename { readonly agent: CopyKeyAgent; readonly slot: string; readonly from: string; readonly to: string }
export interface CopyKeyFileChange { readonly path: string; readonly before: string; readonly after: string }
export interface CopyKeyFinding { readonly agent: CopyKeyAgent; readonly slot: string; readonly key: string; readonly message: string }
export interface CopyKeyPlan {
  readonly renames: readonly CopyKeyRename[];
  readonly files: readonly CopyKeyFileChange[];
  /** Pins whose sha256 is carried to renamed candidate bytes. */
  readonly repinned: readonly string[];
  readonly findings: readonly CopyKeyFinding[];
}

const UPPER = /[A-Z]/;
const kebab = (segment: string) => segment.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`);
/** `plans[].priceByInterval[].priceText` -> `plans[].price-by-interval[].price-text`. */
export function kebabCopyKey(key: string): string {
  return key.split(".").map(segment => {
    const [, name = "", arrays = ""] = /^(.*?)((?:\[\])*)$/.exec(segment) ?? [];
    return `${kebab(name)}${arrays}`;
  }).join(".");
}

function copyKeys(contract: unknown): string[] {
  const fields = (contract as { copy?: { fields?: unknown } } | undefined)?.copy?.fields;
  return Array.isArray(fields) ? fields.flatMap(field => typeof field?.key === "string" ? [field.key as string] : []) : [];
}

/** The installed Designer and Writer catalogs' copy keys per slot. */
export function foundryCopyKeyCatalog(): CopyKeyCatalog {
  const index = (slots: ReadonlyMap<string, FoundrySlot>) => new Map([...slots].map(([id, slot]) => [id, new Set(copyKeys(slot.contract))]));
  return { designer: index(designerIa().slots), writer: index(writerIa().slots) };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rewrites only `### <id>` headings and the meta comment's `"id"` under them. */
function renameRecordIds(bytes: string, segments: ReadonlyMap<string, string>): string {
  const renameId = (id: string) => id.split(".").map(segment => segments.get(segment) ?? segment).join(".");
  const lines = bytes.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.startsWith("### ")) continue;
    const id = line.slice(4).trim(), next = renameId(id);
    if (next === id) continue;
    lines[index] = line.replace(id, next);
    const meta = lines[index + 1];
    if (meta !== undefined && /^<!-- .+ -->$/.test(meta)) lines[index + 1] = meta.replace(`"id":${JSON.stringify(id)}`, `"id":${JSON.stringify(next)}`);
  }
  return lines.join("\n");
}

/** Plan the rename for one consumer (`clossys/` folder) against a catalog. Pure apart from reads. */
export function planCopyKeyMigration(consumer: string, catalog: CopyKeyCatalog = foundryCopyKeyCatalog()): CopyKeyPlan {
  const root = join(consumer, "..");
  const rel = (path: string) => relative(root, path).split(sep).join("/");
  const renames: CopyKeyRename[] = [], files: CopyKeyFileChange[] = [], repinned: string[] = [], findings: CopyKeyFinding[] = [];
  for (const agent of ["designer", "writer"] as const) {
    for (const entry of listSlots(consumer, agent)) {
      const path = slotFile(entry.dir);
      if (!existsSync(path)) continue;
      const before = readFileSync(path, "utf8");
      let doc: unknown;
      try { doc = JSON.parse(before); } catch { continue; }
      const declared = catalog[agent].get(entry.id) ?? new Set<string>();
      const segments = new Map<string, string>();
      let after = before;
      for (const key of copyKeys((doc as { contract?: unknown }).contract)) {
        if (!UPPER.test(key) || declared.has(key)) continue;
        const to = kebabCopyKey(key);
        if (!declared.has(to)) { findings.push({ agent, slot: entry.id, key, message: `${agent}/${entry.id}: copy key ${key} has no catalog id (${to} is not declared)` }); continue; }
        renames.push({ agent, slot: entry.id, from: key, to });
        after = after.replace(new RegExp(`("key":\\s*)${escape(JSON.stringify(key))}`, "g"), `$1${JSON.stringify(to)}`);
        key.split(".").forEach((segment, index) => {
          const target = to.split(".")[index]!;
          if (segment !== target) segments.set(segment.replace(/(?:\[\])+$/, ""), target.replace(/(?:\[\])+$/, ""));
        });
      }
      if (after !== before) files.push({ path: rel(path), before, after });
      if (agent !== "writer" || !segments.size) continue;
      for (const name of entry.candidates) {
        const candidate = join(candidatesDir(entry.dir), name);
        const bytes = readFileSync(candidate, "utf8"), renamed = renameRecordIds(bytes, segments);
        if (renamed === bytes) continue;
        files.push({ path: rel(candidate), before: bytes, after: renamed });
        if (entry.pin?.candidate !== name || entry.pin.sha256 !== sha256Hex(bytes)) continue;
        const pinPath = pinFile(entry.dir), pinBytes = readFileSync(pinPath, "utf8");
        const pinAfter = pinBytes.replace(`"sha256": "${entry.pin.sha256}"`, `"sha256": "${sha256Hex(renamed)}"`);
        if (pinAfter === pinBytes) continue;
        files.push({ path: rel(pinPath), before: pinBytes, after: pinAfter });
        repinned.push(`${agent}/${entry.id}`);
      }
    }
  }
  return { renames, files, repinned, findings };
}

/** Write a plan's files. The plan's `before` bytes must still be on disk. */
export function applyCopyKeyMigration(consumer: string, plan: CopyKeyPlan): void {
  const root = join(consumer, "..");
  for (const file of plan.files) if (readFileSync(join(root, file.path), "utf8") !== file.before) throw new Error(`${file.path} changed since the copy-key plan was made`);
  for (const file of plan.files) writeFileSync(join(root, file.path), file.after);
}
