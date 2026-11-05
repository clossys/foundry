import { store } from "../../test/store.js";
import { existsSync, linkSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../cli.js";
import { executeBriefCommand } from "./brief.js";
import { runReadCommand } from "./read.js";
import { stageSlot } from "../ground/fixtures.js";

const roots: string[] = [];
const id = "context.customer.need";
function put(root: string, path: string, bytes: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); }
/** Pins one candidate of the contract's slot. */
function stage(root: string, version = 1, need = "Need: A fictional studio needs scheduling.", refs: string[] = []) {
  stageSlot(root, id, version, [need, "Not: Large factories."], { refs, because: ["Measured interviews."], watch: ["If requests > 5 each month, then review."] });
}
function fixture(active: number | null = 1) {
  const root = mkdtempSync(join(tmpdir(), "strategy-cli-")); roots.push(root);
  put(root, "contracts/fixture.json", JSON.stringify({ schemaVersion: 1, id: "fixture.brief", owner: "fixture", requires: [id], optional: [] }));
  if (active) stage(root, active);
  return root;
}
function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(path: string) {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) visit(next); else result[next] = readFileSync(join(root, next), "utf8");
    }
  }
  visit(""); return result;
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
describe("production brief CLI adapter", () => {
  function run(root: string, flags: string[] = [], contract = "fixture.brief") {
    const print = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = main(["brief", contract, ...flags, "--root", root, "--json"], store);
      return { code, output: JSON.parse(print.mock.calls[0]![0]) };
    } finally { print.mockRestore(); }
  }
  function read(root: string, path: string) { return JSON.parse(readFileSync(join(root, path), "utf8")); }

  it("persists a ready brief and inventory, then feeds the separate citation index command", () => {
    const root = fixture(); const before = snapshot(root);
    const result = run(root, ["--write"]);
    expect(result.code).toBe(0);
    const brief = read(root, "briefs/fixture.brief.json");
    expect(brief).toEqual(result.output.result);
    expect(brief).toMatchObject({ contract: "fixture.brief", state: "ready", cells: [{ cell: id, version: 1 }] });
    const inventory = read(root, "briefs/index.json");
    expect(inventory).toMatchObject({ schemaVersion: 1, briefs: [{ contract: "fixture.brief", state: "ready", fingerprint: brief.fingerprint, refs: [{ cell: id, version: 1 }] }] });
    expect(existsSync(join(root, "requests"))).toBe(false);
    for (const [path, bytes] of Object.entries(before)) expect(readFileSync(join(root, path), "utf8")).toBe(bytes);
    const print = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(main(["index", "--root", root, "--scan", join(root, "briefs"), "--json"], store)).toBe(0);
      const index = read(root, "citations.json");
      expect(index).toMatchObject({ stale: [], dangling: [], drift: [] });
      expect(index.entries).toContainEqual(expect.objectContaining({ ref: { cell: id, version: 1 }, by: expect.objectContaining({ path: "briefs/fixture.brief.json", kind: "brief" }) }));
      expect(index.entries).toContainEqual(expect.objectContaining({ ref: { cell: id, version: 1 }, by: expect.objectContaining({ path: "briefs/index.json", kind: "json" }) }));
    } finally { print.mockRestore(); }
  });
  it("refuses the retired --request flag without writing", () => {
    const root = fixture(null); const before = snapshot(root);
    expect(run(root, ["--write", "--request"]).code).toBe(2);
    expect(run(root, ["--request"]).code).toBe(2);
    expect(snapshot(root)).toEqual(before);
  });
  it("writes missing input without opening requests", () => {
    const root = fixture(null);
    expect(run(root, ["--write"]).code).toBe(1);
    expect(read(root, "briefs/fixture.brief.json").missing).toEqual([id]);
    expect(existsSync(join(root, "requests"))).toBe(false);
  });
  it("refreshes a stale stored fingerprint and preserves other contracts in the inventory", () => {
    const root = fixture();
    put(root, "contracts/second.json", JSON.stringify({ schemaVersion: 1, id: "second.brief", owner: "other", requires: [id], optional: [] }));
    expect(run(root, ["--write"]).code).toBe(0);
    expect(run(root, ["--write"], "second.brief").code).toBe(0);
    stage(root, 1, "Need: A fictional workshop needs scheduling.");
    expect(run(root, ["--write"]).code).toBe(1);
    expect(read(root, "briefs/fixture.brief.json").state).toBe("stale");
    expect(read(root, "briefs/index.json").briefs.map((brief: { contract: string }) => brief.contract)).toEqual(["fixture.brief", "second.brief"]);
    expect(run(root).output.result.state).toBe("ready");
    expect(existsSync(join(root, "requests"))).toBe(false);
  });
  it("keeps unresolved cell dependencies visibly stale when persisting", () => {
    const root = fixture();
    stage(root, 1, undefined, ["context.market.size@1"]);
    expect(run(root, ["--write"]).code).toBe(1);
    expect(read(root, "briefs/fixture.brief.json")).toMatchObject({ state: "stale", stale: [{ cell: "context.market.size", version: 1 }] });
    expect(run(root).output.result.state).toBe("stale");
    expect(existsSync(join(root, "requests"))).toBe(false);
  });
  it.each(["brief-directory", "brief-file", "inventory", "hardlink", "non-file"])("refuses unsafe %s targets before any content mutation", target => {
    const root = fixture(); const outside = mkdtempSync(join(tmpdir(), "strategy-outside-")); roots.push(outside);
    put(outside, "sentinel.json", "private sentinel");
    if (target === "brief-directory") symlinkSync(outside, join(root, "briefs"));
    else {
      mkdirSync(join(root, "briefs"));
      const path = join(root, "briefs", target === "inventory" ? "index.json" : "fixture.brief.json");
      if (target === "hardlink") linkSync(join(outside, "sentinel.json"), path);
      else if (target === "non-file") mkdirSync(path);
      else symlinkSync(join(outside, "sentinel.json"), path);
    }
    const before = readFileSync(join(root, id, "pin.json"), "utf8");
    expect(run(root, ["--write"]).code).toBe(2);
    expect(readFileSync(join(outside, "sentinel.json"), "utf8")).toBe("private sentinel");
    expect(readdirSync(outside)).toEqual(["sentinel.json"]);
    expect(readFileSync(join(root, id, "pin.json"), "utf8")).toBe(before);
    expect(readdirSync(root).some(path => path.startsWith(".director-write"))).toBe(false);
    if (target === "inventory") expect(existsSync(join(root, "briefs/fixture.brief.json"))).toBe(false);
  });
  it("returns 2 for unknown contracts, invalid roots and the reserved inventory name without writing", () => {
    const root = fixture(); const before = snapshot(root);
    expect(run(root, ["--write"], "unknown.brief").code).toBe(2);
    expect(snapshot(root)).toEqual(before);
    put(root, "contracts/index.json", JSON.stringify({ schemaVersion: 1, id: "index", owner: "fixture", requires: [id], optional: [] }));
    const withContract = snapshot(root);
    expect(run(root, ["--write"], "index").code).toBe(2);
    expect(snapshot(root)).toEqual(withContract);
    put(root, `${id}/pin.json`, "{}"); const invalid = snapshot(root);
    expect(run(root, ["--write"]).code).toBe(2);
    expect(snapshot(root)).toEqual(invalid);
  });
  for (const command of ["brief", "handoff"]) {
    it(`${command} is reachable from the production CLI`, () => {
      const root = fixture(); const before = snapshot(root); const print = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        expect(main([command, "fixture.brief", "--root", root, "--json"], store)).toBe(0);
        expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({ command, code: 0, result: { state: "ready" } });
        expect(snapshot(root)).toEqual(before);
      } finally { print.mockRestore(); }
    });
    it(`${command} returns ready with JSON and does not write`, () => {
      const root = fixture(); const before = snapshot(root); const print = vi.fn();
      expect(runReadCommand([command, "fixture.brief", "--root", root, "--json"], { execute: args => executeBriefCommand(args, store) }, print)).toBe(0);
      expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({ command, code: 0, result: { state: "ready", contract: "fixture.brief" } });
      expect(snapshot(root)).toEqual(before);
    });
    it(`${command} lists missing cells and returns 1`, () => {
      const root = fixture(null); const before = snapshot(root); const print = vi.fn();
      expect(runReadCommand([command, "fixture.brief", "--root", root], { execute: args => executeBriefCommand(args, store) }, print)).toBe(1);
      expect(print).toHaveBeenCalledWith(`Missing: ${id}`); expect(snapshot(root)).toEqual(before);
    });
    it(`${command} reports stale stored briefs and returns 1`, () => {
      const root = fixture(); put(root, "briefs/fixture.brief.json", JSON.stringify({ fingerprint: "old" }));
      const before = snapshot(root); const print = vi.fn();
      expect(runReadCommand([command, "fixture.brief", "--root", root, "--json"], { execute: args => executeBriefCommand(args, store) }, print)).toBe(1);
      expect(JSON.parse(print.mock.calls[0]![0]).result.state).toBe("stale"); expect(snapshot(root)).toEqual(before);
    });
    it(`${command} returns 2 for an unreadable root`, () => {
      const root = fixture(); const print = vi.fn();
      expect(runReadCommand([command, "fixture.brief", "--root", join(root, "absent"), "--json"], { execute: args => executeBriefCommand(args, store) }, print)).toBe(2);
      expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({ command, code: 2, error: expect.any(String) });
    });
  }
});
