// @vitest-environment node
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { loadBuildCatalog } from "../catalog-core/index.js";
import { checkFrozenLeafSets } from "../catalog-core/leaf-freeze.js";
import { changeCommandFor } from "../studio/agent/commands.js";
import { designerWriteHistory } from "../studio/agent/history.js";
import { capture, thumbnailPath } from "./capture.js";
import { libraryManifest, nextReceipt } from "./write-receipt.js";
import { stableStringify } from "../catalog-core/stable.js";
import { reselect } from "./reselect.js";
import { catalog, temporaryLibrary } from "./__fixtures__/agent-library.js";
it("keeps commands, changesets, capture keys and history invariant under L2 regrouping", async () => {
  const build = loadBuildCatalog(), placements = structuredClone(build.placements);
  const leaf = "tokens.blur", component = "components.button";
  const { root, directory } = await temporaryLibrary();
  try {
    const receipt = JSON.parse(await fs.readFile(join(root, "designer-receipt.json"), "utf8"));
    const captureRoot = join(directory, "capture-library"), output = join(directory, "images"), driver = fileURLToPath(new URL("./__fixtures__/capture-driver.mjs", import.meta.url));
    await fs.mkdir(join(captureRoot, "fills"), { recursive: true });
    await fs.writeFile(join(captureRoot, "fills", component + ".json"), JSON.stringify({ $extensions: { "com.clossys.fill": { slot: component } } }));
    await fs.writeFile(join(captureRoot, "designer-receipt.json"), stableStringify(nextReceipt(undefined, { command: "synthetic capture", inputs: {} }, {}, await libraryManifest(captureRoot))));
    const captureOne = async () => { expect((await capture({ root: captureRoot, driver, out: output })).ok).toBe(true); return JSON.parse(await fs.readFile(join(output, "index.json"), "utf8")); };
    const initialIndex = await captureOne();
    const record = () => ({ command: changeCommandFor(leaf), path: thumbnailPath(output, component), history: designerWriteHistory(receipt, leaf) });
    const input = { root, catalog: { values: catalog, components: { slots: [], fills: [] } }, leaf, source: "foundry", write: false };
    const before = record(), beforeChange = (await reselect(input)).changeset;
    for (const layer of ["tokens", "components"]) {
      const placement = placements.find(row => row.layer === layer)!;
      const groups = placement.nodes.flatMap(node => "children" in node ? node.children : []);
      const id = layer === "tokens" ? leaf : component;
      const from = groups.find(node => "leaves" in node && node.leaves.includes(id))!;
      const to = groups.find(node => node !== from && "leaves" in node)!;
      if (!("leaves" in from) || !("leaves" in to)) throw new Error("Expected L2 groups");
      from.leaves = from.leaves.filter(value => value !== id); to.leaves = [...to.leaves, id];
    }
    const values = { ...catalog, placements: placements.filter(row => row.layer === "tokens" || row.layer === "assets") };
    expect((await reselect({ ...input, catalog: { ...input.catalog, values } })).changeset).toEqual(beforeChange);
    expect(record()).toEqual(before); expect(before.path).toBe(join(output, "components.button.webp"));
    expect(before.history.length).toBeGreaterThan(0);
    expect(await captureOne()).toEqual(initialIndex); expect(Object.keys(initialIndex.leaves)).toEqual([component]);
    expect(checkFrozenLeafSets(placements, build.slots, ["tokens", "assets", "components"])).toEqual([]);
    for (const slot of build.slots) expect(slot.id).toMatch(/^(tokens|assets|components|sections|frames)\.[a-z0-9-]+$/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
