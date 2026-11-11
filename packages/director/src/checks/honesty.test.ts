import { store, reader } from "../../test/store.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARCHETYPE_RECORD_ID } from "../archetype.js";
import { discoverBriefContracts } from "../brief-contracts.js";
import { loadCatalog } from "../catalog.js";
import { main } from "../cli.js";
import { formatRef } from "../format/ref.js";
import type { Cell, Ref } from "../format/types.js";
import { evidenceDir, stageFinding, stageSlot, strategyRoot, type SlotFixture } from "../__fixtures__/slot-model.js";
import { readStrategyRoot } from "../store.js";
import { checkCell, completion, strategyStatus } from "./index.js";
import { recordedJudgeVerdicts } from "./judgements.js";

const catalog = loadCatalog();
const bases: string[] = [];
const CORE = catalog.archetypes.default[0]!;
const NON_CORE = catalog.cells.map(cell => cell.id).find(id => !Object.values(catalog.archetypes.extras).flat().includes(id) && !catalog.archetypes.default.includes(id))!;
const BULK = { decidedBy: "owner:2026-11-03 pin-if-agree", basis: "bulk" };

/** A full flat root: every catalog cell owner-picked at v1 with valid bullets and resolving citations. */
function fullRoot(): { root: string; base: string; cells: Cell[] } {
  const base = mkdtempSync(join(tmpdir(), "director-honesty-")); bases.push(base);
  const root = strategyRoot(base);
  const cells: Cell[] = catalog.cells.map((def, i) => ({
    id: def.id, version: 1, status: "active", updated: "2026-10-29", path: `${def.id}/candidates/fixture-v1.md`,
    cites: [{ kind: "finding", id: "sample" }], feeds: [], functions: def.functions,
    direction: def.mustContain.map(({ key }, k) => ({ text: key === "Date" ? (def.id.endsWith("long-term") ? "2030-01-01" : "2027-01-01") : `Only Sample ${i} choice ${k} for 20 teams`, key, refs: [], line: 1 })),
    because: [{ text: "Sample observation (finding:sample)", refs: [{ kind: "finding", id: "sample" }], line: 1 }],
    watch: [{ text: "If trial count > 10 each month, then review this choice.", refs: [], line: 1 }],
  }));
  for (const link of catalog.coherence.links) {
    const cell = cells.find(cell => cell.id === link.downstream);
    if (cell && cells.some(cell => cell.id === link.upstream)) {
      const ref: Ref = { kind: "cell", ref: { cell: link.upstream, version: 1 } };
      cell.cites.push(ref); cell.because.push({ text: `Sample dependency (${formatRef(ref)})`, refs: [ref], line: 1 });
    }
  }
  for (const cell of cells) stage(root, cell);
  stageFinding(root, "sample", "---\nid: sample\nsource: user\nobserved: 2026-10-29\nby: researcher\n---\n- Sample observation.\n");
  const critic = catalog.coherence.storyline.map(id => `${id}@1`);
  stageFinding(root, "critic-pass", `---\nid: critic-pass\nsource: user\nobserved: 2026-11-10\nby: critic\njudge: C4\nverdict: pass\njudged: ${JSON.stringify(critic)}\n---\n- Pre-mortem read.\n`);
  return { root, base, cells };
}
function stage(root: string, cell: Cell, options: SlotFixture = {}) {
  return stageSlot(root, cell.id, cell.version, cell.direction.map(bullet => `${bullet.key}: ${bullet.text}`), {
    refs: cell.cites.map(formatRef), functions: cell.functions, because: cell.because.map(bullet => bullet.text), watch: cell.watch.map(bullet => bullet.text), ...options,
  });
}
function invoke(argv: string[]) {
  const print = vi.spyOn(console, "log").mockImplementation(() => {});
  try { const code = main([...argv, "--json"], store); return { code, value: JSON.parse(print.mock.calls[0]![0]) }; }
  finally { print.mockRestore(); }
}
const cellOf = (root: string, id: string) => strategyStatus(readStrategyRoot(root, reader), { scope: "full" }).cells.find(cell => cell.id === id)!;
afterEach(() => { vi.restoreAllMocks(); bases.splice(0).forEach(base => rmSync(base, { recursive: true, force: true })); });

describe("W5b item 1: completion counts only pins its decider allows", () => {
  it("a bulk, planner or agent pin of a core cell is not complete, with the reason", () => {
    const { root, cells } = fullRoot();
    expect(completion(readStrategyRoot(root, reader)).mvs).toBe(true);
    const core = cells.find(cell => cell.id === CORE)!;
    for (const pin of [BULK, { decidedBy: "planner:w5b", basis: "planner" }, { decidedBy: "agent:critic", basis: "agent" }, { decidedBy: "owner", basis: "bulk" }]) {
      stage(root, core, { pin });
      const cell = cellOf(root, CORE);
      expect(cell.active).toBe(false);
      const finding = cell.findings.find(finding => finding.code === "pin-basis");
      expect(finding).toMatchObject({ rule: "Q7", severity: "hard" });
      expect(finding!.message).toContain(pin.basis);
      expect(finding!.message).toContain("owner-picked");
      expect(completion(readStrategyRoot(root, reader)).mvs).toBe(false);
    }
    stage(root, core, { pin: { decidedBy: "owner:2026-11-10 interview", basis: "picked" } });
    expect(cellOf(root, CORE).active).toBe(true);
    expect(completion(readStrategyRoot(root, reader)).mvs).toBe(true);
  });
  it("a non-core cell also counts when agent-picked, never when bulk", () => {
    const { root, cells } = fullRoot();
    const cell = cells.find(cell => cell.id === NON_CORE)!;
    stage(root, cell, { pin: { decidedBy: "agent:critic", basis: "agent" } });
    expect(cellOf(root, NON_CORE).active).toBe(true);
    stage(root, cell, { pin: BULK });
    expect(cellOf(root, NON_CORE)).toMatchObject({ active: false });
    expect(completion(readStrategyRoot(root, reader)).complete).toBe(false);
    // An agent basis needs an agent seat.
    stage(root, cell, { pin: { decidedBy: "owner", basis: "agent" } });
    expect(cellOf(root, NON_CORE).active).toBe(false);
  });
});

describe("W5b item 2: the archetype is set by the director verb", () => {
  it("archetype <name> --by owner writes the record that status and complete read", () => {
    const { root, base } = fullRoot();
    expect(invoke(["complete", "--level", "mvs", "--root", root]).value.result.core.counts.total).toBe(24);
    expect(invoke(["archetype", "--root", root]).value.result).toMatchObject({ archetype: "default", recorded: null });
    const set = invoke(["archetype", "product-saas", "--by", "owner:2026-11-10 interview", "--root", root]);
    expect(set).toMatchObject({ code: 0, value: { result: { archetype: "product-saas", changed: true } } });
    const record = join(evidenceDir(root), `${ARCHETYPE_RECORD_ID}.md`);
    expect(readFileSync(record, "utf8")).toContain("value: product-saas");
    expect(readStrategyRoot(root, reader).tree?.archetype).toBe("product-saas");
    // No --archetype flag: the record alone widens the core.
    const saas = invoke(["complete", "--level", "mvs", "--root", root]);
    expect(saas.value.result.core.counts.total).toBe(27);
    expect(invoke(["archetype", "--root", root]).value.result).toMatchObject({ archetype: "product-saas", recorded: { by: "owner:2026-11-10 interview" } });
    // The same choice again changes nothing.
    expect(invoke(["archetype", "product-saas", "--by", "owner:2026-11-10 interview", "--root", root]).value.result.changed).toBe(false);
    expect(existsSync(join(base, "clossys", "agents", "director", `${ARCHETYPE_RECORD_ID}.md`))).toBe(false);
  });
  it("refuses a non-owner decider or an unknown archetype, and a bad record is a root issue", () => {
    const { root } = fullRoot();
    const record = join(evidenceDir(root), `${ARCHETYPE_RECORD_ID}.md`);
    expect(invoke(["archetype", "services", "--by", "planner", "--root", root]).code).toBe(2);
    expect(invoke(["archetype", "services", "--root", root]).code).toBe(2);
    expect(invoke(["archetype", "enterprise", "--by", "owner", "--root", root]).code).toBe(2);
    expect(existsSync(record)).toBe(false);
    writeFileSync(record, `---\nid: ${ARCHETYPE_RECORD_ID}\nsource: user\nobserved: 2026-11-10\nby: planner\nvalue: services\n---\n- Hand-written.\n`);
    expect(readStrategyRoot(root, reader).issues.map(issue => issue.message)).toEqual([expect.stringContaining("owner decision")]);
    expect(invoke(["complete", "--level", "mvs", "--root", root]).code).toBe(2);
  });
});

describe("W5b item 3: a cell judgement must cite a run record", () => {
  const RUN = "0123456789abcdef";
  function judgement(root: string, run?: string, verdict: "pass" | "fail" = "pass") {
    stageFinding(root, "critic-q3", `---\nid: critic-q3\nsource: user\nobserved: 2026-11-10\nby: critic\njudge: Q3:${CORE}@1\nverdict: ${verdict}\njudged: ["${CORE}@1"]\n${run ? `run: ${run}\n` : ""}---\n- Evidence read.\n`);
  }
  function runStore(base: string, exit: number) {
    const path = join(base, ".clossys", "runs", "critic.cell.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ schema: "clossys.pipeline-run/1", run: RUN, step: "critic.cell", invocation: "x", argv: [], exit, reads: [], writes: [] })}\n`);
  }
  it("an uncited or unresolved verdict is judgment-uncited, blocks the cell and is not counted", () => {
    const { root, base } = fullRoot();
    judgement(root);
    let model = readStrategyRoot(root, reader);
    expect(recordedJudgeVerdicts(model)[`Q3:${CORE}@1`]).toBeUndefined();
    let cell = strategyStatus(model, { scope: "core" }).cells.find(cell => cell.id === CORE)!;
    expect(cell.findings.filter(finding => finding.rule === "judgment-uncited")).toEqual([expect.objectContaining({ severity: "hard", judgeId: `Q3:${CORE}@1`, message: expect.stringContaining("cites no run record") })]);
    expect(cell.active).toBe(false);
    expect(completion(model).mvs).toBe(false);
    // A run id the store does not hold, or a run that could not run, does not resolve either.
    judgement(root, `critic.cell#${RUN}`);
    expect(strategyStatus(readStrategyRoot(root, reader), { scope: "core" }).cells.find(cell => cell.id === CORE)!.findings.some(f => f.rule === "judgment-uncited")).toBe(true);
    runStore(base, 2);
    expect(strategyStatus(readStrategyRoot(root, reader), { scope: "core" }).cells.find(cell => cell.id === CORE)!.findings.some(f => f.rule === "judgment-uncited")).toBe(true);
    // A cited run that ran: the verdict counts and the finding is gone.
    runStore(base, 0);
    model = readStrategyRoot(root, reader);
    expect(recordedJudgeVerdicts(model)[`Q3:${CORE}@1`]).toBe("pass");
    cell = strategyStatus(model, { scope: "core" }).cells.find(cell => cell.id === CORE)!;
    expect(cell.findings.some(f => f.rule === "judgment-uncited")).toBe(false);
    expect(cell.active).toBe(true);
    expect(completion(model).mvs).toBe(true);
  });
  it("a run citation is valid only on a judgement and only as <step>#<16 hex>", () => {
    const { root } = fullRoot();
    judgement(root, "critic.cell#xyz");
    expect(readStrategyRoot(root, reader).issues.map(issue => issue.path)).toEqual(["../../evidence/director/critic-q3.md"]);
    stageFinding(root, "critic-q3", `---\nid: critic-q3\nsource: user\nobserved: 2026-11-10\nby: critic\nrun: critic.cell#${RUN}\n---\n- No judge.\n`);
    expect(readStrategyRoot(root, reader).issues).toHaveLength(1);
  });
});

describe("W5b item 4: direct --check and check complete use one evaluator", () => {
  it("completion(model, { contracts }) as `clossys direct --check` calls it equals `check complete`", () => {
    const { root, cells } = fullRoot();
    const direct = () => {
      const model = readStrategyRoot(root, reader);
      return JSON.parse(JSON.stringify(completion(model, { contracts: discoverBriefContracts(root, reader, model.catalog).contracts })));
    };
    const cli = () => invoke(["complete", "--level", "mvs", "--root", root]).value.result;
    // The recorded critic verdict completes MVS on both paths.
    expect(direct()).toEqual(cli());
    expect(direct().mvs).toBe(true);
    // A bulk core pin and the archetype record move both paths together.
    invoke(["archetype", "services", "--by", "owner", "--root", root]);
    expect(direct()).toEqual(cli());
    expect(direct().core.counts.total).toBe(cli().core.counts.total);
    stage(root, cells.find(cell => cell.id === CORE)!, { pin: BULK });
    expect(direct()).toEqual(cli());
  });
});

describe("W5b item 5: a banned phrase quoted under a negative key is the ban, not a use", () => {
  const voice = (direction: string[], watch = "If complaint count > 3 each month, then review this choice.") => {
    const { root, cells } = fullRoot();
    const cell = cells.find(cell => cell.id === "identity.verbal.voice")!;
    stageSlot(root, cell.id, 1, direction, { refs: cell.cites.map(formatRef), functions: cell.functions, because: cell.because.map(b => b.text), watch: [watch] });
    const model = readStrategyRoot(root, reader);
    return checkCell(model.cells.find(c => c.id === cell.id)!, { model }).filter(f => f.rule === "Q5" && f.code === "generic").map(f => f.message);
  };
  it("passes quoted bans under Never: and still fails any other use", () => {
    expect(voice(["Sound: plain and direct for 20 teams", "Do: name the Studio step", 'Never: "seamless", "best-in-class", "magic" or "solutions"'])).toEqual([]);
    expect(voice(["Sound: seamless and direct for 20 teams", "Do: name the Studio step", 'Never: "magic"'])).toEqual(["Banned generic phrase: seamless"]);
    expect(voice(["Sound: plain and direct for 20 teams", "Do: name the Studio step", "Never: seamless claims"])).toEqual(["Banned generic phrase: seamless"]);
    expect(voice(["Sound: plain and direct for 20 teams", 'Do: say "seamless" for 20 teams', 'Never: "magic"'])).toEqual(["Banned generic phrase: seamless"]);
    expect(voice(["Sound: plain and direct for 20 teams", "Do: name the Studio step", 'Never: "magic", or a seamless promise'])).toEqual(["Banned generic phrase: seamless"]);
    expect(voice(["Sound: plain and direct for 20 teams", "Do: name the Studio step", 'Never: "magic"'], 'If "seamless" count > 3 each month, then review this choice.')).toEqual(["Banned generic phrase: seamless"]);
  });
});
