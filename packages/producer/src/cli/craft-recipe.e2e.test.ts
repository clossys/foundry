/**
 * The craft run's recipe at the write, end to end (CRAFT-RECIPES fix r1, review-craftrecipes-blindA/B):
 * - one kind reader (F1): `next --submit` refuses a submission whose clossys header and body carry different
 *   source kinds, so the recipe check and the ref-verbatim gate judge the same field (the view's meta.source);
 * - code chooses the recipe (F2): the run's recipe is the one recipe producing for the slot's standard; a run whose
 *   events name another recipe (create.element), a made-up one, or a brief and a diverge of different recipes is
 *   refused at `next --stage` and at `next --submit`;
 * - the recipe's sources hold at submit (F3): a create.app-section run's original candidate is refused, on a
 *   section slot and on a consumer-asset slot R03.2 has nothing to say about.
 * Worlds: a copy of the consumer fixture (sections.empty-state, standard section.adaptive, recipes from the
 * installed Designer package), and the inline-gates world (themes.primary, a consumer asset) given a standard and
 * this repository's Designer recipes and standards.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { registeredRules } from "../constitution/registry.js";
import { PROVENANCE_RULE_PATH, REFERENCE_MANIFEST_PATH } from "../constitution/rules/r03.js";
import { MANIFEST, RULE } from "../constitution/rules/r03.world.js";
import { cleanSpec, ledgerDoc, ledgerEvent, NO_HISTORY, sha, slotDoc, writeWorkspace } from "../constitution/__fixtures__/workspace.js";
import { STEPS } from "../pipeline/steps/index.js";
import { submittedBytes } from "../records/slot-write.js";
import "./main.js";
import { runNextCli, runNextSubmitCli } from "./next.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = resolve(HERE, "../../..");
const FIXTURE = resolve(HERE, "../../test-fixtures/consumer");
const SLOT = "sections.empty-state";
const THEME = "themes.primary";
const skill = STEPS.find(step => step.id === "designer.candidates")!.command.skill!;
const AT = "2026-11-21T00:00:00Z";
const moved = registeredRules().filter(rule => ["R03", "R06", "R20"].includes(rule.id));
const GUARD_ON = { rules: moved, refVerbatim: true, history: () => NO_HISTORY };
const GUARD_OFF = { rules: [], refVerbatim: false, history: () => NO_HISTORY };

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type Event = Record<string, unknown>;
const craft = (op: string, fields: Event = {}): Event => ({ op, at: AT, by: "planner", verb: "submit", skill: { path: skill, sha256: "0".repeat(64) }, model: "fixture-llm", tier: "mid", ...fields });
const verdict = (): Event => ({ op: "verdict", at: AT, by: "planner", verb: "verdict", skill: { path: "packages/producer/actions/verdict/skill.md", sha256: "0".repeat(64) }, model: "fixture-llm", tier: "mid", verdict: "create" });
/** The run's craft events: a brief and a diverge naming `brief` and `diverge` (omitted when undefined). */
const run = (brief?: string, diverge?: string): Event[] => [craft("craft:brief", brief ? { recipe: brief } : {}), craft("craft:diverge", diverge ? { recipe: diverge } : {})];

/** A copy of the consumer fixture whose `slot` (sections.empty-state) is P2 (verdict create) with `events` after the verdict. */
function fixtureWorld(events: Event[], slot = SLOT): { root: string; dir: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "craft-recipe-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const dir = join(root, "clossys", "agents", "designer", slot);
  const ledger = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8")) as { events: Event[] };
  ledger.events.push(verdict(), ...events);
  writeFileSync(join(dir, "ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  return { root, dir };
}

const CODE = 'import { Button } from "@clossys/designer-ui"\n\nexport function EmptyState({ action }: { action: string }) {\n  return <Button>{action}</Button>\n}\n';
/** A section candidate of source `kind` (a composition declares components.button). */
const body = (kind: string, name = "empty-state") => ({
  name, type: "registry:block", files: [{ path: `ui/${name}.tsx`, type: "registry:block", content: CODE }],
  meta: {
    source: { kind, ref: kind === "npm" ? ["npm/left-pad@1.3.0"] : kind === "derived" ? ["shadcn-aria/button@4.23.0"] : kind === "registry" ? ["shadcn-aria/empty@4.23.0"] : [], license: "MIT", ...(kind === "composition" ? { parts: [{ slot: "components.button", files: ["registry/aria-nova/ui/button.tsx"] }] } : {}) },
    element: { id: name, reason: "Realises director:identity.visual.style: composes components.button only." },
  },
});
/** The probe's mixed shape: a clossys header of `headerKind` around the body, with a composition meta.source beside it. */
const mixed = (dir: string, headerKind: string, slot = SLOT, name = "empty-state") => {
  const headed = JSON.parse(submittedBytes(dir, "designer", slot, "element", `${name}-v1.json`, `${JSON.stringify(body(headerKind, name), null, 2)}\n`, AT)) as Event;
  const composed = body("composition", name);
  return { ...headed, name: composed.name, type: composed.type, files: composed.files, meta: composed.meta };
};

async function submit(root: string, value: unknown, guard: Record<string, unknown> = GUARD_ON, slot = SLOT) {
  writeFileSync(join(root, "made.json"), `${JSON.stringify(value, null, 2)}\n`);
  return runNextSubmitCli([`designer/${slot}`, "--submit", "made.json", "--model", "fixture-llm", "--tier", "mid", "--basis", "agent", "--skill", skill, "--rung", "L4", "--reason", "fixture: no seed realises this section"], root, undefined, undefined, guard);
}
const written = (dir: string) => (existsSync(join(dir, "candidates")) ? readdirSync(join(dir, "candidates")).sort() : []);
const ops = (dir: string) => (JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8")) as { events: Event[] }).events.map(event => String(event.op)).filter(op => op.startsWith("craft:"));

describe("one kind reader: a header and a body that disagree are refused by name (F1)", () => {
  it("refuses the mixed shape (header npm, body meta.source composition) on sections.empty-state and writes nothing", async () => {
    const { root, dir } = fixtureWorld(run("create.app-section", "create.app-section"));
    const refused = await submit(root, mixed(dir, "npm"));
    expect(refused.exitCode, refused.message).toBe(1);
    expect(refused.message).toMatch(/source-kind-mismatch: clossys\.source kind npm, meta\.source kind composition disagree; fix: carry one source/);
    expect(written(dir)).toEqual([]);
  });

  it("refuses the mixed shape for every header kind, the guard off too: the refusal is the reader's, not a rule's", async () => {
    for (const kind of ["original", "derived", "registry"]) {
      const { root, dir } = fixtureWorld(run("create.app-section", "create.app-section"));
      const refused = await submit(root, mixed(dir, kind), GUARD_OFF);
      expect(refused.exitCode, `${kind}: ${refused.message}`).toBe(1);
      expect(refused.message).toContain(`source-kind-mismatch: clossys.source kind ${kind}, meta.source kind composition disagree`);
      expect(written(dir)).toEqual([]);
    }
  });
});

describe("code chooses the run's recipe; the events never do (F2)", () => {
  const REFUSALS: [string, Event[], RegExp][] = [
    ["a diverge naming create.element", run("create.app-section", "create.element"), /craft:diverge names recipe create\.element, which does not produce for section\.adaptive/],
    ["a made-up recipe id", run("create.app-section", "create.nope"), /craft:diverge names recipe create\.nope, which is not a valid recipe under packages\/designer\/recipes\//],
    ["a brief and a diverge of different recipes", run("create.app-section", "create.frame"), /the run's craft events name recipes create\.app-section \(craft:brief\), create\.frame \(craft:diverge\); one run is one recipe/],
    ["a brief alone naming another standard's recipe", run("create.frame"), /craft:brief names recipe create\.frame, which does not produce for section\.adaptive/],
  ];
  for (const [label, events, reason] of REFUSALS) {
    it(`refuses at submit a run with ${label}, whatever the candidate, and writes nothing`, async () => {
      const { root, dir } = fixtureWorld(events);
      const refused = await submit(root, body("original"), GUARD_OFF);
      expect(refused.exitCode, refused.message).toBe(1);
      expect(refused.message).toMatch(/^.*craft-recipe: /m);
      expect(refused.message).toMatch(reason);
      expect(refused.message).toContain("fix: craft the run under the recipe that produces for the slot's standard");
      expect(written(dir)).toEqual([]);
    });
  }

  it("refuses at next --stage a diverge naming create.element, a made-up id or another recipe than the brief's, and records nothing", async () => {
    for (const [recipe, reason] of [
      ["create.element", /craft:diverge refused: .*craft:diverge names recipe create\.element, which does not produce for section\.adaptive/],
      ["create.nope", /craft:diverge refused: .*craft:diverge names recipe create\.nope, which is not a valid recipe/],
      ["create.frame", /craft:diverge refused: the run's craft events name recipes create\.app-section \(craft:brief\), create\.frame \(craft:diverge\)/],
    ] as const) {
      const { root, dir } = fixtureWorld([craft("craft:brief", { recipe: "create.app-section" })]);
      writeFileSync(join(root, "directions.json"), `${JSON.stringify({ recipe, directions: [] })}\n`);
      const before = ops(dir);
      const refused = await runNextCli([`designer/${SLOT}`, "--stage", "diverge", "--file", "directions.json", "--recipe", recipe, "--model", "fixture-llm", "--tier", "mid", "--skill", skill], root);
      expect(refused.exitCode, `${recipe}: ${refused.message}`).not.toBe(0);
      expect(refused.message).toMatch(reason);
      expect(ops(dir)).toEqual(before);
    }
  });
});

describe("the chosen recipe's sources hold at submit (F3)", () => {
  it("refuses an original or npm candidate under a consistent create.app-section run, the guard off: only the recipe check stands (mutation: delete craftRecipeRefusal in next.ts)", async () => {
    for (const kind of ["original", "npm"]) {
      const { root, dir } = fixtureWorld(run("create.app-section", "create.app-section"));
      const refused = await submit(root, body(kind), GUARD_OFF);
      expect(refused.exitCode, `${kind}: ${refused.message}`).toBe(1);
      expect(refused.message).toContain(`recipe create.app-section crafts composition candidates; this one's meta.source.kind is ${kind}; fix: submit a composition candidate`);
      expect(written(dir)).toEqual([]);
    }
  });

  it("refuses an original at the create rung with no craft event recorded: code still chooses the recipe from the standard", async () => {
    const { root, dir } = fixtureWorld([]);
    const refused = await submit(root, body("original"), GUARD_OFF);
    expect(refused.exitCode, refused.message).toBe(1);
    expect(refused.message).toContain("recipe create.app-section crafts composition candidates; this one's meta.source.kind is original");
    expect(written(dir)).toEqual([]);
  });

  it("takes a composition under the same run past the recipe check (the guard off), so the refusals above are the recipe's", async () => {
    const { root, dir } = fixtureWorld(run("create.app-section", "create.app-section"));
    const taken = await submit(root, body("composition"), GUARD_OFF);
    expect(taken.exitCode, taken.message).toBe(0);
    expect(written(dir)).toEqual(["empty-state-v1.json"]);
  });

  it("on a consumer-asset slot R03.2 is silent on an original, and the recipe refuses it", async () => {
    const base = cleanSpec();
    const doc = slotDoc("designer", THEME, { inputs: ["brand.voice"] });
    const theme = { ...doc, ia: { ...(doc.ia as object), order: 2 }, standard: "section.adaptive" };
    base.designer![THEME] = {
      slot: theme, pin: false,
      ledger: ledgerDoc([
        ledgerEvent("slot", "ia", "packages/producer/actions/ia/skill.md", {}, [{ file: "slot.json", sha256: sha(`${JSON.stringify(theme, null, 2)}\n`) }]),
        ledgerEvent("verdict", "verdict", "packages/producer/actions/verdict/skill.md", { verdict: "create", model: "fixture-llm", tier: "high" }),
        ledgerEvent("craft:brief", "submit", skill, { recipe: "create.app-section" }),
        ledgerEvent("craft:diverge", "submit", skill, {}),
      ]),
    };
    const { root, consumer } = writeWorkspace(base);
    roots.push(root);
    writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
    const put = (rel: string, value: unknown) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), `${JSON.stringify(value, null, 2)}\n`); };
    put(PROVENANCE_RULE_PATH, { ...RULE, consumerAssets: { slots: [...RULE.consumerAssets.slots, "themes.*"] } });
    put(REFERENCE_MANIFEST_PATH, MANIFEST);
    for (const folder of ["recipes", "standards"]) cpSync(join(PACKAGES, "designer", folder), join(root, "packages", "designer", folder), { recursive: true });
    const dir = join(consumer, "agents", "designer", THEME);
    const original = body("original", "primary");
    // R03.2 owes nothing to a consumer asset's original, so the guard is silent; the recipe code chose refuses it.
    const refused = await submit(root, original, GUARD_ON, THEME);
    expect(refused.exitCode, refused.message).toBe(1);
    expect(refused.message).toContain("recipe create.app-section crafts composition candidates; this one's meta.source.kind is original");
    expect(refused.message).not.toMatch(/R03\.2/);
    expect(written(dir)).toEqual([]);
  });

  it("on the fixture's consumer-asset slot assets.image (clossys.slot/2) the mixed shape, header original and body composition, is refused by name", async () => {
    const ASSET = "assets.image";
    const { root, dir } = fixtureWorld([], ASSET);
    const before = written(dir);
    const mismatch = await submit(root, mixed(dir, "original", ASSET, "image"), GUARD_ON, ASSET);
    expect(mismatch.exitCode, mismatch.message).toBe(1);
    expect(mismatch.message).toContain("source-kind-mismatch: clossys.source kind original, meta.source kind composition disagree");
    expect(written(dir)).toEqual(before);
  });
});
