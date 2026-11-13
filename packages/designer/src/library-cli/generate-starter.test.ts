// @vitest-environment node
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { main } from "./cli.js";
import { snapshot, temporaryLibrary } from "./__fixtures__/agent-library.js";
let root: string, directory: string;
beforeEach(async () => { ({ root, directory } = await temporaryLibrary()); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
it("dry-runs the identity engine and writes only through its explicit stamped command", async () => {
  const before = await snapshot(root), out: string[] = [];
  const args = ["generate-starter", "--root", root, "--leaf", "assets.mark"];
  expect(await main([...args, "--json"], { out: t => out.push(t), error: () => {} })).toBe(0);
  expect(JSON.parse(out[0]!)).toMatchObject({ changeset: { changes: [{ op: "author", slot: "assets.mark" }] }, verdict: { ok: true } });
  expect(await snapshot(root)).toEqual(before);
  const old = JSON.parse(await fs.readFile(join(root, "designer-receipt.json"), "utf8"));
  expect(await main([...args, "--write"])).toBe(0);
  const receipt = JSON.parse(await fs.readFile(join(root, "designer-receipt.json"), "utf8"));
  expect(receipt.writes).toHaveLength(old.writes.length + 1);
  expect(receipt.writes.at(-1)).toMatchObject({ command: "designer-library generate-starter", inputs: { leaf: "assets.mark" } });
  expect(await main(["receipt", "--root", root])).toBe(0);
});
it("returns unavailable for a refused starter leaf", async () => {
  expect(await main(["generate-starter", "--root", root, "--leaf", "themes.radius"])).toBe(2);
});
