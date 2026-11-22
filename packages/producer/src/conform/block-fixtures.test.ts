/**
 * Section and frame contract fixtures (foundry-build-0048 U28): `derive-contract-fixtures.mjs --from-references`
 * gives every live section and frame slot a fixture mounting its adopted reference's block (block-fixtures.ts),
 * with DRAFT copy that satisfies the generated props type, or names it in the gaps file. The DF.CREATE probe is
 * red on a section or frame fixture no reference ships, and on DRAFT copy that does not satisfy the contract.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contractFixtureIssues } from "../records/slot-model/contract-fixture.js";
import { fixtureShapeIssues } from "../records/slot-model/validate.js";
import { BLOCK_FIXTURE_RULES, draftCopy, draftCopyIssues, frameChildren, hasDefaultExport, type CopyField } from "../specimen/block-fixtures.js";
import { GAPS_FILE, NO_REFERENCE, referenceIndex, slotReferenceShips } from "../specimen/reference-fixtures.js";
import { PROBES, type ProbeFacts } from "./dogfood.js";
import type { AgentModel, ConformModel } from "./model.js";

const here = dirname(fileURLToPath(import.meta.url));
const DESIGNER = join(here, "../../../designer");
type Fixture = { schema: string; fixtures: { file: string; export: string; props: Record<string, unknown> } };
type Row = { id: string; contract: Record<string, unknown> };
const catalog = (layer: string): Row[] => JSON.parse(readFileSync(join(DESIGNER, "src/catalog/slots", `${layer}.json`), "utf8")) as Row[];
const gaps = () => (JSON.parse(readFileSync(join(DESIGNER, GAPS_FILE), "utf8")) as { gaps: { slot: string; layer: string; reason: string }[] }).gaps;
const retired = new Set((JSON.parse(readFileSync(join(DESIGNER, "src/catalog/retired.json"), "utf8")) as { id: string }[]).map(entry => entry.id));
const row = (id: string) => [...catalog("sections"), ...catalog("frames")].find(slot => slot.id === id)!;
const fixtureOf = (id: string) => row(id).contract.fixture as Fixture | undefined;
const fieldsOf = (id: string) => ((row(id).contract.copy as { fields?: CopyField[] } | undefined)?.fields ?? []);
const index = referenceIndex(DESIGNER);

describe("section and frame fixtures from adopted references", () => {
  it("a section mounts its reference block with DRAFT copy typed by its generated props", () => {
    const hero = fixtureOf("sections.hero")!;
    // tailark mist-hero-section-1 ships one file and exports its block as the module default.
    expect(`${hero.fixtures.file}#${hero.fixtures.export}`).toBe("mist/blocks/hero-section/one/hero-section.tsx#default");
    expect(hero.fixtures.props).toEqual({
      copy: {
        header: { heading: "DRAFT heading", eyebrow: "DRAFT eyebrow", description: "DRAFT lead" },
        actions: { primary: { label: "DRAFT action" }, secondary: { label: "DRAFT action" } },
        media: { title: "DRAFT heading", series: [{ name: "DRAFT label" }] },
      },
    });
    // HeroProps is { copy: HeroCopy; variant?: HeroVariant } (src/generated/props/sections.hero.ts).
    expect(row("sections.hero").contract.props).toEqual(["copy", "variant"]);
    const props = readFileSync(join(DESIGNER, "src/generated/props/sections.hero.ts"), "utf8");
    expect(props).toMatch(/export interface HeroProps \{\n  copy: HeroCopy;\n  variant\?: HeroVariant;\n\}/);
  });

  it("a block reference with a registry:page entry mounts that entry", () => {
    expect(fixtureOf("sections.sign-in-form")!.fixtures).toMatchObject({ file: "registry/aria-nova/blocks/login-03/page.tsx", export: "default" });
    expect(fixtureOf("frames.app-shell")!.fixtures).toMatchObject({ file: "registry/aria-nova/blocks/sidebar-07/page.tsx", export: "default" });
  });

  it("a frame mounts its reference with one DRAFT placeholder per region, naming the section it accepts", () => {
    const header = fixtureOf("frames.site-header")!;
    expect(`${header.fixtures.file}#${header.fixtures.export}`).toBe("mist/blocks/hero-section/one/header.tsx#HeroHeader");
    // BR-RETIRE3: components.link is retired; the nav region now drafts components.button.
    expect(header.fixtures.props).toEqual({ children: ["DRAFT brand (components.logo)", "DRAFT nav (components.button)", "DRAFT actions (components.button)"] });
    expect((fixtureOf("frames.site-shell")!.fixtures.props.children as string[])).toContain("DRAFT consent (sections.consent)");
    expect(row("frames.site-header").contract.props).toEqual(["children"]);
  });

  it("every live section and frame has a valid fixture its own reference ships, or is a named gap; retired ones are gaps", () => {
    const named = new Map(gaps().map(gap => [gap.slot, gap.reason]));
    let fixtures = 0;
    for (const layer of ["sections", "frames"]) for (const slot of catalog(layer)) {
      const fixture = slot.contract.fixture as Fixture | undefined;
      if (retired.has(slot.id)) { expect(fixture, slot.id).toBeUndefined(); expect(named.get(slot.id), slot.id).toBe(BLOCK_FIXTURE_RULES.retired); continue; }
      if (fixture === undefined) { expect(named.get(slot.id), slot.id).toMatch(/\S/); continue; }
      fixtures++;
      expect(named.has(slot.id), slot.id).toBe(false);
      expect(contractFixtureIssues(slot.contract), slot.id).toEqual([]);
      expect(fixtureShapeIssues("element", slot.contract), slot.id).toEqual([]);
      expect(slotReferenceShips(index, slot.id, fixture.fixtures.file, fixture.fixtures.export), slot.id).toBe(true);
      if (layer === "sections") expect(draftCopyIssues(fieldsOf(slot.id), fixture.fixtures.props.copy), slot.id).toEqual([]);
    }
    expect(fixtures).toBeGreaterThan(40);
    // No reference row is a gap, never an invented path.
    expect(named.get("sections.consent")).toBe(NO_REFERENCE);
    expect(named.get("frames.deck")).toBe(NO_REFERENCE);
  });

  it("draftCopy nests dotted keys and arrays, and stays within maxLength", () => {
    const fields: CopyField[] = [
      { key: "a.b", role: "heading", required: true },
      { key: "list[].name", role: "label" },
      { key: "list[].note" },
      { key: "tags[]", role: "label" },
      { key: "x", role: "description", maxLength: { en: 4 } },
    ];
    const copy = draftCopy(fields);
    expect(copy).toEqual({ a: { b: "DRAFT heading" }, list: [{ name: "DRAFT label", note: "DRAFT note" }], tags: ["DRAFT label"], x: "DRAF" });
    expect(draftCopyIssues(fields, copy)).toEqual([]);
    expect(hasDefaultExport("export default function A() {}")).toBe(true);
    expect(hasDefaultExport("function A() {}\nexport { A as default }")).toBe(true);
    expect(hasDefaultExport("export function A() {}")).toBe(false);
    expect(frameChildren([{ id: "main", accepts: "view" }, { id: "head", accepts: "host-node" }])).toEqual(["DRAFT main (view)", "DRAFT head"]);
  });
});

describe("DF.CREATE probe covers sections and frames (strengthened)", () => {
  const model = (id: string, fixture: unknown) => ({ agent: "designer", live: [{ id, source: "placed", contract: { ...row(id).contract, fixture }, inputs: [], uses: [] }] }) as unknown as AgentModel;
  const facts: ProbeFacts = { emptyL2Detected: {}, requestVerb: true, critiqueMonorepoPath: false };
  const probe = (id: string, fixture: unknown) => PROBES["contract-fixture"]!(model(id, fixture), {} as ConformModel, facts).rows;
  const hero = () => structuredClone(fixtureOf("sections.hero")!);

  it("green on the derived section and frame fixtures", () => {
    expect(probe("sections.hero", hero())).toEqual([]);
    expect(probe("frames.site-header", fixtureOf("frames.site-header"))).toEqual([]);
  });

  it("mutation: red on an invented section or frame path, or a named export where the block is the default", () => {
    expect(probe("sections.hero", { ...hero(), fixtures: { ...hero().fixtures, file: "registry/default/blocks/hero.tsx" } })).toEqual(["sections.hero: contract.fixture mounts registry/default/blocks/hero.tsx#default, which none of its adopted references ships in the selected style"]);
    expect(probe("sections.hero", { ...hero(), fixtures: { ...hero().fixtures, export: "Hero" } })).toHaveLength(1);
    // another slot's reference file is not this slot's
    expect(probe("frames.site-header", { ...fixtureOf("frames.site-header")!, fixtures: { ...fixtureOf("frames.site-header")!.fixtures, file: "mist/blocks/footer/one.tsx", export: "default" } })).toHaveLength(1);
  });

  it("mutation: red on DRAFT copy that does not satisfy the contract's copy fields", () => {
    const missing = hero(); delete (missing.fixtures.props.copy as { header: Record<string, unknown> }).header.heading;
    expect(probe("sections.hero", missing)).toEqual(["sections.hero: contract.fixture props.copy is missing the required field header.heading"]);
    const extra = hero(); (extra.fixtures.props.copy as Record<string, unknown>).invented = "DRAFT x";
    expect(probe("sections.hero", extra)).toEqual(["sections.hero: contract.fixture props.copy sets invented, which no contract copy field declares"]);
    const empty = hero(); (empty.fixtures.props.copy as { header: Record<string, unknown> }).header.heading = "";
    expect(probe("sections.hero", empty)).toEqual(["sections.hero: contract.fixture props.copy header.heading must be non-empty text"]);
    const none = hero(); delete none.fixtures.props.copy;
    expect(probe("sections.hero", none)).toEqual(["sections.hero: contract.fixture props.copy must be an object"]);
  });
});
