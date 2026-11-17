/**
 * `clossys ia sync` refuses a store that places leaves the package tree does not hold. On a store still on the old
 * trees (no clossys.slot/2 yet) the refusal names `clossys migrate recut`; on a recut store an unknown leaf is an
 * extension to declare (foundry-build-0048 U2). Synthetic: tmp copies of the two repository fixture consumers.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { legacyTreeConsumer, repoConsumer } from "./__fixtures__/flat-consumer.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function workspace(from: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ia-sync-recut-hint-")));
  dirs.push(root);
  cpSync(from, join(root, "clossys"), { recursive: true });
  return root;
}

async function sync(root: string) {
  // Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
  await import("./main.js");
  const { runIaCli } = await import("./owner.js");
  return runIaCli(["sync", "--agent", "writer", "--dry"], root);
}

describe("clossys ia sync: the refusal hint for leaves outside the package tree", { timeout: 120_000 }, () => {
  it("names clossys migrate recut on a store still on the old trees", async () => {
    const result = await sync(workspace(legacyTreeConsumer));
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("writer places");
    expect(result.message).toContain("this store is not recut to the current trees: run clossys migrate recut first");
    expect(result.message).not.toContain("declare them as extensions");
  });

  it("asks for an extension on a recut store", async () => {
    const root = workspace(repoConsumer);
    const ia = join(root, "clossys", "agents", "writer", "ia.json");
    const doc = JSON.parse(readFileSync(ia, "utf8")) as { nodes: { children: { slots: string[] }[] }[] };
    doc.nodes[0]!.children[0]!.slots.push("lexicon.house-rule");
    writeFileSync(ia, JSON.stringify(doc, null, 2));
    const folder = join(root, "clossys", "agents", "writer", "lexicon.house-rule");
    mkdirSync(folder, { recursive: true });
    const sibling = doc.nodes[0]!.children[0]!.slots[0]!;
    const slot = JSON.parse(readFileSync(join(root, "clossys", "agents", "writer", sibling, "slot.json"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(folder, "slot.json"), JSON.stringify({ ...slot, id: "lexicon.house-rule" }, null, 2));
    const result = await sync(root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("lexicon.house-rule");
    expect(result.message).toContain("declare them as extensions or upstream them into the package first");
  });
});
