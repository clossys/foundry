/**
 * The fit dry run (W2-C): what R05.1 will report once the slots carry their fixtures. No slot
 * records a contract fixture yet (W1-D's fill), so this proposes one per live slot from its pinned
 * candidate, the way the fill will lift it, and runs the kind certifier (`certifyFit`) on every
 * candidate with it:
 *
 *   element      the pinned candidate's `meta.preview` (without its copy snapshot); a non-mounting
 *                element (theme, font, asset) needs none
 *   brief        the pinned candidate's `## ` headings
 *   strings      the pinned candidate's keys and locales
 *   page, publication  the pinned candidate's `path`
 *   seat         the slot's own fixture
 *
 * A slot already carrying a fixture keeps it. A proposed element fixture whose contract lists no
 * `props` is typed by its own props keys (the fill writes `contract.props` with it). The standard
 * part of R05 is left out: no slot names a standard yet. Fit failures are every reason code but the
 * missing records (`no-standard`, `no-fixture`), grouped per agent and family (the slot id's first
 * segment). Read-only: it writes nothing.
 */
import { parseFrontmatter } from "../../records/slot-model/index.js";
import { isObject, liveSlotRecords } from "../checks/shared.js";
import type { ConstitutionContext, SlotRecord } from "../types.js";
import { bodyHeadings } from "./brief.js";
import { elementCheck } from "./element.js";
import { certifyEnv, pinnedOf, writerRecords, type CertifyEnv } from "./env.js";
import { certifyFit, slotDocOf } from "./index.js";
import { MISSING_RECORD_CODES, type Reason } from "./types.js";

/** Where a slot's dry-run fixture comes from. */
export type FixtureSource = "own" | "pinned" | "none" | "not-needed";

/** The fixture the dry run certifies a slot with, and where it came from. */
export function proposedContract(slot: SlotRecord, env: CertifyEnv): { contract: Readonly<Record<string, unknown>>; source: FixtureSource } {
  const { kind, contract } = slotDocOf(slot);
  if (contract.fixture !== undefined) return { contract, source: "own" };
  const pinned = pinnedOf(slot);
  if (!pinned || !kind || kind === "seat") return { contract, source: "none" };
  const json = isObject(pinned.json) ? pinned.json : undefined;
  switch (kind) {
    case "element": {
      const meta = json && isObject(json.meta) ? json.meta : undefined;
      const preview = meta && isObject(meta.preview) ? meta.preview : undefined;
      if (!preview) return { contract, source: elementCheck(slot, pinned, contract) === "none" ? "not-needed" : "none" };
      const { copy: _snapshot, ...fixture } = preview;
      const props = isObject(fixture.fixtures) && isObject(fixture.fixtures.props) ? Object.keys(fixture.fixtures.props) : [];
      return { contract: { ...contract, ...(Array.isArray(contract.props) ? {} : { props }), fixture }, source: "pinned" };
    }
    case "brief": {
      const parsed = parseFrontmatter(pinned.text);
      const headings = parsed.ok ? [...bodyHeadings(parsed.value.body)] : [];
      return headings.length ? { contract: { ...contract, fixture: { headings } }, source: "pinned" } : { contract, source: "none" };
    }
    case "strings": {
      const records = writerRecords(pinned);
      if ("error" in records || !records.rows.length || !records.locales.length) return { contract, source: "none" };
      return { contract: { ...contract, fixture: { keys: [...new Set(records.rows.map(item => item.id))].sort(), locales: records.locales } }, source: "pinned" };
    }
    case "page": case "publication": {
      const path = json && typeof json.path === "string" && json.path.startsWith("/") ? json.path : undefined;
      return path ? { contract: { ...contract, fixture: { route: { path } } }, source: "pinned" } : { contract, source: "none" };
    }
  }
  return { contract, source: "none" };
}

export interface FamilyFit {
  readonly agent: string;
  readonly family: string;
  readonly candidates: number;
  /** Candidates with at least one fit failure. */
  readonly failing: number;
  /** Fit failure reason code → candidates carrying it. */
  readonly codes: Readonly<Record<string, number>>;
  /** Up to three `<slot>/<candidate>: <first fit reason>` lines. */
  readonly examples: readonly string[];
}

export interface DryRun {
  readonly candidates: number;
  readonly fit: number;
  readonly failing: number;
  /** Candidates whose only reasons are missing records (no fixture to measure). */
  readonly unmeasured: number;
  /** Per agent: live slots by fixture source. */
  readonly fixtures: Readonly<Record<string, Readonly<Record<FixtureSource, number>>>>;
  readonly families: readonly FamilyFit[];
}

/** The family of a slot id: its first dotted segment. */
export const familyOf = (id: string) => id.split(".")[0]!;
const fitFailures = (reasons: readonly Reason[]) => reasons.filter(item => !MISSING_RECORD_CODES.has(item.code));

/** Runs the kind certifiers on every live candidate with the proposed fixtures. */
export function dryRun(ctx: ConstitutionContext): DryRun {
  const env = certifyEnv(ctx);
  const fixtures: Record<string, Record<FixtureSource, number>> = {};
  const families = new Map<string, { agent: string; family: string; candidates: number; failing: number; codes: Record<string, number>; examples: string[] }>();
  let candidates = 0, fit = 0, failing = 0, unmeasured = 0;
  for (const slot of liveSlotRecords(ctx)) {
    const { contract, source } = proposedContract(slot, env);
    (fixtures[slot.agent] ??= { own: 0, pinned: 0, none: 0, "not-needed": 0 })[source]++;
    const key = `${slot.agent}\0${familyOf(slot.id)}`;
    let family = families.get(key);
    if (!family) families.set(key, family = { agent: slot.agent, family: familyOf(slot.id), candidates: 0, failing: 0, codes: {}, examples: [] });
    for (const candidate of slot.candidates) {
      candidates++; family.candidates++;
      const reasons = certifyFit({ slot, candidate, contract }, env);
      const failures = fitFailures(reasons);
      if (failures.length) {
        failing++; family.failing++;
        for (const code of new Set(failures.map(item => item.code))) family.codes[code] = (family.codes[code] ?? 0) + 1;
        if (family.examples.length < 3) family.examples.push(`${slot.id}/${candidate.name}: [${failures[0]!.code}] ${failures[0]!.message}`);
      } else if (reasons.length) unmeasured++;
      else fit++;
    }
  }
  const order = (a: FamilyFit, b: FamilyFit) => (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : a.family < b.family ? -1 : a.family > b.family ? 1 : 0);
  return { candidates, fit, failing, unmeasured, fixtures, families: [...families.values()].sort(order) };
}

/** The dry run as Markdown table rows (agent, family, candidates, failing, codes, first example). */
export function formatDryRun(result: DryRun): string {
  const lines = [
    `candidates ${result.candidates}: fit ${result.fit}, fit failures ${result.failing}, unmeasured (no fixture) ${result.unmeasured}`,
    "",
    "| agent | fixtures own/pinned/none/not-needed |",
    "| --- | --- |",
    ...Object.entries(result.fixtures).sort().map(([agent, count]) => `| ${agent} | ${count.own}/${count.pinned}/${count.none}/${count["not-needed"]} |`),
    "",
    "| agent | family | candidates | failing | codes | example |",
    "| --- | --- | --- | --- | --- | --- |",
    ...result.families.map(item => `| ${item.agent} | ${item.family} | ${item.candidates} | ${item.failing} | ${Object.entries(item.codes).sort().map(([code, n]) => `${code} ${n}`).join(", ") || "-"} | ${(item.examples[0] ?? "-").replace(/\|/g, "\\|").slice(0, 160)} |`),
  ];
  return lines.join("\n");
}
