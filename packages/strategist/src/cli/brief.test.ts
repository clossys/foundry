import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../cli.js";
import { executeBriefCommand } from "./brief.js";
import { runReadCommand } from "./read.js";

const roots: string[] = [];
const id = "context.customer.need";
function put(root: string, path: string, bytes: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); }
function fixture(active: number | null = 1) {
  const root = mkdtempSync(join(tmpdir(), "strategy-cli-")); roots.push(root);
  put(root, "tree.json", JSON.stringify({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active: { [id]: active } }));
  put(root, "contracts/fixture.json", JSON.stringify({ schemaVersion: 1, id: "fixture.brief", owner: "fixture", requires: [id], optional: [] }));
  if (active) put(root, `cells/${id}/v${active}.md`, `---\nid: ${id}\nversion: ${active}\nstatus: active\nupdated: 2026-10-29\ncites: []\nfeeds: []\nfunctions: []\nconfirmed: msg:2026-10-29-1#U2\n---\n\n## Direction\n- Need: A fictional studio needs scheduling.\n- Not: Large factories.\n\n## Because\n- Measured interviews.\n\n## Watch\n- If requests > 5 each month, then review.\n`);
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
  for (const command of ["brief", "handoff"]) {
    it(`${command} is reachable from the production CLI`, () => {
      const root = fixture(); const before = snapshot(root); const print = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        expect(main([command, "fixture.brief", "--root", root, "--json"])).toBe(0);
        expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({ command, code: 0, result: { state: "ready" } });
        expect(snapshot(root)).toEqual(before);
      } finally { print.mockRestore(); }
    });
    it(`${command} returns ready with JSON and does not write`, () => {
      const root = fixture(); const before = snapshot(root); const print = vi.fn();
      expect(runReadCommand([command, "fixture.brief", "--root", root, "--json"], { execute: executeBriefCommand }, print)).toBe(0);
      expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({ command, code: 0, result: { state: "ready", contract: "fixture.brief" } });
      expect(snapshot(root)).toEqual(before);
    });
    it(`${command} lists missing cells and returns 1`, () => {
      const root = fixture(null); const before = snapshot(root); const print = vi.fn();
      expect(runReadCommand([command, "fixture.brief", "--root", root], { execute: executeBriefCommand }, print)).toBe(1);
      expect(print).toHaveBeenCalledWith(`Missing: ${id}`); expect(snapshot(root)).toEqual(before);
    });
    it(`${command} reports stale stored briefs and returns 1`, () => {
      const root = fixture(); put(root, "briefs/fixture.brief.json", JSON.stringify({ fingerprint: "old" }));
      const before = snapshot(root); const print = vi.fn();
      expect(runReadCommand([command, "fixture.brief", "--root", root, "--json"], { execute: executeBriefCommand }, print)).toBe(1);
      expect(JSON.parse(print.mock.calls[0]![0]).result.state).toBe("stale"); expect(snapshot(root)).toEqual(before);
    });
    it(`${command} returns 2 for an unreadable root`, () => {
      const root = fixture(); const print = vi.fn();
      expect(runReadCommand([command, "fixture.brief", "--root", join(root, "absent"), "--json"], { execute: executeBriefCommand }, print)).toBe(2);
      expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({ command, code: 2, error: expect.any(String) });
    });
  }
});
