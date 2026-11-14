import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonBytes, slotPositions, type IaDoc, type SlotAgent } from "../records/slot-model/index.js";
import { checkSlotModel } from "../records/slot-check.js";
import { resolveOwnerRef, validateOwnerDecisions } from "../records/owner-decisions.js";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { IA_USAGE, runIaCli, runOwnerDecisionCli } from "./owner.js";
import { validateFile } from "../pipeline/schema.js";
import { runPipeline } from "../pipeline/runner.js";

const AT = "2026-11-13T12:00:00.000Z";
const REF = "clossys/workspace#46 issuecomment-6873279813 (OWNER WORDS 2026-11-13 IA review Q1-Q7: recommended option)";
const DECISIONS = { schema: "clossys.owner-decisions/1", decisions: [{ id: "6873279813", ref: REF, date: "2026-11-13", scope: ["ia"], summary: "IA review Q1-Q7: recommended option." }] };
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));

let workspace: string;
let consumer: string;
const agentDir = (agent: string) => join(consumer, "agents", agent);
const iaOf = (agent: string) => load(join(agentDir(agent), "ia.json"));
const slotOf = (agent: string, id: string) => load(join(agentDir(agent), id, "slot.json"));

/** An agent IA and a slot.json at its derived position for every slot. */
function agentIa(agent: SlotAgent, ia: IaDoc, kind: string) {
  mkdirSync(agentDir(agent), { recursive: true });
  writeFileSync(join(agentDir(agent), "ia.json"), jsonBytes(ia));
  for (const [id, position] of slotPositions(agent, ia)) {
    mkdirSync(join(agentDir(agent), id), { recursive: true });
    writeFileSync(join(agentDir(agent), id, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id, agent, ia: position, kind, contract: {}, inputs: [], uses: [] }));
  }
}
const designer: IaDoc = {
  schema: "clossys.ia/1", source: "@clossys/designer#leaf-freeze:fixture", extensions: [], nodes: [
    { id: "assets.logo", label: "Logo", children: [{ id: "logo-artwork", label: "Artwork", slots: ["assets.logo-mark", "assets.logo-word"] }] },
    { id: "assets.app-identity", label: "App identity", children: [{ id: "app-identity-browser", label: "Browser", slots: ["assets.favicon"] }, { id: "app-identity-application", label: "Application", slots: ["assets.app-icon"] }] },
    { id: "frames.extensions", label: "Consumer extensions", children: [{ id: "extensions", label: "Signed extensions", slots: ["frames.studio-shell"] }] },
    { id: "frames.page-shells", label: "Page shells", children: [{ id: "page-shells-workspaces", label: "Workspaces", slots: ["frames.workspace"] }, { id: "page-shells-empty", label: "Empty", slots: [] }] },
  ],
};
const director: IaDoc = {
  schema: "clossys.ia/1", source: "@clossys/director#leaf-freeze:fixture", extensions: [], nodes: [
    { id: "context", label: "Context", children: [{ id: "context.market", label: "Market", slots: ["context.market.size"] }] },
    { id: "focus", label: "Focus", children: [{ id: "focus.where", label: "Where", slots: ["focus.where.segment"] }] },
    { id: "execution", label: "Execution", children: [{ id: "execution.plan", label: "Plan", slots: ["execution.plan.milestones"] }] },
  ],
  layers: [{ id: "situation", label: "Situation", nodes: ["context"] }, { id: "strategy", label: "Strategy", nodes: ["focus"] }, { id: "plan", label: "Plan", nodes: ["execution"] }],
};
const AXES = { L0: { name: "phase", values: ["Situation", "Strategy", "Plan"] }, L1: { situation: { name: "topic", values: ["Context"] }, strategy: { name: "topic", values: ["Focus"] }, plan: { name: "topic", values: ["Execution"] } } };

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-ia-regroup-")));
  consumer = join(workspace, "clossys");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(consumer, "owner-decisions.json"), jsonBytes(DECISIONS));
  agentIa("designer", designer, "element");
  agentIa("director", director, "brief");
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const ia = (...args: string[]) => runIaCli([...args, "--at", AT, "--root", workspace], workspace);
const owned = (...args: string[]) => ia(...args, "--owner-ref", "6873279813");
/** Every file under the workspace and its bytes: a refused or dry run must leave this unchanged. */
function tree(dir = workspace): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === ".clossys") continue;
    if (statSync(path).isDirectory()) Object.assign(files, tree(path));
    else files[relative(workspace, path)] = readFileSync(path, "utf8");
  }
  return files;
}
const clean = () => expect(checkSlotModel(consumer)).toEqual([]);
const lastChange = (agent: string) => iaOf(agent).changes.at(-1);

describe("--owner-ref: resolved offline against clossys/owner-decisions.json", () => {
  it("refuses a regroup with no --owner-ref, and writes nothing", async () => {
    const before = tree();
    const result = await ia("designer/frames.studio-shell", "--move", "--under", "frames.page-shells/page-shells-workspaces");
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(/--owner-ref is required/) });
    expect(tree()).toEqual(before);
  });

  it("refuses an unknown --owner-ref, and writes nothing", async () => {
    const before = tree();
    for (const ref of ["1234567890", "clossys/workspace#46 issuecomment-1234567890", "clossys/workspace#45 issuecomment-6873279813", "not a ref"]) {
      const result = await ia("designer", "--drop", "frames.page-shells/page-shells-empty", "--owner-ref", ref);
      expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(/names no owner decision|neither a ledger comment id/) });
    }
    expect(tree()).toEqual(before);
  });

  it("refuses every --owner-ref when the workspace registers no owner decision", async () => {
    rmSync(join(consumer, "owner-decisions.json"));
    const result = await owned("designer", "--drop", "frames.page-shells/page-shells-empty");
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(/owner-decisions.json does not exist/) });
  });

  it("accepts the comment id or the ledger ref, and records the registered ref on the write", async () => {
    expect(resolveOwnerRef(consumer, "6873279813", "ia")).toEqual({ decision: DECISIONS.decisions[0] });
    expect(resolveOwnerRef(consumer, "https://github.com/clossys/workspace/issues/46#issuecomment-6873279813", "ia")).toEqual({ decision: DECISIONS.decisions[0] });
    const result = await ia("designer", "--drop", "frames.page-shells/page-shells-empty", "--owner-ref", "clossys/workspace#46 issuecomment-6873279813");
    expect(result).toMatchObject({ exitCode: 0 });
    expect(lastChange("designer")).toEqual({ op: "drop", ownerRef: REF, at: AT, detail: "dropped empty L2 frames.page-shells/page-shells-empty", slotFiles: 0 });
  });

  it("validates the decision record itself", () => {
    expect(validateOwnerDecisions(DECISIONS)).toEqual([]);
    expect(validateOwnerDecisions({ ...DECISIONS, decisions: [{ ...DECISIONS.decisions[0], ref: "clossys/workspace#46 issuecomment-1" }] })).toEqual([expect.stringMatching(/cites comment 1, not its id/)]);
    expect(validateOwnerDecisions({ ...DECISIONS, decisions: [{ ...DECISIONS.decisions[0], scope: ["pins"] }] })).toEqual([expect.stringMatching(/scope/)]);
  });

  it("is optional on --contract, and recorded when given", async () => {
    const contract = join(workspace, "contract.json");
    writeFileSync(contract, jsonBytes({}));
    expect(await ia("designer/frames.workspace", "--contract", contract, "--owner-ref", "999")).toMatchObject({ exitCode: 1 });
    expect(await owned("designer/frames.workspace", "--contract", contract)).toMatchObject({ exitCode: 0 });
    expect(lastChange("designer")).toMatchObject({ op: "contract", ownerRef: REF, slotFiles: 1 });
    clean();
  });
});

describe("clossys owner-decision add: the owner step that produces clossys/owner-decisions.json", () => {
  const file = () => join(consumer, "owner-decisions.json");
  const words = (text: string, name = "words.txt") => { const path = join(workspace, name); writeFileSync(path, text); return path; };
  const add = (...args: string[]) => runOwnerDecisionCli(["add", ...args, "--root", workspace], workspace);
  const NEW_REF = "clossys/workspace#46 issuecomment-7000000001 (OWNER WORDS 2026-11-14 regroup the shells)";

  it("appends a decision the registry validator and the port schema accept, and an --owner-ref then resolves to it", async () => {
    const result = await add("--ref", NEW_REF, "--scope", "ia", "--quote-file", words("Regroup the page shells under Workspaces.\n"), "--date", "2026-11-14");
    expect(result).toMatchObject({ exitCode: 0, message: expect.stringMatching(/registered 7000000001/) });
    const doc = load(file());
    expect(doc.decisions).toEqual([...DECISIONS.decisions, { id: "7000000001", ref: NEW_REF, date: "2026-11-14", scope: ["ia"], summary: "Regroup the page shells under Workspaces." }]);
    expect(validateOwnerDecisions(doc)).toEqual([]);
    expect(validateFile("owner-decisions", "clossys/owner-decisions.json", readFileSync(file(), "utf8"))).toEqual([]);
    expect(readFileSync(file(), "utf8")).toBe(jsonBytes(doc));
    expect(resolveOwnerRef(consumer, "7000000001", "ia")).toEqual({ decision: doc.decisions[1] });
    expect((await ia("designer", "--drop", "frames.page-shells/page-shells-empty", "--owner-ref", "7000000001")).exitCode).toBe(0);
    expect(lastChange("designer")).toMatchObject({ op: "drop", ownerRef: NEW_REF });
  });

  it("starts the file when the workspace has none, through the pipeline runner", async () => {
    rmSync(file());
    const result = await runPipeline(["owner-decision", "add", "--ref", REF, "--scope", "ia", "--quote-file", words("IA review Q1-Q7: recommended option."), "--date", "2026-11-13", "--root", workspace], workspace);
    expect(result.exitCode).toBe(0);
    expect(load(file())).toEqual(DECISIONS);
  });

  it("init starts an empty registry the validators accept, and refuses an existing one or an add flag", async () => {
    const before = tree();
    expect(await runOwnerDecisionCli(["init", "--root", workspace], workspace)).toMatchObject({ exitCode: 1, message: expect.stringMatching(/exists; add a decision/) });
    await expect(runOwnerDecisionCli(["init", "--ref", REF, "--root", workspace], workspace)).rejects.toThrow(/init takes no --ref/);
    expect(tree()).toEqual(before);
    rmSync(file());
    expect(await runOwnerDecisionCli(["init", "--root", workspace], workspace)).toMatchObject({ exitCode: 0, message: expect.stringMatching(/started an empty registry/) });
    const doc = load(file());
    expect(doc).toEqual({ schema: DECISIONS.schema, decisions: [] });
    expect(validateOwnerDecisions(doc)).toEqual([]);
    expect(validateFile("owner-decisions", "clossys/owner-decisions.json", readFileSync(file(), "utf8"))).toEqual([]);
    expect((await add("--ref", REF, "--scope", "ia", "--quote-file", words("IA review Q1-Q7: recommended option."), "--date", "2026-11-13")).exitCode).toBe(0);
    expect(load(file())).toEqual(DECISIONS);
  });

  it("refuses a registered id, a bare comment id, an unknown scope, a multi-line quote and a bad date, and writes nothing", async () => {
    const before = tree();
    const quote = words("one line");
    for (const [args, message] of [
      [["--ref", REF, "--scope", "ia", "--quote-file", quote], /registered; a decision is never rewritten/],
      [["--ref", "7000000001", "--scope", "ia", "--quote-file", quote], /not a ledger ref/],
      [["--ref", NEW_REF, "--scope", "ia,pins", "--quote-file", quote], /--scope must list .*not pins/],
      [["--ref", NEW_REF, "--scope", "ia", "--quote-file", words("two\nlines", "two.txt")], /one non-empty line/],
      [["--ref", NEW_REF, "--scope", "ia", "--quote-file", quote, "--date", "14 Nov"], /date is not YYYY-MM-DD/],
    ] as const) {
      expect(await add(...args)).toMatchObject({ exitCode: 1, message: expect.stringMatching(message) });
    }
    for (const name of ["words.txt", "two.txt"]) rmSync(join(workspace, name));
    expect(tree()).toEqual(before);
  });
});

describe("clossys ia <agent>/<slot> --move", () => {
  it("moves a placed slot to another L2 group; its leaf id stays and every slot.json position follows", async () => {
    const result = await owned("designer/frames.studio-shell", "--move", "--under", "frames.page-shells/page-shells-workspaces");
    expect(result).toMatchObject({ exitCode: 0 });
    const next = iaOf("designer");
    expect(next.nodes[2].children[0].slots).toEqual([]);
    expect(next.nodes[3].children[0].slots).toEqual(["frames.workspace", "frames.studio-shell"]);
    expect(slotOf("designer", "frames.studio-shell")).toMatchObject({ id: "frames.studio-shell", ia: { l0: "frames", l1: "frames.page-shells", l2: "page-shells-workspaces", order: 5 } });
    expect(slotOf("designer", "frames.workspace").ia).toEqual({ l0: "frames", l1: "frames.page-shells", l2: "page-shells-workspaces", order: 4 });
    expect(lastChange("designer")).toEqual({ op: "move", ownerRef: REF, at: AT, detail: "moved frames.studio-shell from frames.extensions/extensions to frames.page-shells/page-shells-workspaces", slotFiles: 2 });
    clean();
  });

  it("takes <l0>/<l1>/<l2> and checks the L0", async () => {
    expect(await owned("designer/assets.favicon", "--move", "--under", "frames/page-shells/page-shells-empty")).toMatchObject({ exitCode: 0 });
    expect(slotOf("designer", "assets.favicon").ia).toMatchObject({ l0: "frames", l1: "frames.page-shells", l2: "page-shells-empty" });
    const before = tree();
    expect(await owned("designer/assets.app-icon", "--move", "--under", "themes/frames.page-shells/page-shells-empty")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/in L0 frames, not themes/) });
    expect(tree()).toEqual(before);
    clean();
  });

  it("refuses an unplaced slot and an unknown group", async () => {
    expect(await owned("designer/assets.unplaced", "--move", "--under", "assets.logo/logo-artwork")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/not placed/) });
    expect(await owned("designer/assets.favicon", "--move", "--under", "assets.logo/nope")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/has no assets.logo\/nope/) });
  });
});

describe("clossys ia <agent>/<slot> --extension", () => {
  it("keeps slot.json extension and the ia.json extensions list in sync", async () => {
    expect(await owned("designer/frames.studio-shell", "--extension", "true")).toMatchObject({ exitCode: 0 });
    expect(iaOf("designer").extensions).toEqual(["frames.studio-shell"]);
    expect(slotOf("designer", "frames.studio-shell").extension).toBe(true);
    expect(lastChange("designer")).toMatchObject({ op: "extension", slotFiles: 1 });
    clean();
    expect(await owned("designer/frames.studio-shell", "--extension", "false")).toMatchObject({ exitCode: 0 });
    expect(iaOf("designer").extensions).toEqual([]);
    expect(slotOf("designer", "frames.studio-shell")).not.toHaveProperty("extension");
    const before = tree();
    expect(await owned("designer/frames.studio-shell", "--extension", "false")).toMatchObject({ exitCode: 0, message: expect.stringMatching(/nothing written/) });
    expect(tree()).toEqual(before);
    clean();
  });

  it("rides along with a move", async () => {
    expect(await owned("designer/frames.studio-shell", "--move", "--under", "frames.page-shells/page-shells-workspaces", "--extension", "true")).toMatchObject({ exitCode: 0 });
    expect(iaOf("designer").extensions).toEqual(["frames.studio-shell"]);
    expect(slotOf("designer", "frames.studio-shell")).toMatchObject({ extension: true, ia: { l2: "page-shells-workspaces" } });
    clean();
  });
});

describe("tab and group operations", () => {
  it("--add puts a new empty L1 after its L0's last tab, and a new L2 in its tab", async () => {
    expect(await owned("designer", "--add", "assets.brand", "--label", "Brand")).toMatchObject({ exitCode: 0 });
    expect(iaOf("designer").nodes.map((node: { id: string }) => node.id)).toEqual(["assets.logo", "assets.app-identity", "assets.brand", "frames.extensions", "frames.page-shells"]);
    expect(await owned("designer", "--add", "assets.brand/brand-marks", "--label", "Marks")).toMatchObject({ exitCode: 0 });
    expect(iaOf("designer").nodes[2].children).toEqual([{ id: "brand-marks", label: "Marks", slots: [] }]);
    expect(await owned("designer", "--add", "brand", "--label", "Brand")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/carry their L0/) });
    expect(await owned("designer", "--add", "assets.logo", "--label", "Again")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/already an L1/) });
    expect(await owned("director", "--add", "identity", "--label", "Identity")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/give --layer/) });
    expect(await owned("director", "--add", "identity", "--label", "Identity", "--layer", "strategy")).toMatchObject({ exitCode: 0 });
    expect(iaOf("director").layers[1].nodes).toEqual(["focus", "identity"]);
    clean();
  });

  it("--rename changes the label and keeps the id; --id renames it and the slot.json positions follow", async () => {
    expect(await owned("designer", "--rename", "assets.app-identity", "--label", "Identity")).toMatchObject({ exitCode: 0 });
    expect(iaOf("designer").nodes[1]).toMatchObject({ id: "assets.app-identity", label: "Identity" });
    expect(slotOf("designer", "assets.favicon").ia.l1).toBe("assets.app-identity");
    expect(await owned("designer", "--rename", "assets.app-identity/app-identity-browser", "--id", "browser")).toMatchObject({ exitCode: 0 });
    expect(slotOf("designer", "assets.favicon").ia).toMatchObject({ l1: "assets.app-identity", l2: "browser" });
    expect(await owned("director", "--rename", "strategy", "--id", "direction", "--label", "Direction")).toMatchObject({ exitCode: 0 });
    expect(iaOf("director").layers[1]).toEqual({ id: "direction", label: "Direction", nodes: ["focus"] });
    expect(await owned("director", "--rename", "focus", "--id", "context")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/already an L1/) });
    clean();
  });

  it("--merge folds one tab into another (an L1 merge) and one group into another (an L2 merge)", async () => {
    expect(await owned("designer", "--merge", "assets.app-identity", "--into", "assets.logo")).toMatchObject({ exitCode: 0 });
    const next = iaOf("designer");
    expect(next.nodes.map((node: { id: string }) => node.id)).toEqual(["assets.logo", "frames.extensions", "frames.page-shells"]);
    expect(next.nodes[0].children.map((group: { id: string }) => group.id)).toEqual(["logo-artwork", "app-identity-browser", "app-identity-application"]);
    expect(slotOf("designer", "assets.favicon").ia).toEqual({ l0: "assets", l1: "assets.logo", l2: "app-identity-browser", order: 2 });
    expect(lastChange("designer")).toMatchObject({ op: "merge", slotFiles: 2 });
    expect(await owned("designer", "--merge", "assets.logo/app-identity-application", "--into", "assets.logo/app-identity-browser")).toMatchObject({ exitCode: 0 });
    expect(slotOf("designer", "assets.app-icon").ia).toEqual({ l0: "assets", l1: "assets.logo", l2: "app-identity-browser", order: 3 });
    expect(await owned("designer", "--merge", "assets.logo", "--into", "assets.logo/logo-artwork")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/within one level/) });
    clean();
  });

  it("--merge folds one L0 layer into another", async () => {
    expect(await owned("director", "--merge", "plan", "--into", "strategy")).toMatchObject({ exitCode: 0 });
    expect(iaOf("director").layers).toEqual([{ id: "situation", label: "Situation", nodes: ["context"] }, { id: "strategy", label: "Strategy", nodes: ["focus", "execution"] }]);
    clean();
  });

  it("--drop removes an empty group and refuses one that holds leaves", async () => {
    const before = tree();
    expect(await owned("designer", "--drop", "assets.logo")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/holds 2 leaves/) });
    expect(await owned("designer", "--drop", "assets.app-identity/app-identity-browser")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/holds 1 leaves/) });
    expect(await owned("director", "--drop", "plan")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/holds 1 leaves/) });
    expect(tree()).toEqual(before);
    expect(await owned("designer", "--drop", "frames.page-shells/page-shells-empty")).toMatchObject({ exitCode: 0 });
    expect(iaOf("designer").nodes[3].children.map((group: { id: string }) => group.id)).toEqual(["page-shells-workspaces"]);
    clean();
  });

  it("--reorder takes an exact permutation of one parent's members", async () => {
    expect(await owned("designer", "--reorder", "assets.app-identity", "--order", "app-identity-application,app-identity-browser")).toMatchObject({ exitCode: 0 });
    expect(slotOf("designer", "assets.app-icon").ia.order).toBe(2);
    expect(slotOf("designer", "assets.favicon").ia.order).toBe(3);
    expect(await owned("designer", "--reorder", "L0", "--order", "frames,assets")).toMatchObject({ exitCode: 0 });
    expect(iaOf("designer").nodes.map((node: { id: string }) => node.id)).toEqual(["frames.extensions", "frames.page-shells", "assets.logo", "assets.app-identity"]);
    expect(slotOf("designer", "frames.studio-shell").ia.order).toBe(0);
    expect(await owned("designer", "--reorder", "frames", "--order", "frames.page-shells,frames.extensions")).toMatchObject({ exitCode: 0 });
    expect(iaOf("designer").nodes.map((node: { id: string }) => node.id)).toEqual(["frames.page-shells", "frames.extensions", "assets.logo", "assets.app-identity"]);
    expect(await owned("designer", "--reorder", "assets.logo/logo-artwork", "--order", "assets.logo-word,assets.logo-mark")).toMatchObject({ exitCode: 0 });
    expect(await owned("designer", "--reorder", "assets.logo", "--order", "logo-artwork,extra")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/exactly once/) });
    expect(await owned("director", "--reorder", "L0", "--order", "plan,situation,strategy")).toMatchObject({ exitCode: 0 });
    expect(iaOf("director").nodes.map((node: { id: string }) => node.id)).toEqual(["execution", "context", "focus"]);
    clean();
  });
});

describe("L0 levels: layers, assign and axes, for every agent that declares layers", () => {
  it("--assign moves a whole L1 into an L0 layer (creating it with --label) and drops an emptied layer", async () => {
    expect(await owned("director", "--assign", "execution", "--layer", "strategy")).toMatchObject({ exitCode: 0 });
    expect(iaOf("director").layers.map((layer: { id: string }) => layer.id)).toEqual(["situation", "strategy"]);
    expect(await owned("director", "--assign", "context", "--layer", "ground")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/give --label/) });
    expect(await owned("director", "--assign", "context", "--layer", "ground", "--label", "Ground")).toMatchObject({ exitCode: 0 });
    expect(iaOf("director").layers).toEqual([{ id: "strategy", label: "Strategy", nodes: ["focus", "execution"] }, { id: "ground", label: "Ground", nodes: ["context"] }]);
    expect(await owned("designer", "--assign", "assets.logo", "--layer", "assets")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/no L0 layers/) });
    clean();
  });

  it("--layers declares the layers; --axes then makes them the L0 and every slot.json gains its l0", async () => {
    const layers = join(workspace, "layers.json"), axes = join(workspace, "axes.json");
    writeFileSync(layers, jsonBytes([{ id: "situation", label: "Situation", nodes: ["context"] }, { id: "strategy", label: "Strategy", nodes: ["focus", "execution"] }]));
    expect(await owned("director", "--layers", layers)).toMatchObject({ exitCode: 0 });
    expect(slotOf("director", "execution.plan.milestones").ia).toEqual({ l1: "execution", l2: "execution.plan", order: 2 });
    writeFileSync(axes, jsonBytes({ ...AXES, L1: { situation: AXES.L1.situation, strategy: AXES.L1.strategy } }));
    expect(await owned("director", "--axes", axes)).toMatchObject({ exitCode: 0 });
    expect(slotOf("director", "context.market.size").ia).toEqual({ l0: "situation", l1: "context", l2: "context.market", order: 0 });
    expect(slotOf("director", "execution.plan.milestones").ia).toEqual({ l0: "strategy", l1: "execution", l2: "execution.plan", order: 2 });
    expect(lastChange("director")).toMatchObject({ op: "axes", slotFiles: 3 });
    // Once the layers are the L0, regrouping them re-levels the slots in the same write.
    expect(await owned("director", "--assign", "execution", "--layer", "plan", "--label", "Plan")).toMatchObject({ exitCode: 0 });
    expect(slotOf("director", "execution.plan.milestones").ia).toEqual({ l0: "plan", l1: "execution", l2: "execution.plan", order: 2 });
    expect(lastChange("director")).toMatchObject({ op: "assign", slotFiles: 1 });
    clean();
  });

  it("refuses axes that do not match the schema or name a layer the IA lacks", async () => {
    const axes = join(workspace, "axes.json");
    writeFileSync(axes, jsonBytes({ L0: { name: "phase" }, L1: {} }));
    expect(await owned("director", "--axes", axes)).toMatchObject({ exitCode: 1, message: expect.stringMatching(/axes/) });
    writeFileSync(axes, jsonBytes({ ...AXES, L1: { ...AXES.L1, missing: { name: "topic", values: ["X"] } } }));
    expect(await owned("director", "--axes", axes)).toMatchObject({ exitCode: 1, message: expect.stringMatching(/axes.L1 names missing/) });
  });

  it("derives l0 from layers once axes are declared, for the Director, Producer and Publisher alike", () => {
    for (const agent of ["director", "producer", "publisher"] as const) {
      const doc: IaDoc = { schema: "clossys.ia/1", source: "x#y", extensions: [], nodes: [{ id: "one", label: "One", children: [{ id: "a", label: "A", slots: ["x.one"] }] }], layers: [{ id: "top", label: "Top", nodes: ["one"] }] };
      expect(slotPositions(agent, doc).get("x.one")).toEqual({ l1: "one", l2: "a", order: 0 });
      expect(slotPositions(agent, { ...doc, axes: { L0: { name: "level", values: ["Top"] }, L1: {} } }).get("x.one")).toEqual({ l0: "top", l1: "one", l2: "a", order: 0 });
    }
  });
});

describe("--dry", () => {
  it("prints the planned change for every operation and writes nothing", async () => {
    const contract = join(workspace, "contract.json"), layers = join(workspace, "layers.json"), axes = join(workspace, "axes.json");
    writeFileSync(contract, jsonBytes({}));
    writeFileSync(layers, jsonBytes(director.layers));
    writeFileSync(axes, jsonBytes(AXES));
    const before = tree();
    const runs: string[][] = [
      ["designer/frames.studio-shell", "--move", "--under", "frames.page-shells/page-shells-workspaces"],
      ["designer/frames.studio-shell", "--extension", "true"],
      ["designer", "--add", "assets.brand", "--label", "Brand"],
      ["designer", "--rename", "assets.logo", "--label", "Marks"],
      ["designer", "--merge", "assets.app-identity", "--into", "assets.logo"],
      ["designer", "--drop", "frames.page-shells/page-shells-empty"],
      ["designer", "--reorder", "L0", "--order", "frames,assets"],
      ["director", "--assign", "execution", "--layer", "strategy"],
      ["director", "--layers", layers, "--owner-ref", "6873279813"],
      ["director", "--axes", axes],
      ["designer/frames.workspace", "--contract", contract],
    ];
    for (const args of runs) {
      const result = await owned(...args, "--dry");
      expect(result, args.join(" ")).toMatchObject({ exitCode: 0, message: expect.stringMatching(/^ia --dry: .*wrote nothing|nothing written/), });
    }
    const moved = await owned("designer/frames.studio-shell", "--move", "--under", "frames.page-shells/page-shells-workspaces", "--dry");
    expect(moved.message).toMatch(/slot\.json frames\.studio-shell: ia frames\/frames\.extensions\/extensions#4 -> frames\/frames\.page-shells\/page-shells-workspaces#5/);
    expect(moved.output).toMatchObject({ dry: true, writes: ["clossys/agents/designer/ia.json", "clossys/agents/designer/frames.workspace/slot.json", "clossys/agents/designer/frames.studio-shell/slot.json"] });
    const axed = await owned("director", "--axes", axes, "--dry");
    expect(axed.message).toMatch(/slot\.json context\.market\.size: ia context\/context\.market#0 -> situation\/context\/context\.market#0/);
    expect(tree()).toEqual(before);
  });
});

describe("--contract --under: a slot placed before the end renumbers every later slot.json (IA-V2)", () => {
  const later = ["assets.favicon", "assets.app-icon", "frames.studio-shell", "frames.workspace"];
  const orders = () => Object.fromEntries(["assets.logo-mark", "assets.logo-word", "assets.logo-glyph", ...later].filter(id => tree()[`clossys/agents/designer/${id}/slot.json`]).map(id => [id, slotOf("designer", id).ia.order]));
  let contract: string;
  beforeEach(() => { contract = join(workspace, "contract.json"); writeFileSync(contract, jsonBytes({ shape: "svg" })); });

  it("places a slot in the middle, renumbers the later slots (order only) and passes the slot model check", async () => {
    const result = await owned("designer/assets.logo-glyph", "--contract", contract, "--under", "assets.logo/logo-artwork");
    expect(result).toMatchObject({ exitCode: 0 });
    expect(result.message).toMatch(/4 other slot\.json renumbered \(order only\)/);
    clean();
    expect(orders()).toEqual({ "assets.logo-mark": 0, "assets.logo-word": 1, "assets.logo-glyph": 2, "assets.favicon": 3, "assets.app-icon": 4, "frames.studio-shell": 5, "frames.workspace": 6 });
    expect(slotOf("designer", "assets.favicon").ia).toEqual({ l0: "assets", l1: "assets.app-identity", l2: "app-identity-browser", order: 3 });
    expect(lastChange("designer")).toEqual({ op: "place", ownerRef: REF, at: AT, detail: "placed assets.logo-glyph under assets.logo/logo-artwork; 4 later slot.json renumbered (order only)", slotFiles: 5 });
  });

  it("renumbers without an owner ref too, and records no change", async () => {
    expect(await ia("designer/assets.logo-glyph", "--contract", contract, "--under", "assets.logo/logo-artwork")).toMatchObject({ exitCode: 0 });
    clean();
    expect(slotOf("designer", "frames.workspace").ia.order).toBe(6);
    expect(iaOf("designer").changes).toBeUndefined();
  });

  it("--remove of a middle slot renumbers the later slots back", async () => {
    expect(await ia("designer/assets.logo-glyph", "--contract", contract, "--under", "assets.logo/logo-artwork")).toMatchObject({ exitCode: 0 });
    rmSync(join(agentDir("designer"), "assets.logo-glyph"), { recursive: true });
    const removed = await owned("designer/assets.logo-glyph", "--remove");
    expect(removed).toMatchObject({ exitCode: 0 });
    clean();
    expect(orders()).toEqual({ "assets.logo-mark": 0, "assets.logo-word": 1, "assets.favicon": 2, "assets.app-icon": 3, "frames.studio-shell": 4, "frames.workspace": 5 });
    expect(lastChange("designer")).toMatchObject({ op: "remove", slotFiles: 4 });
  });

  it("--dry runs the post-write slot model check in memory: it passes where the write passes and lists every file", async () => {
    const before = tree();
    const result = await owned("designer/assets.logo-glyph", "--contract", contract, "--under", "assets.logo/logo-artwork", "--dry");
    expect(result).toMatchObject({ exitCode: 0, output: { dry: true } });
    expect((result.output as { writes: string[] }).writes).toEqual([
      "clossys/agents/designer/ia.json", "clossys/agents/designer/assets.logo-glyph/slot.json",
      ...later.map(id => `clossys/agents/designer/${id}/slot.json`),
    ]);
    expect(tree()).toEqual(before);
  });

  it("--dry fails (exit 1) exactly when the real write would be refused, and writes nothing", async () => {
    const before = tree();
    const args = ["designer/assets.logo-glyph", "--contract", contract, "--under", "assets.logo/logo-artwork", "--inputs", "assets.not-a-slot"];
    const dry = await owned(...args, "--dry");
    expect(dry).toMatchObject({ exitCode: 1, message: expect.stringMatching(/^ia --dry refused: the slot model check would fail after the write: ref-unknown .*assets\.not-a-slot/) });
    expect(dry.message).toMatch(/write clossys\/agents\/designer\/assets\.logo-glyph\/slot\.json/);
    expect(dry.output).toMatchObject({ dry: true, refused: true, writes: expect.arrayContaining(["clossys/agents/designer/ia.json"]) });
    expect(tree()).toEqual(before);
    const real = await owned(...args);
    expect(real).toMatchObject({ exitCode: 1, message: expect.stringMatching(/^ia refused: the slot model check fails after the write: ref-unknown/) });
    expect(tree()).toEqual(before);
  });
});

it("ia --help lists the regroup operations", async () => {
  const help = await runIaCli(["--help"], workspace);
  for (const flag of ["--owner-ref", "--move", "--extension", "--add", "--rename", "--merge", "--drop", "--reorder", "--assign", "--layers", "--axes", "--dry"]) expect(help.message).toContain(flag);
  expect(help.message).toBe(IA_USAGE);
});
