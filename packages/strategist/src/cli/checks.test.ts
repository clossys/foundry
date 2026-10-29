import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCatalog } from "../catalog.js";
import { serializeCell } from "../format/cell.js";
import { formatRef } from "../format/ref.js";
import type { Cell, Ref } from "../format/types.js";
import { main } from "../cli.js";
import { executeChecksCommand } from "./checks.js";
import { runReadCommand } from "./read.js";

const roots: string[] = [];
const catalog = loadCatalog();
const id = "context.customer.need";
function put(root: string, path: string, text: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
function fixture(all = false) {
  const root = mkdtempSync(join(tmpdir(), "strategy-check-cli-")); roots.push(root);
  const cells: Cell[] = (all ? catalog.cells : catalog.cells.filter(def => def.id === id)).map((def, i) => ({
    id: def.id, version: 1, status: "active", updated: "2026-10-29", path: `cells/${def.id}/v1.md`,
    confirmed: { kind: "msg", session: "2026-10-29-1", line: "U2" },
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
  for (const cell of cells) put(root, cell.path, serializeCell(cell));
  put(root, "tree.json", JSON.stringify({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active: Object.fromEntries(cells.map(cell => [cell.id, 1])) }));
  put(root, "findings/sample.md", "---\nid: sample\nsource: user\nobserved: 2026-10-29\nby: researcher\n---\n- Sample observation.\n");
  put(root, "sessions/2026-10-29-1.md", `- S1: Playback: ${cells.map(cell => formatRef({ kind: "cell", ref: { cell: cell.id, version: 1 } })).join(", ")}\n- U2: Yes, all listed.\n`);
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
  try { const code = main([...argv, "--json"]); return { code, value: JSON.parse(print.mock.calls[0]![0]), calls: print.mock.calls.length }; }
  finally { print.mockRestore(); }
}
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
describe("production check CLI adapters", () => {
  it("lists the cell commands in the actual top-level help", () => {
    const print = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--help"])).toBe(0);
    expect(print.mock.calls.flat().join("\n")).toContain("Read commands: status, cell, check, cohere, complete, brief, handoff");
  });
  for (const [command, targets] of [["status", []], ["cell", [id, "--verb", "create"]], ["check", [id]], ["cohere", ["context.customer"]], ["complete", []]] as const) {
    it(`${command} uses the explicit root and returns a single JSON value`, () => {
      const root = fixture(); const before = snapshot(root); const result = invoke([command, ...targets, "--root", root]);
      expect(result.calls).toBe(1); expect(result.value).toMatchObject({ command, code: result.code, result: expect.anything() });
      const after = snapshot(root);
      if (["check", "cohere", "complete"].includes(command)) {
        const capability = command === "check" ? "cell-quality" : command === "cohere" ? "coherence" : "completion";
        expect(after[`reports/${capability}.json`]).toBe(`${JSON.stringify(result.value.result, null, 2)}\n`);
        delete after[`reports/${capability}.json`];
      }
      expect(after).toEqual(before);
    });
    it(`${command} returns JSON exit 2 for an absent or malformed root`, () => {
      const root = fixture();
      for (const selected of [join(root, "absent"), root]) {
        if (selected === root) put(root, "tree.json", "{");
        expect(invoke([command, ...targets, "--root", selected])).toMatchObject({ code: 2, calls: 1, value: { command, code: 2, error: expect.any(String) } });
      }
    });
  }
  it("quality checks return 0 for valid cells, 1 for actual Q findings and 2 for missing targets", () => {
    const root = fixture();
    for (const command of ["check", "cell"]) {
      const extra = command === "cell" ? ["--verb", "create"] : [];
      expect(invoke([command, id, ...extra, "--root", root]).code).toBe(0);
      const path = join(root, `cells/${id}/v1.md`); const original = readFileSync(path, "utf8"); writeFileSync(path, original.replace("If trial count > 10 each month, then review this choice.", "Review later."));
      expect(invoke([command, id, ...extra, "--root", root])).toMatchObject({ code: 1, value: { result: { findings: expect.arrayContaining([expect.objectContaining({ rule: "Q4", severity: "hard" })]) } } });
      writeFileSync(path, original);
      expect(invoke([command, "focus.segment.core", ...extra, "--root", root]).code).toBe(2);
    }
    expect(invoke(["check", formatRef({ kind: "cell", ref: { cell: id, version: 2 } }), "--root", root]).code).toBe(2);
  });
  it("checks latest, pinned and all stored versions without changing activation", () => {
    const root = fixture(); const path = `cells/${id}/v1.md`;
    const bytes = readFileSync(join(root, path), "utf8");
    put(root, `cells/${id}/v2.md`, bytes.replace("version: 1", "version: 2").replace("status: active", "status: draft").replace("If trial count > 10 each month, then review this choice.", "Review later."));
    const tree = readFileSync(join(root, "tree.json"), "utf8");
    expect(invoke(["check", formatRef({ kind: "cell", ref: { cell: id, version: 1 } }), "--root", root]).code).toBe(0);
    expect(invoke(["check", id, "--root", root]).code).toBe(1);
    expect(invoke(["check", "--root", root]).value.result.cells).toEqual([{ cell: id, version: 1 }, { cell: id, version: 2 }]);
    expect(readFileSync(join(root, "tree.json"), "utf8")).toBe(tree);
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
    expect(runReadCommand(["status", "--root", root], { execute: executeChecksCommand }, print)).toBe(0);
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
  it("writes a new report on each run without changing other reports", () => {
    const root = fixture(); invoke(["check", id, "--root", root]);
    const first = readFileSync(join(root, "reports/cell-quality.json"), "utf8");
    put(root, "reports/coherence.json", "sentinel\n");
    const path = join(root, `cells/${id}/v1.md`); writeFileSync(path, readFileSync(path, "utf8").replace("If trial count > 10 each month, then review this choice.", "Review later."));
    expect(invoke(["check", id, "--root", root]).code).toBe(1);
    expect(readFileSync(join(root, "reports/cell-quality.json"), "utf8")).not.toBe(first);
    expect(readFileSync(join(root, "reports/coherence.json"), "utf8")).toBe("sentinel\n");
  });
});
