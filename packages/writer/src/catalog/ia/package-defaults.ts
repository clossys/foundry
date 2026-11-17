import { readFileSync, readdirSync } from "node:fs";

import type { GroupTree } from "./target.js";

/**
 * Package defaults outside Voice (foundry-build-0033): every Page metadata slot ships one draft `<record>-v1.json`
 * whose fields match the slot's contract and budgets, and `narratives.legal-document` ships one draft Markdown
 * template per contract type whose `### <purpose>` headings follow the contract and whose bindings are only
 * `{brand}` or a declared `{fact:<id>}`. Drafts await owner approval; a consumer Writer run replaces them.
 */
export interface PackageDefault { slot: string; name: string; text: string }
export interface PackageDefaultFinding { slot: string; message: string }

const NAME = /^([a-z0-9][a-z0-9.-]*)-v([1-9][0-9]*)\.(md|json)$/;
const META_SLOT = /^(?:page|publication)\.[a-z0-9]+(?:-[a-z0-9]+)*\.meta$/;
const LEGAL_SLOT = "narratives.legal-document";

/** Reads every non-Voice package default under `defaults/`. */
export function loadPackageDefaults(root = new URL("../../../defaults/", import.meta.url)): PackageDefault[] {
  const out: PackageDefault[] = [];
  for (const slot of readdirSync(root).filter(name => !name.startsWith("lexicon.")).sort()) {
    for (const name of readdirSync(new URL(`${slot}/`, root)).sort()) {
      out.push({ slot, name, text: readFileSync(new URL(`${slot}/${name}`, root), "utf8") });
    }
  }
  return out;
}

interface MetaField { key: string; maxLength?: number | Record<string, number>; required?: boolean }
interface SlotLike { id: string; contract?: Record<string, unknown> }

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Checks the package defaults against the Copy and Prose trees. */
export function checkPackageDefaults(trees: readonly GroupTree[], defaults: readonly PackageDefault[]): PackageDefaultFinding[] {
  const findings: PackageDefaultFinding[] = [];
  const copy = (trees.find(tree => tree.group === "copy")?.slots ?? []) as SlotLike[];
  const prose = (trees.find(tree => tree.group === "prose")?.slots ?? []) as SlotLike[];
  const metaSlots = new Map(copy.filter(slot => META_SLOT.test(slot.id)).map(slot => [slot.id, slot]));
  const legal = prose.find(slot => slot.id === LEGAL_SLOT);
  const bySlot = new Map<string, PackageDefault[]>();
  for (const entry of defaults) {
    const fail = (message: string) => { findings.push({ slot: entry.slot, message: `${entry.slot}/${entry.name} ${message}` }); };
    if (!NAME.test(entry.name)) { fail("is not named <name>-vN.(md|json)"); continue; }
    if (!metaSlots.has(entry.slot) && entry.slot !== LEGAL_SLOT) { fail("is a package default for a slot the Writer trees do not hold"); continue; }
    bySlot.set(entry.slot, [...(bySlot.get(entry.slot) ?? []), entry]);
  }
  for (const [id, slot] of metaSlots) {
    const own = bySlot.get(id) ?? [];
    const fail = (message: string) => { findings.push({ slot: id, message: `${id} ${message}` }); };
    const only = own.length === 1 ? own[0] : undefined;
    if (!only) { fail(`needs exactly one package default, found ${own.length}`); continue; }
    checkMetaDefault(slot, only, fail);
  }
  if (legal) {
    const own = bySlot.get(LEGAL_SLOT) ?? [];
    for (const type of Object.keys(isObj(legal.contract?.purposes) ? legal.contract.purposes : {})) {
      const files = own.filter(entry => entry.name === `${type}-v1.md`);
      const file = files.length === 1 ? files[0] : undefined;
      if (!file) findings.push({ slot: LEGAL_SLOT, message: `${LEGAL_SLOT} needs a ${type}-v1.md package default` });
      else checkLegalDefault(legal, type, file, message => findings.push({ slot: LEGAL_SLOT, message: `${LEGAL_SLOT}/${file.name} ${message}` }));
    }
  }
  return findings;
}

function checkMetaDefault(slot: SlotLike, entry: PackageDefault, fail: (message: string) => void): void {
  const record = `${slot.id.split(".")[1]}.meta`;
  let candidate: unknown;
  try { candidate = JSON.parse(entry.text); } catch { fail(`${entry.name} is not JSON`); return; }
  if (!isObj(candidate) || !isObj(candidate.clossys) || !isObj(candidate.content)) { fail(`${entry.name} needs clossys and content`); return; }
  const head = candidate.clossys;
  if (head.status !== "draft") fail(`${entry.name} must be status draft until the owner approves it`);
  if (head.slot !== `writer/${slot.id}`) fail(`${entry.name} names slot ${String(head.slot)}`);
  if (head.record !== record) fail(`${entry.name} names record ${String(head.record)}, expected ${record}`);
  if (entry.name !== `${record}-v1.json`) fail(`${entry.name} should be ${record}-v1.json`);
  const copy = isObj(slot.contract?.copy) ? slot.contract.copy : {};
  const declared = (Array.isArray(copy.fields) ? copy.fields : []) as MetaField[];
  const fields = isObj(candidate.content.fields) ? candidate.content.fields : {};
  const keys = new Set(declared.map(field => field.key));
  for (const key of Object.keys(fields)) if (!keys.has(key)) fail(`${entry.name} has field ${key}, which the contract does not declare`);
  for (const field of declared) {
    const value = fields[field.key];
    if (value === undefined) { if (field.required) fail(`${entry.name} is missing required field ${field.key}`); continue; }
    const en = isObj(value) ? value.en : undefined;
    if (typeof en !== "string" || !en.trim()) { fail(`${entry.name} field ${field.key} needs an en string`); continue; }
    const budget = typeof field.maxLength === "number" ? field.maxLength : field.maxLength?.en;
    if (budget === undefined) fail(`${entry.name} field ${field.key} has no en length budget in the contract`);
    else if (en.length > budget) fail(`${entry.name} field ${field.key} is ${en.length} characters, over ${budget}`);
    for (const binding of en.match(/\{[^}]*\}/g) ?? []) if (binding !== "{brand}") fail(`${entry.name} field ${field.key} binds ${binding}; copy binds only {brand}`);
  }
}

function checkLegalDefault(slot: SlotLike, type: string, entry: PackageDefault, fail: (message: string) => void): void {
  const front = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(entry.text);
  const head = front?.[1];
  const body = front?.[2];
  if (head === undefined || body === undefined) { fail("has no front matter"); return; }
  const value = (key: string) => new RegExp(`^  ${key}: "([^"]*)"$`, "m").exec(head)?.[1];
  if (value("status") !== "draft") fail("must be status draft until the owner approves it");
  if (value("slot") !== `writer/${LEGAL_SLOT}`) fail(`names slot ${String(value("slot"))}`);
  if (value("record") !== type) fail(`names record ${String(value("record"))}, expected ${type}`);
  const purposes = ((slot.contract?.purposes as Record<string, string[]>)[type] ?? []);
  const facts = new Set(((isObj(slot.contract?.facts) ? slot.contract.facts[type] : undefined) as string[] | undefined) ?? []);
  const en = /(?:^|\n)## en\n([\s\S]*?)(?=\n## |\s*$)/.exec(body)?.[1];
  if (en === undefined) { fail("has no ## en section"); return; }
  const headings = [...en.matchAll(/^### (.+)$/gm)].map(match => (match[1] ?? "").trim());
  if (headings.join(",") !== purposes.join(",")) fail(`has purposes [${headings.join(", ")}], the contract lists [${purposes.join(", ")}]`);
  const bound = new Set<string>();
  for (const binding of en.match(/\{[^}]*\}/g) ?? []) {
    if (binding === "{brand}") continue;
    const fact = /^\{fact:([a-z0-9.]+)\}$/.exec(binding)?.[1];
    if (!fact || !facts.has(fact)) fail(`binds ${binding}, which is neither {brand} nor a declared ${type} fact`);
    else bound.add(fact);
  }
  for (const fact of facts) if (!bound.has(fact)) fail(`never binds declared fact ${fact}`);
}
