import { store } from "../../test/store.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCatalog } from "../catalog.js";
import { formatRef } from "../format/ref.js";
import type { Cell, Ref } from "../format/types.js";
import { main } from "../cli.js";
import { executeChecksCommand, withArchetype } from "./checks.js";
import { readStrategyRoot } from "../store.js";
import { parseReadArgs, runReadCommand } from "./read.js";
import { stageFinding, stageSlot, strategyRoot, type SlotFixture } from "../__fixtures__/slot-model.js";

const roots: string[] = [];
const catalog = loadCatalog();
const id = "context.customer.need";
function put(root: string, path: string, text: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
/** Pins a cell's bullets as its slot's candidate; `watch` overrides the Watch bullets. */
function stage(root: string, cell: Cell, options: SlotFixture = {}) {
  return stageSlot(root, cell.id, cell.version, cell.direction.map(bullet => `${bullet.key}: ${bullet.text}`), {
    refs: cell.cites.map(formatRef), functions: cell.functions, because: cell.because.map(bullet => bullet.text), watch: cell.watch.map(bullet => bullet.text), ...options,
  });
}
const cellsByRoot = new Map<string, Cell[]>();
function fixture(all = false) {
  const base = mkdtempSync(join(tmpdir(), "strategy-check-cli-")); roots.push(base);
  const root = strategyRoot(base);
  const cells: Cell[] = (all ? catalog.cells : catalog.cells.filter(def => def.id === id)).map((def, i) => ({
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
  cellsByRoot.set(root, cells);
  return root;
}
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(dir: string) { for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else files[path] = readFileSync(join(root, path), "utf8");
  } }
  walk(""); return files;
}
function invoke(argv: string[]) {
  const print = vi.spyOn(console, "log").mockImplementation(() => {});
  try { const code = main([...argv, "--json"], store); return { code, value: JSON.parse(print.mock.calls[0]![0]), calls: print.mock.calls.length }; }
  finally { print.mockRestore(); }
}
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
describe("production check CLI adapters", () => {
  it("lists the cell commands in the actual top-level help", () => {
    const print = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--help"], store)).toBe(0);
    expect(print.mock.calls.flat().join("\n")).toContain("Read commands: status, cell, check, cohere, complete, brief, handoff");
  });
  for (const [command, targets] of [["status", []], ["cell", [id, "--verb", "create"]], ["check", [id]], ["cohere", ["context.customer"]], ["complete", []]] as const) {
    it(`${command} uses the explicit root and returns a single JSON value`, () => {
      const root = fixture(); const before = snapshot(root); const result = invoke([command, ...targets, "--root", root]);
      expect(result.calls).toBe(1); expect(result.value).toMatchObject({ command, code: result.code, result: expect.anything() });
      const after = snapshot(root);
      if (["check", "cohere"].includes(command)) {
        const capability = command === "check" ? "cell-quality" : "coherence";
        // Reports live with Director evidence, outside the flat slot tree, which stays unchanged.
        expect(readFileSync(join(root, `../../evidence/director/reports/${capability}.json`), "utf8")).toBe(`${JSON.stringify(result.value.result, null, 2)}\n`);
      }
      // planner:wcx: a check never changes records; complete saves its report only behind an explicit --write.
      if (command === "complete") expect(existsSync(join(root, "../../evidence/director/reports/completion.json"))).toBe(false);
      expect(after).toEqual(before);
    });
    it(`${command} returns JSON exit 2 for an absent or malformed root`, () => {
      const root = fixture();
      for (const selected of [join(root, "absent"), root]) {
        if (selected === root) put(root, `${id}/pin.json`, "{");
        expect(invoke([command, ...targets, "--root", selected])).toMatchObject({ code: 2, calls: 1, value: { command, code: 2, error: expect.any(String) } });
      }
    });
  }
  it("quality checks return 0 for valid cells, 1 for actual Q findings and 2 for missing targets", () => {
    const root = fixture();
    for (const command of ["check", "cell"]) {
      const extra = command === "cell" ? ["--verb", "create"] : [];
      expect(invoke([command, id, ...extra, "--root", root]).code).toBe(0);
      const cell = cellsByRoot.get(root)!.find(cell => cell.id === id)!;
      stage(root, cell, { watch: ["Review later."] });
      expect(invoke([command, id, ...extra, "--root", root])).toMatchObject({ code: 1, value: { result: { findings: expect.arrayContaining([expect.objectContaining({ rule: "Q4", severity: "hard" })]) } } });
      stage(root, cell);
      expect(invoke([command, "focus.segment.core", ...extra, "--root", root]).code).toBe(2);
    }
    expect(invoke(["check", formatRef({ kind: "cell", ref: { cell: id, version: 2 } }), "--root", root]).code).toBe(2);
  });
  it("checks an unpinned draft by its version, a bare id checks the pin, and no check changes the pin", () => {
    const root = fixture();
    const cell = cellsByRoot.get(root)!.find(cell => cell.id === id)!;
    stage(root, { ...cell, version: 2 }, { watch: ["Review later."], unpinned: true });
    const pin = readFileSync(join(root, id, "pin.json"), "utf8");
    expect(invoke(["check", formatRef({ kind: "cell", ref: { cell: id, version: 1 } }), "--root", root]).code).toBe(0);
    expect(invoke(["check", id, "--root", root]).code).toBe(0);
    expect(invoke(["check", formatRef({ kind: "cell", ref: { cell: id, version: 2 } }), "--root", root])).toMatchObject({
      code: 1, value: { result: { cells: [{ cell: id, version: 2, draft: true }], findings: expect.arrayContaining([expect.objectContaining({ rule: "Q4", severity: "hard" })]) } },
    });
    expect(invoke(["check", formatRef({ kind: "cell", ref: { cell: id, version: 3 } }), "--root", root]).code).toBe(2);
    expect(invoke(["check", "--root", root]).value.result.cells).toEqual([{ cell: id, version: 1 }]);
    expect(readFileSync(join(root, id, "pin.json"), "utf8")).toBe(pin);
  });
  it("checks a slot's newest draft when the slot has no pin", () => {
    const root = fixture();
    const cell = cellsByRoot.get(root)!.find(cell => cell.id === id)!;
    rmSync(join(root, id, "pin.json"));
    stage(root, { ...cell, version: 2 }, { unpinned: true });
    expect(invoke(["check", id, "--root", root])).toMatchObject({ code: 0, value: { result: { cells: [{ cell: id, version: 2, draft: true }] } } });
    expect(existsSync(join(root, id, "pin.json"))).toBe(false);
  });
  it("cohere checks C1-C3 within the requested L2 group", () => {
    const root = fixture();
    expect(invoke(["cohere", "context.market", "--root", root]).code).toBe(0);
    expect(invoke(["cohere", "context.customer", "--root", root]).code).toBe(1);
    expect(invoke(["cohere", "--root", root]).code).toBe(1);
    expect(invoke(["cohere", "unknown.group", "--root", root]).code).toBe(2);
  });
  it("status prints the skill progress shape from canonical reports", () => {
    const root = fixture(true); const print = vi.fn();
    expect(runReadCommand(["status", "--root", root], { execute: args => executeChecksCommand(args, store) }, print)).toBe(0);
    expect(print.mock.calls[0]![0]).toMatch(/^MVS 24\/24 · L1 unlocked \d\/7 \(.+\) · L2 coherent \d+\/28 · active 57\/57 · requests 0 open · next: .+$/);
    expect(invoke(["status", "--scope", "full", "--root", root]).value.result.scope).toBe("full");
  });
  it("cell group and strategy views use canonical state and do not save reports", () => {
    const root = fixture(true); const before = snapshot(root);
    expect(invoke(["cell", "context.customer", "--verb", "cohere", "--root", root]).code).toBe(0);
    expect(invoke(["cell", "context", "--verb", "unlock", "--root", root]).code).toBe(0);
    const result = invoke(["cell", "strategy", "--verb", "normalize", "--root", root]);
    expect(result.code).toBe(1); expect(result.value.result.storyline.critic).toBe("not judged");
    expect(snapshot(root)).toEqual(before);
    expect(invoke(["cell", "unknown", "--verb", "unlock", "--root", root]).code).toBe(2);
  });
  it("completion preserves not judged, each level and capability aliases", () => {
    const root = fixture(true);
    for (const level of ["mvs", "l0", "full"]) {
      const result = invoke(["complete", "--level", level, "--root", root]);
      expect(result.code).toBe(1); expect(result.value.result).toMatchObject({ mvs: false, complete: false, storyline: { critic: "not judged" } });
    }
    for (const [alias, command] of [["cell-quality", "check"], ["coherence", "cohere"], ["completion", "complete"]]) {
      expect(invoke([alias!, "--root", root]).value.command).toBe(command);
    }
  });
  it("a current recorded critic verdict completes MVS; a newer storyline pin drops it to not judged", () => {
    const root = fixture(true);
    const storyline = catalog.coherence.storyline;
    const judged = (version = 1) => storyline.map(cell => `${cell}@${cell === "focus.segment.core" ? version : 1}`);
    const verdict = (name: string, value: "pass" | "fail", refs: string[]) => stageFinding(root, name,
      `---\nid: ${name}\nsource: user\nobserved: 2026-11-10\nby: critic\njudge: C4\nverdict: ${value}\njudged: ${JSON.stringify(refs)}\n---\n- Pre-mortem: the storyline reads as one argument.\n`);
    expect(invoke(["complete", "--level", "mvs", "--root", root]).code).toBe(1);
    // A verdict that skips a storyline cell does not count.
    verdict("critic-partial", "pass", judged().slice(1));
    expect(invoke(["complete", "--level", "mvs", "--root", root]).value.result.storyline.critic).toBe("not judged");
    verdict("critic-pass", "pass", judged());
    const ready = invoke(["complete", "--level", "mvs", "--root", root]);
    expect(ready.code).toBe(0); expect(ready.value.result).toMatchObject({ mvs: true, storyline: { critic: "pass" } });
    // Full completion still needs the judge contradiction pairs.
    expect(invoke(["complete", "--level", "full", "--root", root]).code).toBe(1);
    // A current fail beats a current pass for the same judge.
    verdict("critic-fail", "fail", judged());
    expect(invoke(["complete", "--level", "mvs", "--root", root])).toMatchObject({ code: 1, value: { result: { storyline: { critic: "fail" } } } });
    rmSync(join(root, "../../evidence/director/critic-fail.md"));
    // Pinning a new version of a judged storyline cell makes every earlier verdict stale.
    const segment = cellsByRoot.get(root)!.find(cell => cell.id === "focus.segment.core")!;
    stage(root, { ...segment, version: 2 });
    const stale = invoke(["complete", "--level", "mvs", "--root", root]);
    expect(stale.value.result.storyline.critic).toBe("not judged"); expect(stale.code).toBe(1);
    verdict("critic-pass-v2", "pass", judged(2));
    expect(invoke(["complete", "--level", "mvs", "--root", root]).value.result.storyline.critic).toBe("pass");
  });
  it("--archetype adds that archetype's extra core cells to MVS", () => {
    const root = fixture(true);
    const critic = catalog.coherence.storyline.map(cell => `${cell}@1`);
    stageFinding(root, "critic-pass", `---\nid: critic-pass\nsource: user\nobserved: 2026-11-10\nby: critic\njudge: C4\nverdict: pass\njudged: ${JSON.stringify(critic)}\n---\n- Pre-mortem read.\n`);
    expect(invoke(["complete", "--level", "mvs", "--archetype", "product-saas", "--root", root]).code).toBe(0);
    rmSync(join(root, "focus.lifecycle.retention", "pin.json"));
    expect(invoke(["complete", "--level", "mvs", "--root", root]).code).toBe(0);
    const saas = invoke(["complete", "--level", "mvs", "--archetype", "product-saas", "--root", root]);
    expect(saas.code).toBe(1); expect(saas.value.result.core.counts.total).toBe(27);
    expect(invoke(["status", "--archetype", "product-saas", "--root", root]).value.result.cells.map((cell: { id: string }) => cell.id)).toContain("focus.lifecycle.retention");
    expect(invoke(["complete", "--archetype", "unknown", "--root", root]).code).toBe(2);
  });
  it("--archetype default overrides an archetype the tree records", () => {
    const model = readStrategyRoot(fixture(true), store.reader);
    const recorded = { ...model, tree: { ...model.tree!, archetype: "product-saas" } };
    expect(withArchetype(recorded, "default").tree!.archetype).toBe("default");
    expect(withArchetype(recorded, undefined).tree!.archetype).toBe("product-saas");
    expect(withArchetype(model, "product-saas").tree!.archetype).toBe("product-saas");
    expect(() => withArchetype(model, "unknown")).toThrow(/Unknown strategy archetype/);
  });
  it("complete leaves git status clean; only an explicit write saves the completion report", () => {
    const root = fixture(true); const base = join(root, "../../..");
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=wcx@example.invalid", "-c", "user.name=wcx", ...args], { cwd: base, encoding: "utf8" });
    git("init", "-q"); git("add", "-A"); git("commit", "-qm", "fixture");
    expect(git("status", "--porcelain", "--untracked-files=all")).toBe("");
    for (const level of ["mvs", "l0", "full"]) invoke(["complete", "--level", level, "--root", root]);
    expect(git("status", "--porcelain", "--untracked-files=all")).toBe("");
    const args = parseReadArgs(["complete", "--root", root]);
    const saved = executeChecksCommand({ ...args, write: true }, store);
    expect(readFileSync(join(root, "../../evidence/director/reports/completion.json"), "utf8")).toBe(`${JSON.stringify(saved.data, null, 2)}\n`);
  });
  it("writes a new report on each run without changing other reports", () => {
    const root = fixture(); invoke(["check", id, "--root", root]);
    const reports = "../../evidence/director/reports";
    const first = readFileSync(join(root, reports, "cell-quality.json"), "utf8");
    put(root, `${reports}/coherence.json`, "sentinel\n");
    stage(root, cellsByRoot.get(root)!.find(cell => cell.id === id)!, { watch: ["Review later."] });
    expect(invoke(["check", id, "--root", root]).code).toBe(1);
    expect(readFileSync(join(root, reports, "cell-quality.json"), "utf8")).not.toBe(first);
    expect(readFileSync(join(root, reports, "coherence.json"), "utf8")).toBe("sentinel\n");
    expect(existsSync(join(root, "reports"))).toBe(false);
  });
});
