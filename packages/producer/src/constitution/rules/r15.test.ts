import { cpSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContext } from "../context.js";
import { cleanSpec, expectCatches, NO_FOUNDRY_LEAVES, NO_HISTORY, slotDoc, writeWorkspace, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import type { Check, ConstitutionContext } from "../types.js";
import { put, RECIPE_ID, recipeDir, STANDARD_ID, standardDir, standardSpec, standardWorld, type Edit } from "./r15.world.js";
import { craftIssues, R15, R15_CHECKS, r15_1, r15_2, r15_3, r15_4, r15_5, r15_6, r15_7, r15_8, r15_9 } from "./r15.js";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const ctxOf = (edit?: Edit, spec?: WorkspaceSpec) => standardWorld(spec, edit).ctx;
const editRequirements = (change: (doc: Record<string, unknown>) => void): Edit => root => {
  const path = join(standardDir(root), "requirements.json");
  const doc = json(path); change(doc); put(path, doc);
};
const editExemplars = (change: (list: Record<string, unknown>[]) => void): Edit => root => {
  const path = join(standardDir(root), "exemplars", "exemplars.json");
  const doc = json(path); change(doc.exemplars as Record<string, unknown>[]); put(path, doc);
};
const editRecipe = (change: (doc: Record<string, unknown>) => void): Edit => root => {
  const path = join(recipeDir(root), "recipe.json");
  const doc = json(path); change(doc); put(path, doc);
};

/** The failing-first contract plus the reason: silent on the clean world, the expected row on the broken one. */
function catches(check: Check, broken: ConstitutionContext, reason: RegExp, clean: ConstitutionContext = ctxOf()) {
  const rows = expectCatches(check, clean, broken);
  expect(rows.map(row => row.reason).join("\n")).toMatch(reason);
  for (const row of rows) expect(row.rule).toBe("R15");
  return rows;
}

describe("R15 module", () => {
  it("declares R15.1-R15.9", () => {
    expect(R15.rule).toBe("R15");
    expect(Object.keys(R15_CHECKS)).toEqual(Array.from({ length: 9 }, (_, index) => `R15.${index + 1}`));
  });

  it("the fixture standard and recipe are clean under every R15 check", () => {
    const ctx = ctxOf();
    for (const [id, check] of Object.entries(R15_CHECKS)) expect(check(ctx), id).toEqual([]);
  });

  it("a workspace with no standards at all reports every live slot under R15.1 (the 493-slot finding)", () => {
    const { root, consumer } = writeWorkspace(cleanSpec());
    const ctx = buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES });
    const rows = r15_1(ctx);
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map(row => row.reason))).toEqual(new Set(["slot.json names no standard"]));
    for (const id of ["R15.2", "R15.3", "R15.4", "R15.5", "R15.6", "R15.7", "R15.8", "R15.9"] as const) expect(R15_CHECKS[id](ctx), id).toEqual([]);
  });
});

describe("R15.1 slot names an existing standard of its kind", () => {
  it("catches a slot naming no standard", () => {
    const slot = slotDoc("writer", "home.hero");
    catches(r15_1, ctxOf(undefined, { writer: { "home.hero": { slot, candidates: { "hero-v1.md": "Hi.\n" } } } }), /names no standard/);
  });
  it("catches a standard that does not exist", () => {
    catches(r15_1, ctxOf(undefined, { writer: { "home.hero": { slot: { ...slotDoc("writer", "home.hero"), standard: "missing-standard" }, candidates: { "hero-v1.md": "Hi.\n" } } } }), /missing-standard does not exist under packages\/writer\/standards/);
  });
  it("catches a standard of another kind", () => {
    catches(r15_1, ctxOf(editRequirements(doc => { doc.kinds = ["element"]; })), /serves element, not this slot's kind strings/);
  });
  it("accepts a kind/sub match on contract.kind", () => {
    const spec = standardSpec();
    const slot = spec.writer!["home.hero"]!.slot as Record<string, unknown>;
    slot.contract = { ...(slot.contract as Record<string, unknown>), kind: "headline" };
    expect(r15_1(ctxOf(editRequirements(doc => { doc.kinds = ["strings/headline"]; }), spec))).toEqual([]);
    catches(r15_1, ctxOf(editRequirements(doc => { doc.kinds = ["strings/body"]; }), spec), /serves strings\/body, not this slot's kind strings\/headline/);
  });
});

describe("R15.2 valid standard", () => {
  it("catches a missing taste.md", () => {
    catches(r15_2, ctxOf(root => rmSync(join(standardDir(root), "taste.md"))), /no taste\.md/);
  });
  it("catches a missing exemplars folder", () => {
    catches(r15_2, ctxOf(root => rmSync(join(standardDir(root), "exemplars"), { recursive: true })), /no exemplars\/ folder/);
  });
  it("catches a craft standard with createGaps and an adopt-first one without", () => {
    catches(r15_2, ctxOf(editRequirements(doc => { doc.createGaps = ["tone"]; })), /requirements\.json/);
    catches(r15_2, ctxOf(editRequirements(doc => { doc.mode = "adopt-first"; })), /requirements\.json/);
  });
  it("catches a bad craftTier and an id that is not the folder name", () => {
    catches(r15_2, ctxOf(editRequirements(doc => { doc.craftTier = "low"; })), /craftTier/);
    catches(r15_2, ctxOf(editRequirements(doc => { doc.id = "other"; })), /is not the folder name fixture-headline/);
  });
});

describe("R15.3 requirements are registered criteria", () => {
  it("catches an unregistered requirement", () => {
    catches(r15_3, ctxOf(editRequirements(doc => { (doc.requirements as unknown[]).push({ check: "text.not-a-criterion", params: {} }); })), /text\.not-a-criterion is not registered/);
  });
});

describe("R15.4 taste never decides", () => {
  it("catches a taste criterion missing an anchor", () => {
    catches(r15_4, ctxOf(root => {
      const path = join(standardDir(root), "taste.md");
      put(path, readFileSync(path, "utf8").replace("- 3: Clear on a second read.\n", ""));
    }), /clarity has no anchor for 3/);
  });
  it("catches a taste criterion that is a requirement or a registered mechanical criterion", () => {
    const anchors = "- 1: a\n- 2: b\n- 3: c\n- 4: d\n- 5: e\n";
    catches(r15_4, ctxOf(root => { put(join(standardDir(root), "taste.md"), `## clarity\n${anchors}\n## text.word-limit\n${anchors}`); }), /text\.word-limit is also a requirement/);
    catches(r15_4, ctxOf(root => { put(join(standardDir(root), "taste.md"), `## clarity\n${anchors}\n## type.measure\n${anchors}`); }), /type\.measure is a registered mechanical criterion/);
  });
  it("catches a taste.md with no criterion", () => {
    catches(r15_4, ctxOf(root => { put(join(standardDir(root), "taste.md"), "# taste\n\nNothing here.\n"); }), /names no taste criterion/);
  });
});

describe("R15.5 recipes", () => {
  it("catches a standard with no recipe", () => {
    catches(r15_5, ctxOf(root => rmSync(recipeDir(root), { recursive: true })), /no valid recipe under packages\/writer\/recipes\/ produces for fixture-headline/);
  });
  it("catches a recipe with a rubric (file or field)", () => {
    catches(r15_5, ctxOf(root => put(join(recipeDir(root), "rubric.md"), "# rubric\n")), /rubric\.md is a rubric file/);
    catches(r15_5, ctxOf(editRecipe(doc => { doc.rubric = { clarity: 5 }; })), /recipe\.json/);
  });
  it("catches a recipe producing for an unknown standard and one without craft.md", () => {
    catches(r15_5, ctxOf(editRecipe(doc => { doc.produces = [STANDARD_ID, "ghost"]; })), /produces ghost, which is not a writer standard/);
    catches(r15_5, ctxOf(root => rmSync(join(recipeDir(root), "craft.md"))), /no craft\.md/);
  });
  it("catches a non-deterministic or missing generator, and accepts a pure one", () => {
    const withGenerator = (source: string): Edit => root => {
      editRecipe(doc => { doc.generator = "generate.mjs"; })(root, "");
      put(join(recipeDir(root), "generate.mjs"), source);
    };
    expect(r15_5(ctxOf(withGenerator("export default input => input.toUpperCase();\n")))).toEqual([]);
    catches(r15_5, ctxOf(withGenerator("export default () => String(Math.random());\n")), /generator uses randomness/);
    catches(r15_5, ctxOf(withGenerator("export default () => new Date().toISOString();\n")), /generator reads the clock/);
    catches(r15_5, ctxOf(withGenerator("export default async () => (await fetch('https://x')).text();\n")), /generator uses the network/);
    catches(r15_5, ctxOf(editRecipe(doc => { doc.generator = "generate.mjs"; })), /generator generate\.mjs is not a file/);
  });
});

/** The fixture recipe rewritten as a plumb recipe naming a plumb action that produces for the fixture standard. */
const PLUMB_ACTION = "fixture.plumb";
const PLUMB_CRAFT = "# fixture-headline-craft\n\nPlumb: the fixture plumb action computes the headline.\n\n### 1. compute (deterministic)\n\n```sh\nclossys produce writer/<slot>\n```\n\n### 2. submit (deterministic)\n\n```sh\nclossys check --constitution --slot writer/<slot>\n```\n";
const plumbAction = (fields: Record<string, unknown> = {}): Edit => root => put(join(root, "packages", "producer", "actions", PLUMB_ACTION, "action.json"), { schema: "clossys.action/1", id: PLUMB_ACTION, kind: "plumb", standards: [`writer/${STANDARD_ID}`], ...fields });
function plumb(recipe: Record<string, unknown> = {}, craft = PLUMB_CRAFT, action: Edit | null = plumbAction()): Edit {
  return (root, consumer) => {
    editRecipe(doc => { doc.rung = "plumb"; doc.axes = []; doc.action = PLUMB_ACTION; Object.assign(doc, recipe); for (const [key, value] of Object.entries(recipe)) if (value === undefined) delete doc[key]; })(root, consumer);
    put(join(recipeDir(root), "craft.md"), craft);
    action?.(root, consumer);
  };
}

describe("R15.5 plumb recipes (deterministic, no craft)", () => {
  it("accepts a plumb recipe whose plumb action produces for its standard, clean under every R15 check", () => {
    const ctx = ctxOf(plumb());
    for (const [id, check] of Object.entries(R15_CHECKS)) expect(check(ctx), id).toEqual([]);
  });
  it("catches a plumb recipe with a model stage (mutation: a craft stage in a plumb recipe)", () => {
    catches(r15_5, ctxOf(plumb({}, PLUMB_CRAFT.replace("### 1. compute (deterministic)", "### 1. brief (model)"))), /craft\.md has a model stage "### 1\. brief \(model\)": a plumb recipe runs no model/);
  });
  it("catches a plumb stage that runs anything but a clossys verb, or is not marked deterministic", () => {
    catches(r15_5, ctxOf(plumb({}, PLUMB_CRAFT.replace("clossys produce writer/<slot>", "node scripts/make.mjs"))), /runs "node scripts\/make\.mjs", not a clossys verb/);
    catches(r15_5, ctxOf(plumb({}, PLUMB_CRAFT.replace("### 2. submit (deterministic)", "### 2. submit"))), /stage "### 2\. submit" is not marked \(deterministic\)/);
    catches(r15_5, ctxOf(plumb({}, "# plumb\n\nNo stages.\n")), /has no numbered stage[\s\S]*runs no command/);
  });
  it("catches a plumb recipe whose action is missing, or is not plumb", () => {
    catches(r15_5, ctxOf(plumb({}, PLUMB_CRAFT, null)), /action fixture\.plumb is not an action\.json under packages\/\*\/actions\//);
    catches(r15_5, ctxOf(plumb({}, PLUMB_CRAFT, plumbAction({ kind: "decide:creative" }))), /action fixture\.plumb is kind decide:creative, not plumb/);
  });
  it("catches a plumb action that does not produce for the recipe's standard; the standard then has no recipe", () => {
    const rows = catches(r15_5, ctxOf(plumb({}, PLUMB_CRAFT, plumbAction({ standards: ["writer/other"] }))), /plumb action fixture\.plumb does not produce for writer\/fixture-headline/);
    expect(rows.map(row => row.reason).join("\n")).toMatch(/no valid recipe under packages\/writer\/recipes\/ produces for fixture-headline/);
  });
  it("catches a recipe claiming rung plumb without an action, with axes or a generator, and a craft recipe naming an action", () => {
    catches(r15_5, ctxOf(plumb({ action: undefined })), /rung plumb names no action/);
    catches(r15_5, ctxOf(plumb({ axes: ["tone"] })), /rung plumb lists axes tone: a plumb recipe has no diverge stage/);
    catches(r15_5, ctxOf(root => { plumb({ generator: "generate.mjs" })(root, ""); put(join(recipeDir(root), "generate.mjs"), "export default s => s;\n"); }), /rung plumb names generator generate\.mjs/);
    catches(r15_5, ctxOf(editRecipe(doc => { doc.action = PLUMB_ACTION; })), /action fixture\.plumb is for a plumb recipe; a create recipe is crafted and names no action/);
  });
});

describe("R15.6 exemplars", () => {
  it("catches too few and too many exemplars", () => {
    catches(r15_6, ctxOf(editExemplars(list => { list.splice(4); })), /4 exemplars; a standard holds 5-12/);
    catches(r15_6, ctxOf(editExemplars(list => {
      for (let index = 0; index < 8; index++) list.push({ id: `extra-${index}`, ref: `https://example.com/${index}`, source: "example.com", license: "all-rights-reserved", description: "A link.", why: { clarity: "x" } });
    })), /13 exemplars/);
  });
  it("catches a stored file under a license the policy does not allow, and honours policy.json", () => {
    const relicense: Edit = editExemplars(list => { list[0]!.license = "all-rights-reserved"; });
    catches(r15_6, ctxOf(relicense), /plain-claim stores a file under all-rights-reserved, not an allowlisted license/);
    const narrowed: Edit = (root, consumer) => put(join(consumer, "agents", "writer", "policy.json"), { licenses: ["MIT"] });
    catches(r15_6, ctxOf(narrowed), /stores a file under CC0-1\.0, not an allowlisted license \(MIT\)/);
  });
  it("catches a why keyed to no taste criterion, a link without a description and an orphan file", () => {
    catches(r15_6, ctxOf(editExemplars(list => { list[0]!.why = { sparkle: "x" }; })), /why names sparkle, not a taste criterion/);
    catches(r15_6, ctxOf(editExemplars(list => { delete list[2]!.description; })), /linked-a is a link without a description/);
    catches(r15_6, ctxOf(root => put(join(standardDir(root), "exemplars", "orphan.md"), "x\n")), /exemplars\/orphan\.md is stored but no exemplar names it/);
  });
});

/** A P2 run on the fixture slot: craft events, a create submit, and (optionally) its critique record. */
const DIRECTIONS = [
  { id: "a", axes: { tone: "warm", length: "short", structure: "claim" } },
  { id: "b", axes: { tone: "dry", length: "medium", structure: "question" } },
  { id: "c", axes: { tone: "bold", length: "long", structure: "contrast" } },
];
function craftRun(stages: string[], directions: unknown[] = DIRECTIONS, critique = true): Edit {
  return (_root, consumer) => {
    const dir = join(consumer, "agents", "writer", "home.hero");
    const events = stages.map(stage => ({ op: `craft:${stage}`, at: "2026-11-13T00:00:00Z", by: "agent:writer", recipe: RECIPE_ID, ...(stage === "diverge" ? { directions } : {}) }));
    put(join(dir, "ledger.json"), { schema: "clossys.ledger/1", events: [...events, { op: "submit", at: "2026-11-13T00:00:01Z", by: "agent:writer", name: "hero-v1.md", rung: "create" }] });
    if (critique) put(join(dir, "critiques", "hero-v1.json"), { schema: "clossys.critique/1", slot: "home.hero", candidate: "hero-v1.md", standard: STANDARD_ID, scores: { clarity: 4 }, packet: { manifest: [] } });
  };
}

describe("R15.7 craft process ran", () => {
  const FULL = ["brief", "diverge", "render", "critique"];
  it("accepts the section 5b order with up to two refine rounds", () => {
    expect(r15_7(ctxOf(craftRun(FULL)))).toEqual([]);
    expect(r15_7(ctxOf(craftRun([...FULL, "refine", "render", "critique", "refine", "render", "critique"])))).toEqual([]);
  });
  it("catches a create submit with no craft events and no critique", () => {
    catches(r15_7, ctxOf(craftRun([], DIRECTIONS, false)), /craft events \(none\)[\s\S]*no critique record critiques\/hero-v1\.json/);
  });
  it("catches stages out of order and a third refine round", () => {
    catches(r15_7, ctxOf(craftRun(["brief", "render", "diverge", "critique"])), /are not brief, diverge, render, critique/);
    catches(r15_7, ctxOf(craftRun([...FULL, "refine", "refine", "refine"])), /at most 2 refine rounds/);
  });
  it("catches fewer than 3 directions and cosmetic variants on an axis", () => {
    catches(r15_7, ctxOf(craftRun(FULL, DIRECTIONS.slice(0, 2))), /2 directions; 3 to 4 required/);
    const cosmetic = DIRECTIONS.map(direction => ({ ...direction, axes: { ...direction.axes, tone: "warm" } }));
    catches(r15_7, ctxOf(craftRun(FULL, cosmetic)), /repeat a value on axis tone/);
  });
  it("a plumb recipe records no craft events: a rung plumb submit needs none, craft events under it are a row", () => {
    const plumbSubmit: Edit = (root, consumer) => {
      plumb()(root, consumer);
      put(join(consumer, "agents", "writer", "home.hero", "ledger.json"), { schema: "clossys.ledger/1", events: [{ op: "submit", at: "2026-11-13T00:00:01Z", by: "producer", name: "hero-v1.md", rung: "plumb" }] });
    };
    expect(r15_7(ctxOf(plumbSubmit))).toEqual([]);
    const crafted: Edit = (root, consumer) => { plumb()(root, consumer); craftRun(["brief"], DIRECTIONS, true)(root, consumer); };
    catches(r15_7, ctxOf(crafted), /recipe fixture-headline-craft is plumb: a plumb recipe records no craft events/);
  });
  it("craftIssues judges the axes the recipe names", () => {
    const events = [{ op: "craft:brief" }, { op: "craft:diverge", recipe: "r", directions: DIRECTIONS.map(direction => ({ ...direction, axes: { tone: direction.axes.tone } })) }, { op: "craft:render" }, { op: "craft:critique" }];
    expect(craftIssues(events, [], "writer")).toEqual([]);
    expect(craftIssues(events, [{ agent: "writer", id: "r", dir: "x", files: {}, issues: [], doc: { schema: "clossys.recipe/1", id: "r", produces: [], rung: "create", axes: ["tone", "length"] } }], "writer")).toEqual(["a direction has no value on axis length"]);
  });
});

describe("R15.8 owner taste log", () => {
  const pick: Edit = (_root, consumer) => put(join(consumer, "agents", "writer", "home.hero", "ledger.json"), { schema: "clossys.ledger/1", events: [{ op: "pick", at: "2026-11-13T00:00:00Z", by: "owner", candidate: "hero-v1.md", rejected: ["hero-v2.md"] }] });
  const logged = (entries: unknown[]): Edit => (root, consumer) => {
    pick(root, consumer);
    put(join(consumer, "agents", "writer", "taste", STANDARD_ID, "taste-log.json"), { schema: "clossys.taste-log/1", standard: STANDARD_ID, entries });
  };
  it("catches an owner pick on a high-tier standard's slot with no taste-log entry", () => {
    catches(r15_8, ctxOf(pick), /owner pick of hero-v1\.md has no taste-log entry/);
  });
  it("accepts the pick once logged with its rejects; a partial entry still fails", () => {
    expect(r15_8(ctxOf(logged([{ at: "2026-11-13T00:00:00Z", slot: "home.hero", chosen: "hero-v1.md", rejected: ["hero-v2.md"], reason: "clearer" }])))).toEqual([]);
    catches(r15_8, ctxOf(logged([{ at: "2026-11-13T00:00:00Z", slot: "home.hero", chosen: "hero-v1.md", rejected: [] }])), /has no taste-log entry/);
  });
  it("ignores mid-tier standards and non-owner picks", () => {
    expect(r15_8(ctxOf((root, consumer) => { pick(root, consumer); editRequirements(doc => { doc.craftTier = "mid"; })(root, consumer); }))).toEqual([]);
    expect(r15_8(ctxOf((_root, consumer) => put(join(consumer, "agents", "writer", "home.hero", "ledger.json"), { events: [{ op: "pick", by: "planner", candidate: "hero-v1.md" }] })))).toEqual([]);
  });
});

describe("R15.9 seeds are the Designer's", () => {
  it("catches a Writer standard listing seeds", () => {
    catches(r15_9, ctxOf(editRequirements(doc => { doc.seeds = ["shadcn/button"]; })), /writer standards list no seeds/);
  });
  it("catches an adopt recipe for a standard without seeds", () => {
    catches(r15_9, ctxOf(editRecipe(doc => { doc.rung = "adopt"; })), /adopt recipe produces for fixture-headline, which has no seeds/);
  });
  it("checks Designer seeds against the policy.json registries", () => {
    const designer = (seeds: string[], registries?: string[]): Edit => (root, consumer) => {
      const dir = join(root, "packages", "designer", "standards", "element.button");
      cpSync(standardDir(root), dir, { recursive: true });
      const doc = json(join(dir, "requirements.json"));
      put(join(dir, "requirements.json"), { ...doc, id: "element.button", kinds: ["element"], mode: "adopt-first", createGaps: ["variant"], seeds });
      if (registries) put(join(consumer, "agents", "designer", "policy.json"), { seedRegistries: registries });
    };
    expect(r15_9(ctxOf(designer(["shadcn/button"], ["shadcn"])))).toEqual([]);
    catches(r15_9, ctxOf(designer(["acme/button"], ["shadcn"])), /seed acme\/button is not from a policy\.json seed registry/);
    catches(r15_9, ctxOf(designer(["shadcn/button"])), /lists no seedRegistries/);
  });
});
