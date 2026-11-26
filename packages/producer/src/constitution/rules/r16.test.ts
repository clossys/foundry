import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRecipes } from "../../records/recipes.js";
import { loadStandards, standardFor } from "../../records/standards.js";
import { CERTIFY_KEY_FIELDS, requirementsVerdict } from "../criteria/core/verdict.js";
import { liveSlotRecords } from "../checks/shared.js";
import { buildContext } from "../context.js";
import { expectCatches, NO_FOUNDRY_LEAVES, NO_HISTORY } from "../__fixtures__/workspace.js";
import type { Check, ConstitutionContext } from "../types.js";
import { put, RECIPE_ID, recipeDir, STANDARD_ID, standardDir, standardSpec, standardWorld, type Edit } from "./r15.world.js";
import { importSpecifiers, importsRecipe, judgeFiles, manifestIssues, mixedChanges, R16, R16_CHECKS, r16_1, r16_2, r16_3, r16_4 } from "./r16.js";

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const ctxOf = (edit?: Edit) => standardWorld(undefined, edit).ctx;
const repoCtx = { root: REPO } as unknown as ConstitutionContext;

function catches(check: Check, broken: ConstitutionContext, reason: RegExp, clean: ConstitutionContext = ctxOf()) {
  const rows = expectCatches(check, clean, broken);
  expect(rows.map(row => row.reason).join("\n")).toMatch(reason);
  for (const row of rows) expect(row.rule).toBe("R16");
  return rows;
}

describe("R16 module", () => {
  it("declares R16.1-R16.4 and is clean on the fixture world", () => {
    expect(R16.rule).toBe("R16");
    expect(Object.keys(R16_CHECKS)).toEqual(["R16.1", "R16.2", "R16.3", "R16.4"]);
    const ctx = ctxOf();
    for (const [id, check] of Object.entries(R16_CHECKS)) expect(check(ctx), id).toEqual([]);
  });

  it("the repository's own judge source imports no recipe and names none (R16.1, R16.4 over the real tree)", () => {
    const files = judgeFiles(REPO);
    expect(files).toContain("packages/producer/src/constitution/criteria/core/verdict.ts");
    expect(files).toContain("packages/producer/src/records/standards.ts");
    expect(files.some(file => /\.test\.ts$/.test(file))).toBe(false);
    expect(r16_1(repoCtx)).toEqual([]);
    expect(r16_4(repoCtx)).toEqual([]);
  });
});

describe("R16.1 judges import no recipe", () => {
  it("reads every import form", () => {
    const source = "import a from \"./a.js\";\nexport { b } from '../b.js';\nimport \"./side.js\";\nconst c = await import(\"./c.js\");\nconst d = require('./d.cjs');\n";
    expect(importSpecifiers(source)).toEqual(["./a.js", "../b.js", "./side.js", "./c.js", "./d.cjs"]);
  });
  it("resolves relative and package specifiers to packages/(*)/recipes/", () => {
    const file = "packages/producer/src/constitution/certify/run.ts";
    expect(importsRecipe(file, "../../../../writer/recipes/x/generate.mjs")).toBe(true);
    expect(importsRecipe(file, "../criteria/core/index.js")).toBe(false);
    expect(importsRecipe(file, "../../records/recipes.js")).toBe(false);
    expect(importsRecipe(file, "@clossys/writer/recipes/x/generate.mjs")).toBe(true);
  });
  it("catches a certifier and a critic tool importing a recipe", () => {
    catches(r16_1, ctxOf(root => put(join(root, "packages", "producer", "src", "constitution", "certify", "run.ts"), `import gen from "../../../../writer/recipes/${RECIPE_ID}/generate.mjs";\nexport default gen;\n`)), /imports \.\.\/\.\.\/\.\.\/\.\.\/writer\/recipes\/fixture-headline-craft\/generate\.mjs, a recipe/);
    catches(r16_1, ctxOf(root => put(join(root, "packages", "writer", "actions", "critic", "score.mjs"), `export { default } from "../../recipes/${RECIPE_ID}/generate.mjs";\n`)), /a recipe: the judge never reads the maker/);
  });
});

const MANIFEST = [
  { role: "taste", ref: `packages/writer/standards/${STANDARD_ID}/taste.md` },
  { role: "exemplar", ref: `packages/writer/standards/${STANDARD_ID}/exemplars/plain-claim.md` },
  { role: "exemplar", ref: "https://example.com/headlines/a" },
  { role: "contract", ref: "clossys/agents/writer/home.hero/slot.json#contract" },
  { role: "render", ref: "renders/anon-1.png" },
];
const critique = (change: (doc: Record<string, unknown>) => void = () => {}, name = "hero-v1.json"): Edit => (_root, consumer) => {
  const doc: Record<string, unknown> = { schema: "clossys.critique/1", slot: "home.hero", candidate: "hero-v1.md", standard: STANDARD_ID, scores: { clarity: 4, voice: 3 }, packet: { manifest: MANIFEST.map(item => ({ ...item })) } };
  change(doc);
  put(join(consumer, "agents", "writer", "home.hero", "critiques", name), doc);
};
const manifestOf = (doc: Record<string, unknown>) => (doc.packet as { manifest: { role: string; ref: string }[] }).manifest;

describe("R16.2 critique packets list only the standard, the contract and the render", () => {
  it("accepts a clean packet", () => {
    expect(r16_2(ctxOf(critique()))).toEqual([]);
  });
  it("catches a recipe, its craft notes or direction notes in the packet", () => {
    catches(r16_2, ctxOf(critique(doc => manifestOf(doc).push({ role: "exemplar", ref: `packages/writer/recipes/${RECIPE_ID}/craft.md` }))), /lists packages\/writer\/recipes\/fixture-headline-craft\/craft\.md: never a recipe file/);
    catches(r16_2, ctxOf(critique(doc => manifestOf(doc).push({ role: "render", ref: "work/directions/a.md" }))), /never a recipe file, direction notes or the maker/);
  });
  it("catches a taste ref outside the standard, a missing render and a wrong contract ref", () => {
    catches(r16_2, ctxOf(critique(doc => { manifestOf(doc)[0]!.ref = "notes/taste.md"; })), /notes\/taste\.md/);
    catches(r16_2, ctxOf(critique(doc => { (doc.packet as { manifest: unknown[] }).manifest = MANIFEST.filter(item => item.role !== "render"); })), /lists no render/);
    catches(r16_2, ctxOf(critique(doc => { manifestOf(doc)[3]!.ref = "clossys/agents/writer/other/slot.json"; })), /contract ref .* is not clossys\/agents\/writer\/home\.hero\/slot\.json#contract/);
  });
  it("catches an invalid record, a wrong slot and a misnamed file", () => {
    catches(r16_2, ctxOf(critique(doc => { delete doc.packet; })), /critique .*packet/);
    catches(r16_2, ctxOf(critique(doc => { doc.slot = "other.slot"; })), /names slot other\.slot/);
    catches(r16_2, ctxOf(critique(() => {}, "hero-v9.json")), /hero-v9\.json is not named for candidate hero-v1\.md/);
  });
  it("manifestIssues is pure over its inputs", () => {
    expect(manifestIssues({ standard: STANDARD_ID, packet: { manifest: MANIFEST } }, "writer", "clossys/agents/writer/home.hero")).toEqual([]);
  });
});

describe("R16.3 standards change through clossys standard; recipes separately", () => {
  const ledger = (events: unknown[]): Edit => root => put(join(standardDir(root), "ledger.json"), { schema: "clossys.ledger/1", events });
  const recorded = () => JSON.parse(readFileSync(fileURLToPath(new URL(`../__fixtures__/standards/${STANDARD_ID}/ledger.json`, import.meta.url)), "utf8")) as { events: Record<string, unknown>[] };
  it("catches a standard with no ledger, or changed by an agent seat", () => {
    catches(r16_3, ctxOf(ledger([])), /no ledger event/);
    catches(r16_3, ctxOf(ledger([{ ...recorded().events[0], by: "agent:writer" }])), /by agent:writer: standards change by owner or planner only/);
    catches(r16_3, ctxOf(ledger([{ ...recorded().events[0], verb: "submit" }])), /verb submit is not standard/);
  });
  it("catches a standard edited outside the verb (files differ from the last event)", () => {
    catches(r16_3, ctxOf(root => { const path = join(standardDir(root), "taste.md"); writeFileSync(path, `${readFileSync(path, "utf8")}\n`); }), /changed outside the verb/);
  });
  it("finds commits and a working tree that change a standard and a recipe together", () => {
    const git = (args: string[]) => args[0] === "log"
      ? "@@aaa\npackages/writer/standards/x/taste.md\npackages/writer/recipes/y/craft.md\n\n@@bbb\npackages/writer/recipes/y/craft.md\n"
      : " M packages/designer/standards/s/taste.md\n?? packages/designer/recipes/r/recipe.json\n";
    expect(mixedChanges("/nowhere", git)).toEqual([
      { commit: "aaa", standards: ["packages/writer/standards/x/taste.md"], recipes: ["packages/writer/recipes/y/craft.md"] },
      { commit: "working tree", standards: ["packages/designer/standards/s/taste.md"], recipes: ["packages/designer/recipes/r/recipe.json"] },
    ]);
    expect(mixedChanges("/nowhere", () => { throw new Error("not a git repository"); })).toEqual([]);
  });
});

describe("R16.4 a verdict is a pure function of candidate, standard, contract and pin set", () => {
  it("the certify key has no recipe field", () => {
    expect([...CERTIFY_KEY_FIELDS]).toEqual(["candidate", "standard", "contract", "pinSet"]);
  });

  it("catches a criterion or certifier source that names a recipe", () => {
    catches(r16_4, ctxOf(root => put(join(root, "packages", "producer", "src", "constitution", "criteria", "core", "leak.ts"), "import { loadRecipes } from \"../../../records/recipes.js\";\nexport const leak = loadRecipes;\n")), /names (?:records\/recipes|loadRecipes): a verdict reads no recipe/);
    catches(r16_4, ctxOf(root => put(join(root, "packages", "producer", "src", "constitution", "certify", "cache.ts"), "export const hint = \"packages/writer/recipes/\";\n")), /names packages\/writer\/recipes\//);
  });

  /** Every verdict of every live slot's candidates, from the standards and slot records alone. */
  async function verdicts(root: string, consumer: string): Promise<string> {
    const ctx = buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES });
    const standards = loadStandards(root);
    const out: unknown[] = [];
    for (const slot of liveSlotRecords(ctx)) {
      const doc = slot.slot?.value as { kind: string; standard: string; contract: unknown };
      const standard = standardFor(standards, slot.agent, doc.standard)!;
      for (const candidate of slot.candidates) {
        out.push(await requirementsVerdict({
          candidate: { name: candidate.name, bytes: candidate.text }, kind: doc.kind,
          standard: { id: standard.id, sha256: standard.sha256, requirements: standard.doc!.requirements },
          contract: doc.contract, pinSet: "sha256:none",
        }));
      }
    }
    return JSON.stringify(out);
  }

  const CANDIDATES = {
    "hero-v1.md": "---\nsource:\n  kind: authored\n---\nShip the page you meant to write.\n",
    "hero-v2.md": "---\nsource:\n  kind: authored\n---\nTODO: lorem ipsum headline that keeps going far past any twelve word limit for a headline.\n",
  };
  const spec = () => { const value = standardSpec(); value.writer!["home.hero"]!.candidates = CANDIDATES; value.writer!["home.hero"]!.pin = false; return value; };

  it("editing every recipe leaves every verdict byte-identical", async () => {
    const { root, consumer } = standardWorld(spec());
    const before = await verdicts(root, consumer);
    const parsed = JSON.parse(before) as { pass: boolean }[];
    expect(parsed.map(verdict => verdict.pass)).toEqual([true, false]);
    expect(loadRecipes(root)).toHaveLength(1);
    // Edit every byte of every recipe: rewrite each file, change produces, rung and axes, add a generator.
    for (const recipe of loadRecipes(root)) {
      const dir = join(root, recipe.dir);
      const walk = (abs: string) => {
        for (const name of readdirSync(abs)) {
          const path = join(abs, name);
          if (statSync(path).isDirectory()) walk(path);
          else writeFileSync(path, `${readFileSync(path, "utf8")}\n<!-- edited by the R16.4 test -->\n`);
        }
      };
      walk(dir);
      put(join(dir, "recipe.json"), { schema: "clossys.recipe/1", id: recipe.id, produces: [STANDARD_ID], rung: "adapt", tier: "mid", axes: ["mood"], generator: "generate.mjs" });
      put(join(dir, "generate.mjs"), "export default input => `${input} (generated)`;\n");
      put(join(dir, "craft.md"), "# rewritten\n\nA different recipe entirely.\n");
    }
    expect(JSON.stringify(loadRecipes(root).map(recipe => recipe.files))).not.toBe(JSON.stringify([]));
    expect(await verdicts(root, consumer)).toBe(before);
  });

  it("the same test is sensitive: editing the standard changes the verdicts (the recipe edit above is a real no-op)", async () => {
    const { root, consumer } = standardWorld(spec());
    const before = await verdicts(root, consumer);
    const path = join(recipeDir(root), "..", "..", "standards", STANDARD_ID, "requirements.json");
    const doc = JSON.parse(readFileSync(path, "utf8")) as { requirements: { check: string; params: Record<string, unknown> }[] };
    doc.requirements = doc.requirements.filter(item => item.check !== "text.no-placeholder");
    put(path, doc);
    expect(await verdicts(root, consumer)).not.toBe(before);
  });
});
