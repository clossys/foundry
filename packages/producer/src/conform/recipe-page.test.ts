/**
 * K4 for the Publisher page recipe (foundry-build-0048 U4b): assemble.page's clossys.page/1 fixture output certifies
 * under the page slot contract through the real Publisher page check (the repo's built packages/publisher dist/check),
 * and a crafted section its layout disallows turns K4 red.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSERTIONS } from "./assertions.js";
import type { ProbeFacts } from "./dogfood.js";
import { readConformModel, type AgentModel, type ConformModel } from "./model.js";
import { probeRecipePages, recipePageKey } from "./recipe-page.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const CONSUMER = join(REPO, "packages/producer/test-fixtures/consumer/clossys");
const FIXTURE = "recipes/assemble.page/fixture/page.home.json";
const RECIPE = "recipes/assemble.page";
const record = (): Record<string, any> => JSON.parse(readFileSync(join(REPO, "packages/publisher", FIXTURE), "utf8"));
const BASE_FACTS: ProbeFacts = { emptyL2Detected: {}, requestVerb: true, critiqueMonorepoPath: false };

/** The real Publisher model with its assemble.page fixture replaced by `value`. */
function withFixture(value: unknown): { agent: AgentModel; model: ConformModel } {
  const real = readConformModel(REPO, CONSUMER, ["publisher"]);
  const agent = real.agents[0]!;
  const recipes = agent.recipes.map(recipe => (recipe.dir === RECIPE ? { ...recipe, fixture: { ...recipe.fixture!, value } } : recipe));
  const next = { ...agent, recipes } as AgentModel;
  return { agent: next, model: { ...real, agents: [next] } };
}
async function k4(value: unknown, facts?: Partial<ProbeFacts>) {
  const { agent, model } = withFixture(value);
  const probed = facts ?? { recipePages: await probeRecipePages(model) };
  return ASSERTIONS.K4!(agent, model, { ...BASE_FACTS, ...probed });
}

describe("K4: the assemble.page fixture under the real Publisher page check", () => {
  it("declares the fixture for page.home and certifies it: no rows", async () => {
    const real = readConformModel(REPO, CONSUMER, ["publisher"]);
    expect(real.agents[0]!.recipes.find(recipe => recipe.dir === RECIPE)?.fixture).toMatchObject({ output: FIXTURE, slot: "page.home" });
    const facts = await probeRecipePages(real);
    expect(facts[recipePageKey("publisher", RECIPE)]).toEqual([]);
    expect(await k4(record())).toEqual({ rows: [], evidence: 1 });
  });

  it("mutation: a crafted section the layout disallows fails page.role-allowed", async () => {
    const doc = record();
    doc.sections[0] = "sections.band";
    doc.bindings = { ...doc.bindings, "sections.band": { copy: { copy: "sections.band.copy#home.hero" } } };
    delete doc.bindings["sections.hero"];
    const { rows } = await k4(doc);
    expect(rows).toContain(`${RECIPE}: fixture page.role-allowed page.home: hero places designer/sections.band; the role allows designer/sections.hero`);
  });

  it("mutation: a section no role admits, with no record key, fails the role and the required role", async () => {
    const doc = record();
    doc.sections.push("sections.band");
    const { rows } = await k4(doc);
    expect(rows.some(row => /page\.record-key page\.home: sections\.band binds no Writer record/.test(row))).toBe(true);
    expect(rows.some(row => /page\.role-allowed page\.home: role band is not a role of publisher\/layout\.marketing-home/.test(row))).toBe(true);
  });

  it("takes the fixture route from the record: a route that is not the page slot's fails", async () => {
    const about = record();
    about.path = "/about";
    expect((await k4(about)).rows).toContain(`${RECIPE}: fixture page.route page.home: routes /about, not the page slot's /`);
    const bare = record();
    bare.path = "about";
    expect((await k4(bare)).rows).toContain(`${RECIPE}: fixture /fixture/route/path must match ^/`);
  });

  it("runs the page standard: an inline title fails page.assembled", async () => {
    const doc = record();
    doc.title = "Welcome to the studio";
    expect((await k4(doc)).rows.some(row => row.includes("fails page page.assembled"))).toBe(true);
  });

  it("mutation: styling or words in a binding turn K4 red (fix round 1)", async () => {
    const styled = record();
    styled.bindings["sections.hero"].className = "text-red-500";
    expect((await k4(styled)).rows).toContain(`${RECIPE}: fixture page.no-style page.home: bindings.sections.hero.className: a page record holds no styling`);
    const worded = record();
    worded.meta.title = "Hello world";
    expect((await k4(worded)).rows.some(row => row.includes("fixture page.no-inline-copy page.home: page: meta.title is inline text"))).toBe(true);
  });

  it("is red when the page check did not run or could not load", async () => {
    expect((await k4(record(), {})).rows).toEqual([`${RECIPE}: the Publisher page check did not run on the fixture`]);
    const { model } = withFixture(record());
    const failed = await probeRecipePages(model, async () => { throw new Error("no dist/check"); });
    expect(failed).toEqual({ [recipePageKey("publisher", RECIPE)]: "the Publisher page check could not run: no dist/check" });
    expect((await k4(record(), { recipePages: failed })).rows).toEqual([`${RECIPE}: the Publisher page check could not run: no dist/check`]);
  });
});
