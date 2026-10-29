import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../cli.js";

const roots: string[] = [];
function fixture(text: string) {
  const base = mkdtempSync(join(tmpdir(), "strategy-wont-cli-")); roots.push(base);
  const root = join(base, "strategy"); mkdirSync(root);
  const scan = join(base, "surfaces"); mkdirSync(scan);
  writeFileSync(join(root, "strategy-brief.json"), JSON.stringify({ wontClaim: [{ id: "guarantee", statement: "Never promise guaranteed outcomes.", matchPhrases: ["guaranteed results"] }] }));
  const ids = ["advantage.proposition.proof", "identity.verbal.voice"];
  writeFileSync(join(root, "tree.json"), JSON.stringify({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active: Object.fromEntries(ids.map(id => [id, 1])) }));
  for (const id of ids) {
    const dir = join(root, "cells", id); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "v1.md"), `---\nid: ${id}\nversion: 1\nstatus: active\nupdated: 2026-10-29\ncites: []\nfeeds: []\nfunctions: []\nconfirmed: msg:2026-10-29-1#U2\n---\n\n## Direction\n- ${id.endsWith("proof") ? "Never-claim" : "Never"}: "guaranteed results".\n- Choice: Only measured outcomes.\n\n## Because\n- Sample evidence.\n\n## Watch\n- If trial count > 10 each month, then review.\n`);
  }
  writeFileSync(join(scan, "page.md"), text);
  return { root, scan };
}
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
describe("wont-claim report CLI boundary", () => {
  for (const [text, state, code] of [["Measured results.", "clean", 0], ["Guaranteed results.", "hit", 1], ["", "clean", 0]] as const) {
    it(`persists the exact ${state} result at the selected root`, () => {
      const { root, scan } = fixture(text); const print = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(main(["wont-claim", scan, "--root", root, "--json"])).toBe(code);
      expect(print).toHaveBeenCalledTimes(1);
      const value = JSON.parse(print.mock.calls[0]![0]);
      expect(value).toMatchObject({ command: "wont-claim", code, result: { state } });
      expect(readFileSync(join(root, "reports/wont-claim.json"), "utf8")).toBe(`${JSON.stringify(value.result, null, 2)}\n`);
      expect(readdirSync(join(root, "reports"))).toEqual(["wont-claim.json"]);
      expect(JSON.parse(readFileSync(join(root, "tree.json"), "utf8")).active).toEqual({ "advantage.proposition.proof": 1, "identity.verbal.voice": 1 });
    });
  }
  it("persists a pure check's indeterminate report and returns 2", () => {
    const { root, scan } = fixture("hello"); rmSync(join(scan, "page.md")); const print = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["wont-claim", scan, "--root", root, "--json"])).toBe(2);
    const value = JSON.parse(print.mock.calls[0]![0]); expect(value.result.state).toBe("indeterminate");
    expect(JSON.parse(readFileSync(join(root, "reports/wont-claim.json"), "utf8"))).toEqual(value.result);
  });
  it("keeps positional mode and saves its report", () => {
    const { root, scan } = fixture("Measured results."); vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["wont-claim", root, scan])).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "reports/wont-claim.json"), "utf8")).state).toBe("clean");
  });
  it("does not scan its own previous report as a surface", () => {
    const { root, scan } = fixture("Guaranteed results."); vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["wont-claim", dirname(root), "--root", root, "--json"])).toBe(1);
    writeFileSync(join(scan, "page.md"), "Measured results.");
    expect(main(["wont-claim", dirname(root), "--root", root, "--json"])).toBe(0);
  });
  it("returns one JSON error for an absent root or invalid flags", () => {
    const { root, scan } = fixture("Measured results."); const print = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const args of [[scan, "--root", join(root, "absent")], [scan, "--root", root, "--bogus"], [scan, "--root"]]) {
      print.mockClear(); expect(main(["wont-claim", ...args, "--json"])).toBe(2);
      expect(print).toHaveBeenCalledTimes(1); expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({ command: "wont-claim", code: 2, error: expect.any(String) });
    }
  });
});
