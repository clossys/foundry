// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { main } from "./cli.js";
import { libraryManifest, nextReceipt } from "./write-receipt.js";
import { stableStringify } from "../catalog-core/stable.js";
import { snapshot } from "./__fixtures__/agent-library.js";
let directory: string, root: string, output: string;
const driver = fileURLToPath(new URL("./__fixtures__/capture-driver.mjs", import.meta.url));
const leaves = ["components.button", "sections.example", "frames.example"];
beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "designer-capture-"))); root = join(directory, "library"); output = join(directory, "images");
  await fs.mkdir(join(root, "fills"), { recursive: true });
  // Synthetic receipted capture snapshot, deliberately independent of a browser/runtime implementation.
  for (const leaf of [...leaves, "assets.mark"]) await fs.writeFile(join(root, "fills", leaf + ".json"), JSON.stringify({ $extensions: { "com.clossys.fill": { slot: leaf } } }));
  await fs.writeFile(join(root, "theme.css"), ":root { color-scheme: light; }\n");
  const receipt = nextReceipt(undefined, { command: "synthetic fixture", inputs: {} }, {}, await libraryManifest(root));
  await fs.writeFile(join(root, "designer-receipt.json"), stableStringify(receipt));
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
it("captures WebP per permanent leaf and leaves the root receipt byte-identical", async () => {
  const before = await snapshot(root);
  expect(await main(["capture", "--root", root, "--driver", driver, "--out", output])).toBe(0);
  const index = JSON.parse(await fs.readFile(join(output, "index.json"), "utf8"));
  const receipt = JSON.parse(await fs.readFile(join(root, "designer-receipt.json"), "utf8"));
  expect(Object.keys(index.leaves)).toEqual([...leaves].sort());
  expect(index.libraryHash).toBe(receipt.writes.at(-1).contentHash);
  for (const leaf of leaves) {
    expect((await fs.readFile(join(output, leaf + ".webp"))).subarray(8, 12).toString()).toBe("WEBP");
    expect(index.leaves[leaf]).toMatchObject({ fill: receipt.files[`fills/${leaf}.json`], sha256: expect.stringMatching(/^sha256:/), width: leaf.startsWith("components.") ? 640 : 1280, height: leaf.startsWith("components.") ? 400 : 800 });
  }
  expect(await snapshot(root)).toEqual(before); expect(await main(["receipt", "--root", root])).toBe(0);
});
it("refuses output inside the root including a symlinked parent", async () => {
  expect(await main(["capture", "--root", root, "--driver", driver, "--out", join(root, "images")])).toBe(2);
  const link = join(directory, "linked"); await fs.symlink(root, link);
  expect(await main(["capture", "--root", root, "--driver", driver, "--out", join(link, "images")])).toBe(2);
});
it("fails each non-WebP leaf and can capture just one leaf", async () => {
  const invalid = fileURLToPath(new URL("./__fixtures__/capture-invalid-driver.mjs", import.meta.url));
  expect(await main(["capture", "--root", root, "--driver", invalid, "--out", output])).toBe(1);
  expect(await main(["capture", "--root", root, "--driver", driver, "--out", output, "--leaf", leaves[0]!])).toBe(0);
  expect(Object.keys(JSON.parse(await fs.readFile(join(output, "index.json"), "utf8")).leaves)).toEqual([leaves[0]]);
});
it("lists every missing specimen and requires both driver exports", async () => {
  const missing = fileURLToPath(new URL("./__fixtures__/capture-missing-driver.mjs", import.meta.url)), out: string[] = [];
  expect(await main(["capture", "--root", root, "--driver", missing, "--out", output], { out: text => out.push(text), error: () => {} })).toBe(1);
  expect(JSON.parse(out[0]!).failures).toEqual([...leaves].sort().map(leaf => ({ leaf, reason: "No specimen" })));
  const invalid = join(directory, "invalid.mjs"); await fs.writeFile(invalid, "export const shoot = async () => new Uint8Array();");
  expect(await main(["capture", "--root", root, "--driver", invalid, "--out", output])).toBe(2);
});
