/**
 * Standards (R15, slot-constitution.md sections 3, 5a, 5b): the judge of one slot kind, stored at
 * `packages/<agent>/standards/<id>/` as `requirements.json`, `taste.md`, `exemplars/` and
 * `ledger.json`. This module loads, validates and resolves them. It never reads a recipe (R16.1):
 * recipes live in `records/recipes.ts`, which may read standards, never the reverse.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packagePath } from "../package-path.js";
import { CRITERION_ID } from "../constitution/criteria/core/catalog.js";
import { resolveRequirements, type Requirement } from "../constitution/criteria/core/verdict.js";
import { loadSchema, validateValue } from "../pipeline/schema.js";
import { sha256Hex, treeHash } from "./hash.js";
import { MODEL_AGENTS, type ModelAgent } from "./slot-model/index.js";
import { modelExists, readModelText } from "./slots.js";

export { resolveRequirements, type Requirement };

/** The agents that own standards (every slot agent and the Producer seats). */
export const STANDARD_AGENTS: readonly ModelAgent[] = MODEL_AGENTS;
export const STANDARD_SCHEMA = "clossys.standard/1";
export const STANDARD_FILES = Object.freeze({ requirements: "requirements.json", taste: "taste.md", exemplars: "exemplars", ledger: "ledger.json" });
/** Exemplar counts (R15.6). */
export const EXEMPLARS_MIN = 5, EXEMPLARS_MAX = 12;
/**
 * The license allowlist used when an agent has no `policy.json` `licenses` list (section 5b: MIT,
 * Apache-2.0, CC0, CC-BY with attribution).
 */
export const DEFAULT_LICENSES = Object.freeze(["MIT", "Apache-2.0", "CC0-1.0", "CC-BY-4.0"]);
/** Who may change a standard (R16.3): `clossys standard --by owner|planner`. */
export const STANDARD_AUTHORS = Object.freeze(["owner", "planner"]);

export interface StandardDoc {
  readonly schema: typeof STANDARD_SCHEMA;
  readonly id: string;
  readonly kinds: readonly string[];
  readonly mode: "adopt-first" | "craft";
  readonly craftTier: "high" | "mid";
  readonly seeds: readonly string[];
  readonly createGaps?: readonly string[];
  readonly requirements: readonly Requirement[];
  readonly preview?: { readonly card: CardContract };
}

/**
 * The slot-card preview states every card renders through one shared state component
 * (foundry-feedback-0014 review (e)): loading, not needed, no preview yet, preview failed, not pinned.
 */
export const CARD_STATES = Object.freeze(["loading", "not-needed", "no-preview", "failed", "not-pinned"] as const);
export type CardState = (typeof CARD_STATES)[number];
/** Card render methods: `inline` from candidate data in the card; `frame` a scaled `/__specimen` iframe. */
export const CARD_METHODS = Object.freeze(["inline", "frame"] as const);

/** A standard's `preview.card` (R18.13): how the kind's Studio slot card previews a candidate. */
export interface CardContract {
  readonly method: (typeof CARD_METHODS)[number];
  /** The frame's intrinsic width in px; null for inline (an inline preview has no page to scale). */
  readonly intrinsicWidth: number | null;
  /** Selectors the preview box must contain (R18.15). */
  readonly mustContain: readonly string[];
  readonly states: readonly CardState[];
}

/**
 * The standards whose kinds own Studio slot cards (slot-constitution.md section 5a: 26 slot
 * standards, `seat` after W2-A and WS-2's `section.studio`), by agent. R18.13 requires a
 * `preview.card` of each; a new standard joins this list with its planner line in section 5a.
 */
export const CARD_STANDARDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  director: ["brief.list", "brief.measure", "brief.profile", "brief.statement"],
  designer: [
    "asset.glyph", "asset.logo-mark", "asset.media-rule", "component", "frame", "section.adaptive", "section.app", "section.site",
    "token.color", "token.scale", "token.typeface",
  ],
  writer: [
    "copy.headline", "lexicon.claim-list", "lexicon.format-rule", "lexicon.term-list", "lexicon.voice-rule", "narrative", "passage", "pattern",
    "string",
  ],
  publisher: ["page", "publication"],
  producer: ["section.studio", "seat"],
});

/** One taste criterion of `taste.md`: `## <id>` with anchors `- 1: ...` through `- 5: ...`. */
export interface TasteCriterion { readonly id: string; readonly anchors: Readonly<Partial<Record<1 | 2 | 3 | 4 | 5, string>>> }

export interface ExemplarDoc {
  readonly id: string;
  readonly ref: string;
  readonly source: string;
  readonly license: string;
  readonly description?: string;
  readonly why: Readonly<Record<string, string>>;
}

/** One standard folder as read: its parsed parts, every file's sha256 and the issues reading them. */
export interface Standard {
  readonly agent: ModelAgent;
  readonly id: string;
  /** Workspace-relative folder (`packages/<agent>/standards/<id>`). */
  readonly dir: string;
  readonly doc?: StandardDoc;
  /** The raw requirements.json value, when it parsed. */
  readonly raw?: unknown;
  readonly taste?: { readonly text: string; readonly criteria: readonly TasteCriterion[] };
  readonly exemplars?: readonly ExemplarDoc[];
  /** Files under `exemplars/` other than exemplars.json, folder-relative. */
  readonly exemplarFiles: readonly string[];
  /** Folder-relative path → sha256, ledger.json excluded. */
  readonly files: Readonly<Record<string, string>>;
  /** The standard's sha: the sha256-tree of every file but ledger.json (hex). */
  readonly sha256: string;
  readonly ledger: readonly Record<string, unknown>[];
  /** Read and schema issues (R15.2 shape); policy-aware checks are separate functions. */
  readonly issues: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const posix = (path: string) => path.split("\\").join("/");

/** Every regular file below `dir`, folder-relative posix paths, sorted; symlinks are refused. */
function filesBelow(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`${prefix}${name} is a symbolic link`);
      if (stat.isDirectory()) walk(path, `${prefix}${name}/`);
      else if (stat.isFile()) out.push(`${prefix}${name}`);
    }
  };
  walk(dir, "");
  return out;
}

/** The criteria of a taste.md: each `## <criterion-id>` heading with its `- <1-5>: <anchor>` lines. */
export function parseTaste(text: string): TasteCriterion[] {
  const criteria: { id: string; anchors: Partial<Record<1 | 2 | 3 | 4 | 5, string>> }[] = [];
  let current: (typeof criteria)[number] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+`?([^`\s]+)`?\s*$/.exec(line);
    if (heading) { current = { id: heading[1]!, anchors: {} }; criteria.push(current); continue; }
    if (/^#{1,2}\s/.test(line)) { current = undefined; continue; }
    const anchor = /^\s*[-*]\s*([1-5])\s*[:.)-]\s*(.+?)\s*$/.exec(line);
    if (anchor && current) current.anchors[Number(anchor[1]) as 1 | 2 | 3 | 4 | 5] = anchor[2]!;
  }
  return criteria;
}

/** The events of a ledger value: `{events: []}` (W2-B) or a bare array. */
export function ledgerEvents(value: unknown): Record<string, unknown>[] {
  const events = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.events) ? value.events : [];
  return events.filter(isRecord);
}

/** Reads one standard folder. `root` is the workspace (repository) root. */
export function readStandard(root: string, agent: ModelAgent, id: string): Standard {
  const dir = posix(join("packages", agent, "standards", id));
  const abs = packagePath(root, dir);
  const issues: string[] = [];
  let names: string[] = [];
  try { names = filesBelow(abs); } catch (error) { issues.push((error as Error).message); }
  const files: Record<string, string> = {};
  const texts = new Map<string, string>();
  for (const name of names) {
    const bytes = readFileSync(join(abs, name));
    texts.set(name, bytes.toString("utf8"));
    if (name !== STANDARD_FILES.ledger) files[name] = sha256Hex(bytes);
  }
  const sha256 = treeHash(Object.entries(files).map(([path, sha]) => ({ path, sha256: sha }))).replace(/^sha256:/, "");

  let raw: unknown, doc: StandardDoc | undefined;
  const requirements = texts.get(STANDARD_FILES.requirements);
  if (requirements === undefined) issues.push("no requirements.json");
  else {
    try { raw = JSON.parse(requirements); } catch (error) { issues.push(`requirements.json: ${(error as Error).message}`); }
    if (raw !== undefined) {
      const schemaIssues = validateValue(raw, loadSchema("standard"));
      for (const issue of schemaIssues) issues.push(`requirements.json${issue.path ? ` ${issue.path}` : ""}: ${issue.message}`);
      if (isRecord(raw) && raw.id !== id) issues.push(`requirements.json id ${JSON.stringify(raw.id)} is not the folder name ${id}`);
      if (!schemaIssues.length) {
        doc = raw as StandardDoc;
        for (const issue of cardContractIssues(doc.preview?.card)) issues.push(`requirements.json /preview/card: ${issue}`);
      }
    }
  }

  const tasteText = texts.get(STANDARD_FILES.taste);
  if (tasteText === undefined) issues.push("no taste.md");
  const taste = tasteText === undefined ? undefined : { text: tasteText, criteria: parseTaste(tasteText) };

  let exemplars: ExemplarDoc[] | undefined;
  const exemplarFiles = names.filter(name => name.startsWith(`${STANDARD_FILES.exemplars}/`) && name !== "exemplars/exemplars.json").map(name => name.slice("exemplars/".length));
  if (!names.some(name => name.startsWith("exemplars/"))) issues.push("no exemplars/ folder");
  const exemplarText = texts.get("exemplars/exemplars.json");
  if (exemplarText === undefined) { if (names.some(name => name.startsWith("exemplars/"))) issues.push("no exemplars/exemplars.json"); }
  else {
    try {
      const value = JSON.parse(exemplarText) as unknown;
      const schemaIssues = validateValue(value, loadSchema("exemplars"));
      for (const issue of schemaIssues) issues.push(`exemplars.json${issue.path ? ` ${issue.path}` : ""}: ${issue.message}`);
      if (!schemaIssues.length) exemplars = (value as { exemplars: ExemplarDoc[] }).exemplars;
    } catch (error) { issues.push(`exemplars.json: ${(error as Error).message}`); }
  }

  let ledger: Record<string, unknown>[] = [];
  const ledgerText = texts.get(STANDARD_FILES.ledger);
  if (ledgerText !== undefined) {
    try { ledger = ledgerEvents(JSON.parse(ledgerText)); } catch (error) { issues.push(`ledger.json: ${(error as Error).message}`); }
  }
  return { agent, id, dir, ...(doc ? { doc } : {}), ...(raw !== undefined ? { raw } : {}), ...(taste ? { taste } : {}), ...(exemplars ? { exemplars } : {}), exemplarFiles, files, sha256, ledger, issues };
}

/** Every standard of every agent under `root`, by agent then id. */
export function loadStandards(root: string): Standard[] {
  const out: Standard[] = [];
  for (const agent of STANDARD_AGENTS) {
    const base = packagePath(root, `packages/${agent}/standards`);
    if (!existsSync(base)) continue;
    for (const id of readdirSync(base).sort()) {
      if (id.startsWith(".")) continue;
      const stat = lstatSync(join(base, id));
      if (stat.isDirectory() && !stat.isSymbolicLink()) out.push(readStandard(root, agent, id));
    }
  }
  return out;
}

/** The standard a slot names, looked up in the slot's own agent (a standard serves its agent's slots). */
export function standardFor(standards: readonly Standard[], agent: string, id: string): Standard | undefined {
  return standards.find(standard => standard.agent === agent && standard.id === id);
}

/** A slot's kind as a standard matches it: `kind`, or `kind/<contract.kind>` when the contract names one. */
export function slotKinds(kind: string, contract: unknown): string[] {
  const sub = isRecord(contract) && typeof contract.kind === "string" ? contract.kind : undefined;
  return sub ? [`${kind}/${sub}`, kind] : [kind];
}

/** Whether a standard serves a slot of `kind` with `contract` (R15.1): one of its kinds is the slot's kind or kind/sub. */
export function standardFits(doc: Pick<StandardDoc, "kinds">, kind: string, contract: unknown): boolean {
  const wanted = slotKinds(kind, contract);
  return doc.kinds.some(entry => wanted.includes(entry));
}

/** The agent policy fields the standards read (`clossys/agents/<agent>/policy.json`). */
export interface StandardPolicy { readonly licenses?: readonly string[]; readonly seedRegistries?: readonly string[]; readonly error?: string }

/**
 * Reads `<consumer>/agents/<agent>/policy.json` for `licenses` and `seedRegistries` through the slot
 * reader; {} when there is none. (policy.schema.json is another unit's; only these two keys are read.)
 */
export function readStandardPolicy(consumer: string, agent: ModelAgent): StandardPolicy {
  const path = join(consumer, "agents", agent, "policy.json");
  if (!modelExists(path)) return {};
  try {
    const value = JSON.parse(readModelText(path)) as unknown;
    if (!isRecord(value)) return { error: "policy.json is not an object" };
    const list = (key: string) => Array.isArray(value[key]) ? (value[key] as unknown[]).filter((item): item is string => typeof item === "string") : undefined;
    const licenses = list("licenses"), seedRegistries = list("seedRegistries");
    return { ...(licenses ? { licenses } : {}), ...(seedRegistries ? { seedRegistries } : {}) };
  } catch (error) { return { error: `policy.json: ${(error as Error).message}` }; }
}

/** R15.3: every requirement names a registered criterion. */
export function requirementIssues(standard: Standard, registered: ReadonlySet<string>): string[] {
  return (standard.doc?.requirements ?? []).filter(item => !registered.has(item.check)).map(item => `requirement ${item.check} is not registered under src/constitution/criteria/*/index.json`);
}

/**
 * R15.4: taste.md names at least one criterion, each anchored 1 to 5; no taste criterion is also a
 * requirement (taste never decides pass/fail), and no taste id is a registered mechanical criterion
 * (a mechanical principle belongs in requirements).
 */
export function tasteIssues(standard: Standard, registered: ReadonlySet<string>): string[] {
  if (!standard.taste) return [];
  const issues: string[] = [];
  if (!standard.taste.criteria.length) issues.push("taste.md names no taste criterion (## <criterion-id>)");
  const required = new Set((standard.doc?.requirements ?? []).map(item => item.check));
  const seen = new Set<string>();
  for (const criterion of standard.taste.criteria) {
    if (!CRITERION_ID.test(criterion.id) && !/^[a-z][a-z0-9-]*$/.test(criterion.id)) issues.push(`taste criterion ${criterion.id} is not an id`);
    if (seen.has(criterion.id)) issues.push(`taste criterion ${criterion.id} is listed twice`);
    seen.add(criterion.id);
    const missing = ([1, 2, 3, 4, 5] as const).filter(score => !criterion.anchors[score]);
    if (missing.length) issues.push(`taste criterion ${criterion.id} has no anchor for ${missing.join(", ")}`);
    if (required.has(criterion.id)) issues.push(`taste criterion ${criterion.id} is also a requirement: taste never decides pass/fail`);
    else if (registered.has(criterion.id)) issues.push(`taste criterion ${criterion.id} is a registered mechanical criterion: list it under requirements`);
  }
  return issues;
}

const isLink = (ref: string) => /^https?:\/\//.test(ref);
/**
 * R15.6: 5-12 exemplars, each `why` keyed to the standard's taste criteria; a stored file only
 * under an allowlisted license; a link carries a description; every stored file is an exemplar's ref.
 */
export function exemplarIssues(standard: Standard, policy: StandardPolicy): string[] {
  if (!standard.exemplars) return [];
  const issues: string[] = [];
  const licenses = new Set(policy.licenses ?? DEFAULT_LICENSES);
  const taste = new Set((standard.taste?.criteria ?? []).map(criterion => criterion.id));
  const count = standard.exemplars.length;
  if (count < EXEMPLARS_MIN || count > EXEMPLARS_MAX) issues.push(`${count} exemplars; a standard holds ${EXEMPLARS_MIN}-${EXEMPLARS_MAX}`);
  const ids = new Set<string>();
  const stored = new Set<string>();
  for (const exemplar of standard.exemplars) {
    if (ids.has(exemplar.id)) issues.push(`exemplar ${exemplar.id} is listed twice`);
    ids.add(exemplar.id);
    const keys = Object.keys(exemplar.why);
    if (!keys.length) issues.push(`exemplar ${exemplar.id} has no why`);
    for (const key of keys) if (!taste.has(key)) issues.push(`exemplar ${exemplar.id} why names ${key}, not a taste criterion of taste.md`);
    if (isLink(exemplar.ref)) {
      if (!exemplar.description) issues.push(`exemplar ${exemplar.id} is a link without a description`);
      continue;
    }
    stored.add(exemplar.ref);
    if (!licenses.has(exemplar.license)) issues.push(`exemplar ${exemplar.id} stores a file under ${exemplar.license}, not an allowlisted license (${[...licenses].join(", ")}): link it instead`);
    if (!standard.exemplarFiles.includes(exemplar.ref)) issues.push(`exemplar ${exemplar.id} ref ${exemplar.ref} is not a file in exemplars/`);
  }
  for (const file of standard.exemplarFiles) if (!stored.has(file)) issues.push(`exemplars/${file} is stored but no exemplar names it`);
  return issues;
}

/**
 * R15.9 (the standard half): only Designer standards list seeds, each from a registry the Designer
 * policy.json allowlists (`<registry>`, `<registry>/<item>` or `<registry>:<item>`).
 */
export function seedIssues(standard: Standard, policy: StandardPolicy): string[] {
  const seeds = standard.doc?.seeds ?? [];
  if (!seeds.length) return [];
  if (standard.agent !== "designer") return [`${standard.agent} standards list no seeds (seeds: [])`];
  if (!policy.seedRegistries) return [`seeds ${seeds.join(", ")} cannot be checked: the designer policy.json lists no seedRegistries`];
  const registries = new Set(policy.seedRegistries);
  return seeds.filter(seed => !registries.has(seed.split(/[/:]/)[0]!)).map(seed => `seed ${seed} is not from a policy.json seed registry (${[...registries].join(", ") || "none"})`);
}

/**
 * The `preview.card` rules the schema cannot express (part of R15.2's validity): a frame names an
 * intrinsic width and an inline preview none; no selector or state is listed twice. [] when absent
 * (absence is R18.13's coverage finding, see cardCoverage).
 */
export function cardContractIssues(card: CardContract | undefined): string[] {
  if (!card) return [];
  const issues: string[] = [];
  if (card.method === "frame" && card.intrinsicWidth === null) issues.push("method frame needs an intrinsicWidth in px");
  if (card.method === "inline" && card.intrinsicWidth !== null) issues.push(`method inline renders from data: intrinsicWidth must be null, not ${card.intrinsicWidth}`);
  const twice = (values: readonly string[]) => values.filter((value, index) => values.indexOf(value) !== index);
  for (const selector of new Set(twice(card.mustContain))) issues.push(`mustContain lists ${selector} twice`);
  for (const state of new Set(twice(card.states))) issues.push(`states lists ${state} twice`);
  return issues;
}

/** One R18.13 coverage finding: a card standard with no valid `preview.card`. */
export interface CardCoverageGap { readonly agent: string; readonly id: string; readonly dir: string; readonly reason: string }

/**
 * R18.13 contract coverage (static): every card standard (CARD_STANDARDS) exists and its
 * requirements.json carries a valid `preview.card`. Returns the gaps, by agent then id; [] is full
 * coverage.
 */
export function cardCoverage(standards: readonly Standard[], expected: Readonly<Record<string, readonly string[]>> = CARD_STANDARDS): CardCoverageGap[] {
  const gaps: CardCoverageGap[] = [];
  for (const [agent, ids] of Object.entries(expected)) {
    for (const id of ids) {
      const dir = `packages/${agent}/standards/${id}`;
      const standard = standards.find(item => item.agent === agent && item.id === id);
      if (!standard) gaps.push({ agent, id, dir, reason: "no standard folder: no preview.card" });
      else if (!standard.doc) gaps.push({ agent, id, dir, reason: "requirements.json is invalid (R15.2): no preview.card read" });
      else if (!standard.doc.preview?.card) gaps.push({ agent, id, dir, reason: "requirements.json has no preview.card" });
      else if (cardContractIssues(standard.doc.preview.card).length) gaps.push({ agent, id, dir, reason: `preview.card is invalid: ${cardContractIssues(standard.doc.preview.card).join("; ")}` });
    }
  }
  return gaps;
}
