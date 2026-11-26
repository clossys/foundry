/**
 * CP1-U3: a consumer page declares the Writer meta leaf it placed in the adopted Writer IA as a consumer extension
 * (`clossys ia writer/<leaf> --extension true`), so R01.5 reads it as a listed extension; a package leaf's extension
 * flag stays the package's (refused), and `--remove` still refuses a leaf that holds a record.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { directorIa, jsonBytes, slotPositions, writerIa, type IaDoc } from "../records/slot-model/index.js";
import { isAgentLoop, withAgentLoopsIa } from "../loop/agent-loops-ia.js";
import { applySlotsMigration, planSlotsMigration } from "../migrate/slots.js";
import { buildContext, installedFoundryLeaves } from "../constitution/context.js";
import { foundryPlaced } from "../constitution/checks/R01-catalog.js";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { runIaCli } from "./owner.js";

const AT = "2026-11-25T12:00:00.000Z";
const REF = "clossys/workspace#46 issuecomment-7181191056 (OWNER WORDS 2026-11-25: consumer pages declare their own leaves)";
const DECISIONS = { schema: "clossys.owner-decisions/1", decisions: [{ id: "7181191056", ref: REF, date: "2026-11-25", scope: ["ia"], summary: "Consumer pages declare their own leaves." }] };
const META_L1 = "copy.page-metadata";
const CONSUMER_META = "page.agents.meta";

let workspace: string;
let consumer: string;
let packageMeta: string;
const writerDir = () => join(consumer, "agents", "writer");
const iaOf = () => JSON.parse(readFileSync(join(writerDir(), "ia.json"), "utf8")) as IaDoc;
const ia = (...args: string[]) => runIaCli([...args, "--at", AT, "--root", workspace, "--owner-ref", "7181191056"], workspace);
function tree(dir = workspace): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(files, tree(path));
    else files[relative(workspace, path)] = readFileSync(path, "utf8");
  }
  return files;
}
/** R01.5 over the workspace, judged against the installed Writer package leaves. */
const r01_5 = () => foundryPlaced(buildContext(workspace, consumer, { foundryLeaves: installedFoundryLeaves })).map(row => `${row.agent}/${row.slot}`);

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-ia-extension-")));
  consumer = join(workspace, "clossys");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(consumer, "owner-decisions.json"), jsonBytes(DECISIONS));
  // The adopted Writer IA (package-sourced): one package meta group as the package places it, plus the consumer's own
  // meta group (`ia writer --add copy.page-metadata/agents`) holding the meta leaf its page placed.
  const pkg = writerIa().ia;
  const meta = pkg.nodes.find(node => node.id === META_L1)!;
  const group = meta.children[0]!;
  packageMeta = group.slots[0]!;
  // Both IAs also place their agent's Producer loop leaves, as `clossys loop` does (their loop records are not needed here).
  const doc = withAgentLoopsIa("writer", {
    schema: pkg.schema, source: pkg.source, extensions: [],
    nodes: [{ id: META_L1, label: meta.label, children: [{ id: group.id, label: group.label, slots: [packageMeta] }, { id: "agents", label: "agents", slots: [CONSUMER_META] }] }],
  });
  const director = directorIa().ia;
  const docs = { writer: doc, director: withAgentLoopsIa("director", { schema: director.schema, source: director.source, extensions: [], nodes: [], layers: [], axes: { ...director.axes, L0: { ...director.axes!.L0, values: [] }, L1: {} } }) };
  for (const [agent, each] of Object.entries(docs) as [keyof typeof docs, IaDoc][]) {
    const dir = join(consumer, "agents", agent);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ia.json"), jsonBytes(each));
    for (const [id, position] of slotPositions(agent, each)) {
      if (isAgentLoop(id)) continue;
      mkdirSync(join(dir, id), { recursive: true });
      writeFileSync(join(dir, id, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id, agent, ia: position, kind: "strings", standard: "string", contract: {}, inputs: [], uses: [] }));
    }
  }
  const plan = planSlotsMigration(workspace, { at: AT, version: "0.0.0-test" });
  expect(plan.findings).toEqual([]);
  applySlotsMigration(workspace, plan, { at: AT, version: "0.0.0-test" });
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe("a consumer-placed Writer meta leaf in an adopted IA", () => {
  it("(c) is declared a consumer extension with --extension true, and R01.5 then passes it", async () => {
    expect(r01_5()).toEqual([`writer/${CONSUMER_META}`]);
    expect(await ia(`writer/${CONSUMER_META}`, "--extension", "true")).toMatchObject({ exitCode: 0 });
    expect(iaOf().extensions).toEqual([CONSUMER_META]);
    expect(r01_5()).toEqual([]);
  });

  it("(d) a package leaf with --extension is still refused, and nothing is written", async () => {
    const before = tree();
    expect(await ia(`writer/${packageMeta}`, "--extension", "true")).toMatchObject({ exitCode: 1, message: expect.stringMatching(new RegExp(`extension flag of ${packageMeta.replace(/\./g, "\\.")}.*package IA`)) });
    expect(tree()).toEqual(before);
  });

  it("(d') a Producer loop leaf (Director, Writer) with --extension is refused as a package leaf, and nothing is written", async () => {
    const before = tree();
    for (const target of ["director/loop.scope", "writer/loop.cascade"]) {
      expect(await ia(target, "--extension", "true")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/extension flag of loop\.(scope|cascade).*package IA/) });
    }
    expect(tree()).toEqual(before);
  });

  it("--remove still refuses the declared leaf while it holds a record", async () => {
    expect(await ia(`writer/${CONSUMER_META}`, "--extension", "true")).toMatchObject({ exitCode: 0 });
    mkdirSync(join(writerDir(), CONSUMER_META, "candidates"), { recursive: true });
    writeFileSync(join(writerDir(), CONSUMER_META, "candidates", `${CONSUMER_META}-v1.json`), "{}\n");
    const before = tree();
    expect(await ia(`writer/${CONSUMER_META}`, "--remove")).toMatchObject({ exitCode: 1 });
    expect(tree()).toEqual(before);
  });
});
