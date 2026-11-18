/**
 * Certification (R05, slot-constitution.md W2-C). One certifier per slot kind, one entry point for
 * every rung (R03.3): `certify({slot, candidate, contract?}, env)` takes no source kind, rung or seed.
 * A candidate is certified when
 *
 * 1. it is schema-valid for its kind (`validateCandidate`),
 * 2. it fits the slot's contract fixture (the kind certifier: element server render, brief headings
 *    and citations, strings keys and locales, page route, frame, sections and copy, seat step), and
 * 3. the slot names a standard (W2-I's loader) that exists, is well-formed, serves the slot's kind and
 *    whose requirements, extended by the contract's, all pass (`requirementsVerdictSync`).
 *
 * A slot with no standard or no fixture leaves its candidates uncertified (`no-standard`,
 * `no-fixture`); nothing passes by default. Results are cached by the R16.4 key (candidate, standard,
 * contract, pinSet); the certifier version and environment hash sit in the cache header (cache.ts).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { fixtureShapeIssues, validateCandidate, type SlotKind } from "../../records/slot-model/index.js";
import { standardFits, standardFor, targetKindOf } from "../../records/standards.js";
import { AGENT_CRITERIA } from "../criteria/agent-criteria.js";
import { CORE_CRITERIA } from "../criteria/core/index.js";
import { canonicalJson, certifyKey, type CertifyKey } from "../criteria/core/verdict.js";
import { candidateCitations, dependencySet, focusedLiveSlots, isObject, registryFiles, slotDoc, stringList } from "../checks/shared.js";
import type { CandidateRecord, ConstitutionContext, SlotRecord } from "../types.js";
import { cachePath, openCache, type CertifyCache } from "./cache.js";
import { certifyBrief } from "./brief.js";
import { certifyElement, hostRequire } from "./element.js";
import { certifyEnv, pinKey, type CertifyEnv } from "./env.js";
import { certifyPage, certifyPublication } from "./page.js";
import { requirementsVerdictSync } from "./requirements.js";
import { certifySeat } from "./seat.js";
import { certifyLoop, isAgentLoopSlot, loopStandardReasons, loopStandardSha } from "./loop.js";
import { certifyStrings } from "./strings.js";
import { MISSING_RECORD_CODES, reason, type Certification, type CertifyInput, type Reason } from "./types.js";

export * from "./types.js";
export { certifyEnv, type CertifyEnv } from "./env.js";

const KINDS = new Set<SlotKind>(["element", "brief", "strings", "page", "publication", "seat"]);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** slot.json as a record, its kind and its contract. */
export function slotDocOf(slot: SlotRecord): { doc: Record<string, unknown>; kind?: SlotKind; contract: Readonly<Record<string, unknown>> } {
  const doc = slotDoc(slot) ?? {};
  const kind = KINDS.has(doc.kind as SlotKind) ? doc.kind as SlotKind : undefined;
  return { doc, ...(kind ? { kind } : {}), contract: isObject(doc.contract) ? doc.contract : {} };
}

/** Kind fit only (schema, fixture shape, kind certifier): what the dry run measures with no standard. */
export function certifyFit(input: CertifyInput, env: CertifyEnv): Reason[] {
  const { slot, candidate } = input;
  const { kind, contract: own } = slotDocOf(slot);
  const contract = input.contract ?? own;
  // An agent's own loop slot (U9a): its own certifier, against Producer's standard loop.
  if (!kind && isAgentLoopSlot(slot, slotDocOf(slot).doc)) return candidate.readError ? [reason("invalid", candidate.readError)] : certifyLoop(slot, candidate, contract);
  if (!kind) return [reason("invalid", `slot ${slot.id} has no known kind`)];
  if (candidate.readError) return [reason("invalid", candidate.readError)];
  const invalid = validateCandidate(kind, slot.id, candidate.name, candidate.text, candidate.path).map(issue => reason("invalid", issue.message));
  if (invalid.length) return invalid;
  if (kind !== "element" && contract.fixture !== undefined) {
    const shape = fixtureShapeIssues(kind, contract);
    if (shape.length) return shape.map(message => reason("fixture", `contract.fixture ${message}`));
  }
  switch (kind) {
    case "element": return certifyElement(slot, candidate, contract, env);
    case "brief": return certifyBrief(slot, candidate, contract, env);
    case "strings": return certifyStrings(slot, candidate, contract);
    case "page": return certifyPage(slot, candidate, contract, env);
    case "publication": return certifyPublication(slot, candidate, contract);
    case "seat": return certifySeat(slot, candidate, contract, env);
  }
}

/** The standard part: the slot's standard exists, is well-formed, serves the kind, and its requirements pass. */
export function standardReasons(input: CertifyInput, env: CertifyEnv, pinSet: string): Reason[] {
  const { slot, candidate } = input;
  const { doc, kind, contract: own } = slotDocOf(slot);
  const contract = input.contract ?? own;
  if (!kind && isAgentLoopSlot(slot, doc)) return loopStandardReasons(slot, doc);
  const id = typeof doc.standard === "string" ? doc.standard : undefined;
  if (!id) return [reason("no-standard", `slot ${slot.id} names no standard (slot.json standard)`)];
  const standard = standardFor(env.standards, slot.agent, id);
  if (!standard) return [reason("standard", `standard ${id} does not exist under packages/${slot.agent}/standards/`)];
  if (!standard.doc || standard.issues.length) return [reason("standard", `standard ${id} is not well-formed${standard.issues.length ? `: ${standard.issues[0]}` : ""}`)];
  if (!kind || !standardFits(standard.doc, kind, contract, targetKindOf(slot.slot?.value))) return [reason("standard", `standard ${id} serves ${standard.doc.kinds.join(", ")}, not this slot's kind`)];
  const verdict = requirementsVerdictSync({ candidate: { name: candidate.name, bytes: candidate.text }, kind, standard: { id, sha256: standard.sha256, requirements: standard.doc.requirements }, contract, pinSet });
  return verdict.results.filter(result => !result.pass).map(result => reason("requirement", `${result.check}: ${result.failures[0] ?? "fails"}`));
}

/** Certify one candidate (no cache). `pinSet` defaults to the one `pinSetOf` computes. */
export function certify(input: CertifyInput, env: CertifyEnv, pinSet = pinSetOf(input, env)): Certification {
  const reasons = [...certifyFit(input, env), ...standardReasons(input, env, pinSet)];
  return { certified: reasons.length === 0, reasons };
}

/** `@/` import targets of registry files. */
const ALIAS_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']@\/([^"']+)["']/g;
const SUFFIXES = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".css", ".json", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
const aliasMemo = new WeakMap<CertifyEnv, Map<string, readonly string[]>>();
/** The pinned Designer slots a candidate's `@/` imports reach, transitively through pinned payloads. */
function aliasSlots(candidate: CandidateRecord, env: CertifyEnv): string[] {
  let memo = aliasMemo.get(env);
  if (!memo) aliasMemo.set(env, memo = new Map());
  const direct = (item: CandidateRecord): string[] => {
    const out = new Set<string>();
    for (const file of registryFiles(item)) for (const match of file.content.matchAll(ALIAS_IMPORT)) {
      for (const suffix of SUFFIXES) for (const slot of env.installers.get(`${match[1]}${suffix}`) ?? []) out.add(slot);
    }
    return [...out];
  };
  const seen = new Set<string>();
  const queue = direct(candidate);
  while (queue.length) {
    const slot = queue.shift()!;
    if (seen.has(slot)) continue;
    seen.add(slot);
    let next = memo.get(slot);
    if (!next) { const pinned = env.pins.get(pinKey("designer", slot)); memo.set(slot, next = pinned ? direct(pinned.candidate) : []); }
    queue.push(...next);
  }
  return [...seen].sort();
}

/** Copy keys a value names as `{ "$copy": key }`. */
function copyKeysOf(value: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(value)) for (const item of value) copyKeysOf(item, out);
  else if (isObject(value)) {
    if (typeof value.$copy === "string") out.add(value.$copy);
    for (const item of Object.values(value)) copyKeysOf(item, out);
  }
  return out;
}

/**
 * The pinSet field of the certify key: a hash of the slot identity (agent, id, kind, inputs, uses,
 * standard id) and of every pin the certifier may read, `<slot>=<pin sha>|none`: the dependency set,
 * the slots the fixture or page names, the owners of the copy keys it reads, the installers its `@/`
 * imports reach. It is recomputed every run, so a pin that changes, appears or disappears changes it.
 */
export function pinSetOf(input: CertifyInput, env: CertifyEnv): string {
  const { slot, candidate } = input;
  const { doc, kind, contract: own } = slotDocOf(slot);
  const contract = input.contract ?? own;
  const reads = new Set<string>([...(dependencySet(slot) ?? [])]);
  const copy = new Set<string>();
  const fixture = isObject(contract.fixture) ? contract.fixture : undefined;
  if (kind === "element") {
    if (fixture && isObject(fixture.inputs)) {
      for (const id of stringList(fixture.inputs.slots)) reads.add(id);
      for (const key of stringList(fixture.inputs.copy)) copy.add(key);
    }
    if (fixture && isObject(fixture.fixtures)) copyKeysOf(fixture.fixtures.props, copy);
    for (const id of aliasSlots(candidate, env)) reads.add(id);
  }
  if ((kind === "page" || kind === "publication") && isObject(candidate.json)) {
    const page = candidate.json;
    if (typeof page.frame === "string") reads.add(page.frame);
    for (const section of stringList(page.sections)) reads.add(section.split("#")[0]!);
    const refs = (value: unknown) => (isObject(value) ? Object.values(value).filter((ref): ref is string => typeof ref === "string") : []);
    for (const ref of [...refs(page.copy), ...(isObject(page.bindings) ? Object.values(page.bindings).flatMap(binding => (isObject(binding) ? refs(binding.copy) : [])) : [])]) reads.add(ref.split("#")[0]!);
  }
  if (kind === "brief") for (const cite of candidateCitations(slot, candidate, env.homes, env.installOwners())) for (const id of cite.slots) reads.add(id);
  // A slot pinned per record (a Writer pin map) reads as the sha256 of every pinned record, in record order.
  const shaOf = (agent: string, id: string): string | undefined => {
    const pinned = env.pins.get(pinKey(agent, id));
    if (pinned) return pinned.candidate.sha256;
    const records = env.recordPins.get(pinKey(agent, id));
    return records?.length ? records.map(item => item.sha256).join("+") : undefined;
  };
  const pinOf = (id: string) => {
    const agent = env.homes.get(id)?.agent;
    return `${id}=${(agent ? shaOf(agent, id) : undefined) ?? "none"}`;
  };
  const copyOf = (key: string) => {
    const owner = env.keyOwner.get(key);
    const pinned = owner ? shaOf("writer", owner) : undefined;
    return `#${key}=${owner && pinned ? `${owner}@${pinned}` : "none"}`;
  };
  return sha(canonicalJson({
    slot: `${slot.agent}/${slot.id}`, kind: kind ?? null, inputs: stringList(doc.inputs), uses: stringList(doc.uses),
    standard: typeof doc.standard === "string" ? doc.standard : null,
    // An agent loop's verdict reads Producer's standard loop it extends (a changed standard re-verdicts it).
    ...(!kind && isAgentLoopSlot(slot, doc) ? { loopStandard: loopStandardSha(slot.id) } : {}),
    reads: [...[...reads].sort().map(pinOf), ...[...copy].sort().map(copyOf)],
  }));
}

/** The certifier's version: a hash of its own source modules and every criteria module and registry (so editing a certifier or a criterion drops the cache). */
const HERE = dirname(fileURLToPath(import.meta.url));
const CRITERIA_DIR = join(HERE, "..", "criteria");
let ownVersion: string | undefined;
function hashModules(hash: ReturnType<typeof createHash>, dir: string, label: string): void {
  let names: string[];
  try { names = readdirSync(dir).sort(); } catch { return; }
  for (const name of names) {
    const path = join(dir, name);
    if (name === "__fixtures__") continue;
    if (statSync(path).isDirectory()) { hashModules(hash, path, `${label}${name}/`); continue; }
    if (!/\.(?:ts|js|json)$/.test(name) || /\.(?:test|world)\.|\.d\.ts$|\.map$/.test(name)) continue;
    hash.update(`${label}${name}`).update("\0").update(readFileSync(path));
  }
}
export function certifierVersion(): string {
  if (ownVersion) return ownVersion;
  const hash = createHash("sha256");
  for (const name of readdirSync(HERE).sort()) {
    if (!/\.(?:ts|js)$/.test(name) || /\.(?:test|world)\.|\.d\.ts$/.test(name)) continue;
    hash.update(name).update("\0").update(readFileSync(join(HERE, name)));
  }
  hashModules(hash, CRITERIA_DIR, "criteria/");
  return (ownVersion = hash.digest("hex"));
}

/** The environment the cache header pins: TypeScript, React, the lock, the step graph, the registered (core and agent) criteria. */
export function certifyEnvHash(env: CertifyEnv): string {
  let react = "none";
  try { react = (hostRequire(env.root)("react/package.json") as { version?: string }).version ?? "none"; } catch { /* no react */ }
  let lock = "none";
  try { lock = sha(readFileSync(join(env.root, "package-lock.json"), "utf8")); } catch { /* no lock */ }
  return sha(canonicalJson({ typescript: ts.version, react, lock, graph: env.graphSha, criteria: [...Object.keys(CORE_CRITERIA), ...Object.keys(AGENT_CRITERIA)].sort() }));
}

export interface CertifiedCandidate {
  readonly slot: SlotRecord;
  readonly candidate: CandidateRecord;
  readonly key: CertifyKey;
  readonly certification: Certification;
}

export interface CertifyWorld {
  /** `<agent>:<slot-id>/<candidate>` → its certification, for every candidate of every live slot. */
  readonly results: ReadonlyMap<string, CertifiedCandidate>;
  readonly hits: number;
  readonly misses: number;
}

export interface CertifyWorldOptions {
  /** The cache file; `false` for an in-memory cache. Default: node_modules/.cache/clossys/certify.json under the root when node_modules exists. */
  readonly cache?: string | false;
}

export const resultKey = (agent: string, slot: string, candidate: string) => `${agent}:${slot}/${candidate}`;

const worlds = new WeakMap<ConstitutionContext, CertifyWorld>();
/** Every live candidate (of the focused slots, under a focus) certified once per context, through the cache. */
export function certifyWorld(ctx: ConstitutionContext, options: CertifyWorldOptions = {}): CertifyWorld {
  const hit = worlds.get(ctx);
  if (hit) return hit;
  const env = certifyEnv(ctx);
  const path = options.cache === false ? undefined : options.cache ?? (existsSync(join(ctx.root, "node_modules")) ? cachePath(ctx.root) : undefined);
  const cache: CertifyCache = openCache(path, certifierVersion(), certifyEnvHash(env));
  const results = new Map<string, CertifiedCandidate>();
  for (const slot of focusedLiveSlots(ctx)) {
    const { doc, kind, contract } = slotDocOf(slot);
    const standard = typeof doc.standard === "string" ? standardFor(env.standards, slot.agent, doc.standard) : undefined;
    for (const candidate of slot.candidates) {
      const input: CertifyInput = { slot, candidate };
      const pinSet = pinSetOf(input, env);
      const key = certifyKey({ candidate: { name: candidate.name, bytes: candidate.text }, kind: kind ?? "unknown", standard: { id: standard?.id ?? "none", sha256: standard?.sha256 ?? "none", requirements: [] }, contract, pinSet });
      let certification = cache.get(key);
      if (!certification) { certification = certify(input, env, pinSet); cache.set(key, certification); }
      results.set(resultKey(slot.agent, slot.id, candidate.name), { slot, candidate, key, certification });
    }
  }
  try { cache.save(); } catch { /* a read-only tree keeps the in-memory results */ }
  const world: CertifyWorld = { results, hits: cache.hits, misses: cache.misses };
  worlds.set(ctx, world);
  return world;
}

/** Whether every reason is a missing slot record (no standard, no fixture) rather than a fit failure. */
export const onlyMissingRecords = (reasons: readonly Reason[]) => reasons.every(item => MISSING_RECORD_CODES.has(item.code));
