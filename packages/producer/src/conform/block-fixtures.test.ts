/**
 * Section and frame contract fixtures (foundry-build-0048 U28): `derive-contract-fixtures.mjs --from-references`
 * gives every live section and frame slot a fixture mounting its adopted reference's block (block-fixtures.ts),
 * with DRAFT copy that satisfies the generated props type, or names it in the gaps file. The DF.CREATE probe is
 * red on a section or frame fixture no reference ships, and on DRAFT copy that does not satisfy the contract.
 * FCR: a section or frame with no reference adoptable in the selected style and engine is composed instead (its
 * fixture is its own pinned, certified composition's; composed-fixture.test.ts), so it carries no package fixture.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contractFixtureIssues } from "../records/slot-model/contract-fixture.js";
import { fixtureShapeIssues } from "../records/slot-model/validate.js";
import { BLOCK_FIXTURE_RULES, draftCopy, draftCopyIssues, frameChildren, hasDefaultExport, type CopyField } from "../specimen/block-fixtures.js";
import { COMPOSED, GAPS_FILE, NO_REFERENCE, referenceIndex, slotReferenceShips } from "../specimen/reference-fixtures.js";
import { PROBES, type ProbeFacts } from "./dogfood.js";
import type { AgentModel, ConformModel } from "./model.js";

const here = dirname(fileURLToPath(import.meta.url));
const DESIGNER = join(here, "../../../designer");
type Fixture = { schema: string; fixtures: { file: string; export: string; props: Record<string, unknown> } };
type Row = { id: string; contract: Record<string, unknown> };
const catalog = (layer: string): Row[] => JSON.parse(readFileSync(join(DESIGNER, "src/catalog/slots", `${layer}.json`), "utf8")) as Row[];
const gapsDoc = () => JSON.parse(readFileSync(join(DESIGNER, GAPS_FILE), "utf8")) as { gaps: { slot: string; layer: string; reason: string }[]; composed: { slot: string; layer: string; reason: string }[] };
const gaps = () => gapsDoc().gaps;
const retired = new Set((JSON.parse(readFileSync(join(DESIGNER, "src/catalog/retired.json"), "utf8")) as { id: string }[]).map(entry => entry.id));
const row = (id: string) => [...catalog("sections"), ...catalog("frames")].find(slot => slot.id === id)!;
const fixtureOf = (id: string) => row(id).contract.fixture as Fixture | undefined;
const fieldsOf = (id: string) => ((row(id).contract.copy as { fields?: CopyField[] } | undefined)?.fields ?? []);
const index = referenceIndex(DESIGNER);

describe("section and frame fixtures from adopted references", () => {
  it("a section mounts its reference block with DRAFT copy typed by its generated props", () => {
    const people = fixtureOf("sections.people")!;
    // tailark mist-team-1 ships one file and exports its block as the module default.
    expect(`${people.fixtures.file}#${people.fixtures.export}`).toBe("mist/blocks/team/one.tsx#default");
    expect(people.fixtures.props).toEqual({
      copy: {
        header: { eyebrow: "DRAFT eyebrow", heading: "DRAFT heading", description: "DRAFT lead" },
        people: [{ name: "DRAFT label", role: "DRAFT label", initials: "DRAFT label" }],
      },
    });
    // PeopleProps is { copy: PeopleCopy; variant?: PeopleVariant } (src/generated/props/sections.people.ts).
    expect(row("sections.people").contract.props).toEqual(["copy", "variant"]);
    const props = readFileSync(join(DESIGNER, "src/generated/props/sections.people.ts"), "utf8");
    expect(props).toMatch(/export interface PeopleProps \{\n  copy: PeopleCopy;\n  variant\?: PeopleVariant;\n\}/);
    // FCR: sections.hero's only rows are radix-flavoured, so it is composed and carries no package fixture.
    expect(fixtureOf("sections.hero")).toBeUndefined();
    expect(row("sections.hero").contract.props).toBeUndefined();
  });

  it("a block reference with a registry:page entry mounts that entry", () => {
    expect(fixtureOf("sections.sign-in-form")!.fixtures).toMatchObject({ file: "registry/aria-nova/blocks/login-03/page.tsx", export: "default" });
    expect(fixtureOf("frames.app-shell")!.fixtures).toMatchObject({ file: "registry/aria-nova/blocks/sidebar-07/page.tsx", export: "default" });
  });

  it("a frame mounts its reference with one DRAFT placeholder per region, naming the section it accepts", () => {
    const footer = fixtureOf("frames.site-footer")!;
    expect(`${footer.fixtures.file}#${footer.fixtures.export}`).toBe("mist/blocks/footer/one.tsx#default");
    // BR-RETIRE3: components.link is retired; the links region drafts components.button.
    expect(footer.fixtures.props).toEqual({ children: ["DRAFT columns", "DRAFT links (components.button)", "DRAFT legal", "DRAFT social (components.icon)"] });
    // A region that accepts sections drafts the layer it accepts.
    expect((fixtureOf("frames.app-shell")!.fixtures.props.children as string[])).toContain("DRAFT page-module (sections.*)");
    // SSC: frames.site-shell is composed by its named rule row (its rows are its parts' references): no package fixture.
    expect(fixtureOf("frames.site-shell")).toBeUndefined();
    expect(row("frames.site-footer").contract.props).toEqual(["children"]);
    // FCR: frames.site-header's rows are radix-flavoured headers (asChild), so it is composed: no package fixture.
    expect(fixtureOf("frames.site-header")).toBeUndefined();
  });

  it("every live section and frame has a valid fixture its own reference ships, or is a named gap; retired ones are gaps", () => {
    const named = new Map(gaps().map(gap => [gap.slot, gap.reason]));
    const composed = new Map(gapsDoc().composed.map(row => [row.slot, row.reason]));
    let fixtures = 0;
    for (const layer of ["sections", "frames"]) for (const slot of catalog(layer)) {
      const fixture = slot.contract.fixture as Fixture | undefined;
      if (retired.has(slot.id)) { expect(fixture, slot.id).toBeUndefined(); expect(named.get(slot.id), slot.id).toBe(BLOCK_FIXTURE_RULES.retired); continue; }
      if (composed.has(slot.id)) {
        // FCR: a composed slot is no gap, and the package gives it neither a fixture nor the props that type one.
        expect(composed.get(slot.id), slot.id).toContain(COMPOSED);
        expect(named.has(slot.id), slot.id).toBe(false);
        expect(fixture, slot.id).toBeUndefined();
        expect(slot.contract.props, slot.id).toBeUndefined();
        continue;
      }
      if (fixture === undefined) { expect(named.get(slot.id), slot.id).toMatch(/\S/); continue; }
      fixtures++;
      expect(named.has(slot.id), slot.id).toBe(false);
      expect(contractFixtureIssues(slot.contract), slot.id).toEqual([]);
      expect(fixtureShapeIssues("element", slot.contract), slot.id).toEqual([]);
      expect(slotReferenceShips(index, slot.id, fixture.fixtures.file, fixture.fixtures.export), slot.id).toBe(true);
      if (layer === "sections") expect(draftCopyIssues(fieldsOf(slot.id), fixture.fixtures.props.copy), slot.id).toEqual([]);
    }
    // FCR moved nine former fixtures to composed (judged against their own pinned composition); together they
    // still cover more than 40 slots, and every derived fixture is counted in the gaps file.
    expect(fixtures + [...composed.keys()].filter(id => id.startsWith("sections.") || id.startsWith("frames.")).length).toBeGreaterThan(40);
    expect(fixtures).toBeGreaterThan(30);
    // No reference row is composed (FCR), never an invented path.
    expect(composed.get("sections.consent")).toBe(`${COMPOSED} (${NO_REFERENCE})`);
    expect(composed.get("frames.deck")).toBe(`${COMPOSED} (${NO_REFERENCE})`);
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
  const people = () => structuredClone(fixtureOf("sections.people")!);

  it("green on the derived section and frame fixtures", () => {
    expect(probe("sections.people", people())).toEqual([]);
    expect(probe("frames.site-footer", fixtureOf("frames.site-footer"))).toEqual([]);
  });

  it("mutation: red on an invented section or frame path, or a named export where the block is the default", () => {
    expect(probe("sections.people", { ...people(), fixtures: { ...people().fixtures, file: "registry/default/blocks/team.tsx" } })).toEqual(["sections.people: contract.fixture mounts registry/default/blocks/team.tsx#default, which none of its adopted references ships in the selected style"]);
    expect(probe("sections.people", { ...people(), fixtures: { ...people().fixtures, export: "Team" } })).toHaveLength(1);
    // another slot's reference file is not this slot's
    expect(probe("frames.site-footer", { ...fixtureOf("frames.site-footer")!, fixtures: { ...fixtureOf("frames.site-footer")!.fixtures, file: "mist/blocks/hero-section/one/header.tsx", export: "HeroHeader" } })).toHaveLength(1);
  });

  it("mutation: red on DRAFT copy that does not satisfy the contract's copy fields", () => {
    // sections.people's header fields are optional; each person's name is required.
    const missing = people(); delete (missing.fixtures.props.copy as { people: Record<string, unknown>[] }).people[0].name;
    expect(probe("sections.people", missing)).toEqual(["sections.people: contract.fixture props.copy is missing the required field people[].name"]);
    const extra = people(); (extra.fixtures.props.copy as Record<string, unknown>).invented = "DRAFT x";
    expect(probe("sections.people", extra)).toEqual(["sections.people: contract.fixture props.copy sets invented, which no contract copy field declares"]);
    const empty = people(); (empty.fixtures.props.copy as { people: Record<string, unknown>[] }).people[0].name = "";
    expect(probe("sections.people", empty)).toEqual(["sections.people: contract.fixture props.copy people[].name must be non-empty text"]);
    const none = people(); delete none.fixtures.props.copy;
    expect(probe("sections.people", none)).toEqual(["sections.people: contract.fixture props.copy must be an object"]);
  });
});
