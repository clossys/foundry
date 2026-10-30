/**
 * Default component fills from the existing candidate graph. Pure and offline:
 * eligibility is the real component checker over the caller's resolved consumer
 * tokens and assets, never a parallel rule set. Runtime observations are not
 * gathered here, so a default is statically eligible, not runtime-qualified.
 */
import { checkComponentProfile, DEFAULT_COHERENCE_GROUPS, OBSERVATIONS_UNAVAILABLE } from "./check-components.js";
import { componentDescriptorHash, componentOf } from "./resolve-components.js";
import type { ComponentCheckInput, ComponentFinding } from "./check-components.js";
import type { ComponentCandidate, ComponentCatalog } from "./resolve-components.js";
import type { LibraryDecision } from "./library-decisions.js";
import type { SourceBundle } from "./changeset-components.js";
import { isSelectableComponentSource, NON_SELECTABLE_SOURCE_REASON } from "./component-sources.js";

/** Canonical selection policy. Callers may supply their own explicit policy to the planner. */
export const DEFAULT_COMPONENT_PREFERENCE: readonly string[] = ["shadcn@aria", "foundry", "rac-starter"];
/** No built-in exclusive picks: defaults follow preference; consumers may still supply picks or choices. */
export const DEFAULT_COMPONENT_PICKS: Readonly<Record<string, string>> = {};
/** Whole-component fallbacks stay subject to the normal eligibility checker. */
export const DEFAULT_COMPONENT_FALLBACK = { source: "foundry", slots: ["checkbox", "dialog", "popover", "tabs", "toggle-button", "disclosure", "select", "chart-sparkline", "color-picker",
  "number-field", "tag-group", "tree", "calendar", "menu", "table", "card"].map(leaf => `components.${leaf}`) };

export interface ComponentDefaultsInput {
  catalog: ComponentCatalog;
  /** Component leaves to plan, in display order. */
  slots: readonly string[];
  tokens: ComponentCheckInput["tokens"];
  assets: readonly string[];
  installedRac: ComponentCheckInput["installedRac"];
  /** Verified source bundles; a source candidate without one is not executable. */
  bundles: readonly SourceBundle[];
  /** Source order for slots without an owner pick or a choice. Unlisted sources are never defaulted. */
  preference: readonly string[];
  /** Owner decisions: exclusive; an ineligible pick stays unchosen rather than falling back. */
  picks?: Readonly<Record<string, string>>;
  /** Choose: overrides picks and preference, and is equally exclusive. */
  choices?: Readonly<Record<string, string>>;
  /**
   * Whole-component fallback for the listed leaves only: tried after an ineligible
   * owner pick or every preferred source, under the same checker. Never applies to a choice.
   */
  fallback?: { source: string; slots: readonly string[] };
}
export type ComponentDefaultBasis = "choose" | "owner-pick" | "preference" | "fallback" | "rule";
export interface ComponentDefaultRow {
  slot: string;
  status: "chosen" | "default" | "not-chosen";
  basis?: ComponentDefaultBasis;
  source?: string;
  fill?: string;
  rule?: string;
  reasons: readonly string[];
}
export interface ComponentDefaultsPlan {
  rows: readonly ComponentDefaultRow[];
  /** Dependency order: every row's component reads and composition inputs precede it. */
  decisions: readonly LibraryDecision[];
  /** Whole selected set, static findings only; empty for a consistent plan. */
  findings: readonly ComponentFinding[];
}

interface Offer { fill: ComponentCandidate; id: string; basis: ComponentDefaultBasis }

const unique = (values: readonly string[]): string[] => [...new Set(values)];
const SOURCE_PIN_REQUIRED = "Source fill requires commit, file hashes and licence notice";
const describe = (findings: readonly ComponentFinding[]): string => unique(findings.map(finding => `${finding.code} ${finding.message}`)).join("; ");

export function planComponentDefaults(input: ComponentDefaultsInput): ComponentDefaultsPlan {
  const slotIds = new Set(input.catalog.slots.map(slot => slot.id));
  const check = (fills: readonly ComponentCandidate[]): ComponentFinding[] => checkComponentProfile({
    slots: input.catalog.slots, fills, observations: {}, tokens: input.tokens, assets: input.assets, installedRac: input.installedRac,
  }).findings.filter(finding => finding.message !== OBSERVATIONS_UNAVAILABLE && !finding.message.endsWith(`: ${OBSERVATIONS_UNAVAILABLE}`));
  /** A declared dependency on another leaf is closure, settled below; everything else is the candidate's own. */
  const dependency = (fill: ComponentCandidate, finding: ComponentFinding): boolean => {
    const target = /^(?:Composition (\S+) is undeclared or unresolved|Component read (\S+) does not resolve)$/.exec(finding.message);
    const id = target?.[1] ?? target?.[2];
    return !!id && slotIds.has(id) && fill.reads.components.includes(id);
  };
  const bundled = (fill: ComponentCandidate): boolean => fill.impl.kind !== "source" || input.bundles.some(bundle => bundle.slot === fill.slot && bundle.descriptorHash === componentDescriptorHash(fill));

  const reasons = new Map<string, string[]>();
  const offers = new Map<string, Offer[]>();
  for (const slot of input.slots) {
    const docs = input.catalog.fills.filter(doc => {
      const meta = doc.$extensions["com.clossys.fill"];
      return meta.slot === slot && meta.mode === "implementation" && !meta.originKinds?.includes("composed");
    });
    const choice = input.choices?.[slot], pick = input.picks?.[slot];
    const basis: ComponentDefaultBasis = choice ? "choose" : pick ? "owner-pick" : "preference";
    const order = choice ? [choice] : pick ? [pick] : input.preference;
    const fallback = !choice && input.fallback?.slots.includes(slot) ? input.fallback.source : undefined;
    const why: string[] = [];
    const eligible: Offer[] = [];
    const ruled = (input.catalog.rules ?? []).find(rule => rule.kind === "compose" && rule.slot === slot);
    for (const source of fallback && !order.includes(fallback) ? [...order, fallback] : order) {
      const doc = docs.find(candidate => candidate.$extensions["com.clossys.fill"].source === source);
      // A registered composition is its template source's offer for the seat: it outranks every later source.
      if (!doc && ruled?.template.source === source) break;
      if (!doc) { if (basis !== "preference" || source === fallback) why.push(`${source}: no implementation candidate`); continue; }
      if (!isSelectableComponentSource(source)) { why.push(`${source}: ${NON_SELECTABLE_SOURCE_REASON}`); continue; }
      const fill = componentOf(doc);
      if (fill.blockers?.length) { why.push(`${source}: blocked ${unique(fill.blockers.map(blocker => blocker.code)).join(",")}`); continue; }
      if (!bundled(fill)) { why.push(`${source}: no verified source bundle`); continue; }
      const own = check([fill]).filter(finding => finding.subject === slot && !dependency(fill, finding));
      if (own.length) { why.push(`${source}: ${describe(own)}`); continue; }
      eligible.push({ fill, id: doc.$extensions["com.clossys.fill"].id, basis: order.includes(source) ? basis : "fallback" });
    }
    if (basis === "owner-pick" && !eligible.length) why.push(`owner pick ${pick} is not eligible; another source needs the owner's choice`);
    if (basis === "preference" && !docs.length) why.push("no implementation candidate");
    offers.set(slot, eligible);
    reasons.set(slot, why);
  }

  const selected = new Map<string, Offer>();
  for (const [slot, list] of offers) if (list[0]) selected.set(slot, list[0]);
  // Coherence: a group may stay mixed only where the real checker accepts the mix
  // statically. Otherwise the source eligible for the most members leads (ties by
  // preference), members take that source's offer, and the rest stay unchosen.
  // The date group has no static rule; mixing there is settled by runtime evidence.
  for (const group of DEFAULT_COHERENCE_GROUPS.filter(row => row.kind === "controls" || row.kind === "charts")) {
    const members = group.slots.filter(slot => offers.get(slot)?.length);
    const mixed = (): boolean => check(members.flatMap(slot => selected.get(slot) ? [selected.get(slot)!.fill] : [])).some(finding => finding.code === "K11");
    if (!mixed()) continue;
    const locked = members.flatMap(slot => input.choices?.[slot] ?? input.picks?.[slot] ?? []);
    const coverage = (source: string) => members.filter(slot => offers.get(slot)!.some(offer => offer.fill.source === source)).length;
    const rank = (source: string) => { const index = input.preference.indexOf(source); return index < 0 ? input.preference.length : index; };
    const sources = unique(locked.length ? locked : members.flatMap(slot => offers.get(slot)!.map(offer => offer.fill.source)));
    const lead = sources.sort((a, b) => coverage(b) - coverage(a) || rank(a) - rank(b))[0]!;
    for (const slot of members) {
      const offer = offers.get(slot)!.find(candidate => candidate.fill.source === lead);
      if (offer) { selected.set(slot, offer); continue; }
      selected.delete(slot);
      reasons.get(slot)!.push(`${group.id} coherence: one source per group, led by ${lead}; ${unique(offers.get(slot)!.map(candidate => candidate.fill.source)).join(",")} would mix sources`);
    }
  }

  // Registered compositions fill otherwise-unchosen leaves once every input is chosen.
  const composed = new Map<string, { rule: string; inputs: readonly string[] }>();
  // Closure: a leaf whose declared dependencies are unchosen cannot execute.
  for (let changed = true; changed;) {
    changed = false;
    for (const rule of input.catalog.rules ?? []) {
      if (rule.kind !== "compose" || !input.slots.includes(rule.slot) || selected.has(rule.slot) || composed.has(rule.slot)) continue;
      const locked = input.choices?.[rule.slot] ?? input.picks?.[rule.slot];
      if (locked && locked !== rule.template.source) continue;
      if (rule.inputs.every(id => selected.has(id) || composed.has(id))) { composed.set(rule.slot, { rule: rule.id, inputs: rule.inputs }); changed = true; }
    }
    for (const [slot, offer] of selected) {
      const missing = unique([...offer.fill.composes, ...offer.fill.reads.components]).filter(id => !selected.has(id) && !composed.has(id));
      if (!missing.length) continue;
      selected.delete(slot); changed = true;
      reasons.get(slot)!.push(`${offer.fill.source}: dependency not chosen ${missing.join(",")}`);
    }
    for (const [slot, rule] of composed) {
      const missing = rule.inputs.filter(id => !selected.has(id) && !composed.has(id));
      if (!missing.length) continue;
      composed.delete(slot); changed = true;
    }
  }
  for (const rule of input.catalog.rules ?? []) {
    if (rule.kind !== "compose" || !input.slots.includes(rule.slot) || selected.has(rule.slot) || composed.has(rule.slot)) continue;
    const missing = rule.inputs.filter(id => !selected.has(id));
    reasons.get(rule.slot)!.push(`${rule.id}: inputs not chosen ${missing.join(",")}`);
  }

  const templates = (input.catalog.rules ?? []).filter(rule => composed.get(rule.slot)?.rule === rule.id).map(rule => rule.template);
  // A registered-composition template is not a pinned upstream source: its rule bytes and
  // notice are validated when the rules load and again at apply (applyDecisions /
  // resolveComponents), and the planner never holds that composition context. Only the
  // pin-provenance K8 is set aside, and only for a composed slot; every other finding stays.
  const findings = check([...[...selected.values()].map(offer => offer.fill), ...templates])
    .filter(finding => !(composed.has(finding.subject) && finding.code === "K8" && finding.message === SOURCE_PIN_REQUIRED));
  const rows: ComponentDefaultRow[] = input.slots.map(slot => {
    const offer = selected.get(slot), rule = composed.get(slot);
    if (offer) return { slot, status: offer.basis === "choose" ? "chosen" : "default", basis: offer.basis, source: offer.fill.source, fill: offer.id, reasons: offer.basis === "fallback" ? reasons.get(slot)! : [] };
    if (rule) return { slot, status: "default", basis: "rule", rule: rule.rule, reasons: [] };
    const why = reasons.get(slot)!;
    return { slot, status: "not-chosen", reasons: why.length ? why : ["no eligible candidate"] };
  });
  // Dependency order: the apply path refuses a leaf before the leaves it reads.
  const ordered: string[] = [];
  const place = (slot: string): void => {
    if (ordered.includes(slot)) return;
    const offer = selected.get(slot);
    for (const target of offer ? unique([...offer.fill.composes, ...offer.fill.reads.components]).sort() : [...composed.get(slot)!.inputs]) place(target);
    ordered.push(slot);
  };
  for (const row of rows) if (row.status !== "not-chosen") place(row.slot);
  const decisions: LibraryDecision[] = ordered.map(slot => {
    const row = rows.find(candidate => candidate.slot === slot)!;
    return row.source
      ? { slot, kind: "adopt" as const, source: row.source, fill: row.fill!, note: `Default fill (${row.basis})` }
      : { slot, kind: "compose" as const, rule: row.rule!, reads: [...composed.get(slot)!.inputs], note: "Default fill (registered composition)" };
  });
  return { rows, decisions, findings };
}
