/**
 * What certification reads beyond one candidate, built once per context from the context's records
 * (never from the agent trees directly): the live pins of every agent, the pinned Writer copy, the
 * install paths of pinned Designer files, the step graph and the standards (W2-I's loader).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWriterSlotBody } from "@clossys/writer/slot-body";
import { parseFrontmatter } from "../../records/slot-model/index.js";
import { loadStandards, type Standard } from "../../records/standards.js";
import { installOwners, installPathOf, isObject, liveSlotRecords, registryFiles, slotHomes, type Citation } from "../checks/shared.js";
import type { CandidateRecord, ConstitutionContext, SlotRecord } from "../types.js";

/** The producer package folder (src/ and dist/ both sit three levels below it). */
export const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const GRAPH_PATH = join(PACKAGE_ROOT, "pipeline", "graph.json");

export interface Pinned { readonly slot: SlotRecord; readonly candidate: CandidateRecord }

export interface CertifyEnv {
  readonly root: string;
  /** `<agent>:<slot-id>` → the live slot's pinned candidate (a pin whose sha256 matches its file). */
  readonly pins: ReadonlyMap<string, Pinned>;
  /** Live slot ids by agent. */
  readonly live: ReadonlyMap<string, ReadonlySet<string>>;
  /** Pinned Writer copy (first locale of each slot): key → text. */
  readonly copy: ReadonlyMap<string, string>;
  /** Pinned Writer keys by Writer slot id (every locale). */
  readonly writerKeys: ReadonlyMap<string, ReadonlySet<string>>;
  /** Writer key → the Writer slot whose pinned candidate holds it. */
  readonly keyOwner: ReadonlyMap<string, string>;
  /** Install path → the live Designer slots whose pinned candidate installs a file there. */
  readonly installers: ReadonlyMap<string, readonly string[]>;
  /** Step ids of pipeline/graph.json. */
  readonly steps: ReadonlySet<string>;
  readonly graphSha: string;
  readonly standards: readonly Standard[];
  readonly homes: ReadonlyMap<string, SlotRecord>;
  readonly installOwners: () => ReadonlyMap<string, ReadonlySet<string>>;
}

const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
export const pinKey = (agent: string, id: string) => `${agent}:${id}`;

/** The live, sha-matching pinned candidate of a slot record, if any. */
export function pinnedOf(slot: SlotRecord): CandidateRecord | undefined {
  const pin = slot.pin?.value;
  if (!isObject(pin) || typeof pin.candidate !== "string") return undefined;
  const candidate = slot.candidates.find(item => item.name === pin.candidate);
  return candidate && candidate.sha256 === pin.sha256 ? candidate : undefined;
}

/** Writer records of a strings candidate: `[{locale, id, text?}]`, or the parse error. */
export function writerRecords(candidate: CandidateRecord): { rows: { locale: string; id: string; text?: string }[]; locales: string[] } | { error: string } {
  const parsed = parseFrontmatter(candidate.text);
  if (!parsed.ok) return { error: parsed.message };
  const locales = parsed.value.fields.locales;
  if (!Array.isArray(locales) || !locales.every(item => typeof item === "string")) return { error: "frontmatter locales is not a list of locale tags" };
  try {
    return { locales: locales as string[], rows: parseWriterSlotBody(parsed.value.body, locales as string[]).map(row => ({ locale: row.locale, id: row.record.id, ...(typeof row.record.text === "string" ? { text: row.record.text } : {}) })) };
  } catch (error) { return { error: (error as Error).message }; }
}

function readGraph(): { steps: Set<string>; sha: string } {
  let text = "";
  try { text = readFileSync(GRAPH_PATH, "utf8"); } catch { return { steps: new Set(), sha: "none" }; }
  try {
    const doc = JSON.parse(text) as { nodes?: { id?: unknown }[] };
    return { steps: new Set((doc.nodes ?? []).map(node => node.id).filter((id): id is string => typeof id === "string")), sha: sha(text) };
  } catch { return { steps: new Set(), sha: sha(text) }; }
}

const envs = new WeakMap<ConstitutionContext, CertifyEnv>();
export function certifyEnv(ctx: ConstitutionContext): CertifyEnv {
  const hit = envs.get(ctx);
  if (hit) return hit;
  const pins = new Map<string, Pinned>();
  const live = new Map<string, Set<string>>();
  for (const slot of liveSlotRecords(ctx)) {
    let set = live.get(slot.agent);
    if (!set) live.set(slot.agent, set = new Set());
    set.add(slot.id);
    const candidate = pinnedOf(slot);
    if (candidate) pins.set(pinKey(slot.agent, slot.id), { slot, candidate });
  }
  const copy = new Map<string, string>(), writerKeys = new Map<string, Set<string>>(), keyOwner = new Map<string, string>();
  const installers = new Map<string, string[]>();
  for (const { slot, candidate } of pins.values()) {
    if (slot.agent === "writer") {
      const read = writerRecords(candidate);
      if ("error" in read) continue;
      const keys = new Set<string>();
      for (const row of read.rows) {
        keys.add(row.id);
        if (!keyOwner.has(row.id)) keyOwner.set(row.id, slot.id);
        if (row.locale === read.locales[0] && row.text !== undefined && !copy.has(row.id)) copy.set(row.id, row.text);
      }
      writerKeys.set(slot.id, keys);
    } else if (slot.agent === "designer") {
      for (const file of registryFiles(candidate)) {
        const path = installPathOf(file);
        if (!path) continue;
        const list = installers.get(path) ?? [];
        if (!list.includes(slot.id)) list.push(slot.id);
        installers.set(path, list);
      }
    }
  }
  const graph = readGraph();
  let owners: ReadonlyMap<string, ReadonlySet<string>> | undefined;
  const env: CertifyEnv = {
    root: ctx.root, pins, live, copy, writerKeys, keyOwner, installers, steps: graph.steps, graphSha: graph.sha,
    standards: loadStandards(ctx.root), homes: slotHomes(ctx),
    installOwners: () => (owners ??= installOwners(ctx)),
  };
  envs.set(ctx, env);
  return env;
}

export type { Citation };
