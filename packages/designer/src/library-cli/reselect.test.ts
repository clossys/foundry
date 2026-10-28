// @vitest-environment node
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { main } from "./cli.js";
import { snapshot, temporaryLibrary } from "./__fixtures__/agent-library.js";
let root: string, directory: string;
beforeEach(async () => { ({ root, directory } = await temporaryLibrary()); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
it("dry-runs reselect without changing any library byte", async () => {
  const before = await snapshot(root), out: string[] = [];
  expect(await main(["reselect", "--root", root, "--leaf", "tokens.blur", "--source", "foundry", "--json"], { out: t => out.push(t), error: () => {} })).toBe(0);
  expect(JSON.parse(out[0]!)).toMatchObject({ changeset: { changes: [{ op: "adopt", slot: "tokens.blur", source: "foundry" }] }, verdict: { ok: true } });
  expect(await snapshot(root)).toEqual(before);
});
it("writes exactly one explicit reselect stamp and keeps receipt verification green", async () => {
  const receipt = () => fs.readFile(join(root, "designer-receipt.json"), "utf8").then(JSON.parse);
  const before = await receipt();
  expect(await main(["reselect", "--root", root, "--leaf", "tokens.blur", "--source", "foundry", "--write"])).toBe(0);
  const after = await receipt(); expect(after.writes).toHaveLength(before.writes.length + 1);
  expect(after.writes.at(-1)).toMatchObject({ command: "designer-library reselect", inputs: { leaf: "tokens.blur", source: "foundry" } });
  expect(await main(["receipt", "--root", root])).toBe(0);
  await fs.appendFile(join(root, "brand.css"), "\n"); expect(await main(["receipt", "--root", root])).toBe(1);
});
it("refuses unknown leaves and options without a write", async () => {
  const before = await snapshot(root);
  for (const args of [["--leaf", "tokens.unknown", "--source", "foundry"], ["--leaf", "tokens.blur"], ["--leaf", "tokens.blur", "--source", "unknown"]]) {
    expect(await main(["reselect", "--root", root, ...args])).toBe(2);
  }
  expect(await snapshot(root)).toEqual(before);
});
