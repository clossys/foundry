/**
 * The recipe page probe (foundry-build-0048 U4b): every recipe fixture output that is a clossys.page/1 record runs
 * through the real Publisher page checks (the repo's built `packages/publisher/dist/check`), read through the same
 * adapter `clossys publisher check` uses. K4 reads the findings, so a fixture whose layout disallows one of its
 * sections is red, never green on shape alone.
 */
import { join } from "node:path";
import { isPageRecord, pageRecordFindings, type PageSlotContract } from "../actions/page-option.js";
import { loadPublisherCheckApi, type PublisherCheckApi } from "../actions/publisher.js";
import type { ConformModel } from "./model.js";

/** Per `<agent>:<recipe dir>`: the Publisher check findings of the recipe's page fixture, or why the check could not run. */
export type RecipePageFacts = Readonly<Record<string, readonly string[] | string>>;

export const recipePageKey = (agent: string, dir: string): string => `${agent}:${dir}`;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!;

/** Run the Publisher page checks over every recipe fixture that is a page record; none is an empty map. */
export async function probeRecipePages(model: ConformModel, load: (root: string) => Promise<PublisherCheckApi> = loadPublisherCheckApi): Promise<RecipePageFacts> {
  const pages = model.agents.flatMap(agent => agent.recipes.flatMap(recipe =>
    recipe.fixture && isPageRecord(recipe.fixture.value) ? [{ key: recipePageKey(agent.agent, recipe.dir), slot: recipe.fixture.slot, record: recipe.fixture.value }] : []));
  if (!pages.length) return {};
  let api: PublisherCheckApi;
  let designer: ReturnType<PublisherCheckApi["loadDesignerCatalog"]>;
  try {
    api = await load(join(model.repo, "packages/publisher"));
    designer = api.loadDesignerCatalog();
  } catch (error) {
    return Object.fromEntries(pages.map(page => [page.key, `the Publisher page check could not run: ${message(error)}`]));
  }
  const out: Record<string, readonly string[] | string> = {};
  for (const page of pages) {
    const contract = api.slotContract(page.slot);
    if (contract?.kind !== "page") { out[page.key] = `${page.slot} is not a Publisher page slot`; continue; }
    const judged = pageRecordFindings(api, page.slot, page.record, contract as PageSlotContract, designer);
    const layout = judged.layoutId && judged.layout ? api.checkLayoutUnits(judged.layoutId, judged.layout, designer).map(detail => `layout.units-resolve ${detail}`) : [];
    out[page.key] = [...judged.findings.map(finding => `${finding.check} ${finding.message}`), ...layout];
  }
  return out;
}
