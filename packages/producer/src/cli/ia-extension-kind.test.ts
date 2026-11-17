/**
 * `clossys ia <agent>/<slot> --contract` on a recut store (every slot.json a clossys.slot/2): a slot the package tree
 * does not hold names no slot/2 kind by its id or contract, so it takes the one kind its agent's slots under the same
 * L1 hold (foundry-build-0048 U2). Synthetic: a tmp copy of the repository fixture consumer, which recut moved to the
 * current trees.
 */
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repoConsumer } from "./__fixtures__/flat-consumer.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function workspace() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ia-extension-kind-")));
  dirs.push(root);
  cpSync(repoConsumer, join(root, "clossys"), { recursive: true });
  const contract = join(root, "contract.json");
  writeFileSync(contract, JSON.stringify({ purpose: "An owner rule beside the package's own." }));
  return { root, contract };
}

async function ia(root: string, args: readonly string[]) {
  // Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
  await import("./main.js");
  const { runIaCli } = await import("./owner.js");
  return runIaCli([...args], root);
}
const slotDoc = (root: string, agent: string, id: string) => JSON.parse(readFileSync(join(root, "clossys", "agents", agent, id, "slot.json"), "utf8")) as { schema: string; kind: string; ia: { l1: string } };

describe("clossys ia on a recut store: a new slot's slot/2 kind", { timeout: 120_000 }, () => {
  it("takes the kind of the agent's slots under the same L1: Voice, Prose, a Designer token", async () => {
    const { root, contract } = workspace();
    for (const [target, under, family, kind] of [
      ["writer/owner.house-rule", "voice.tone/attitude", "strings", "voice"],
      ["writer/owner.house-story", "prose.reference/policies", "strings", "prose"],
      ["designer/owner.house-color", "themes.colors/colors-surfaces", "element", "element/token"],
    ] as const) {
      const result = await ia(root, [target, "--under", under, "--kind", family, "--contract", contract]);
      expect(result.exitCode, `${target}: ${result.message}`).toBe(0);
      const [agent, id] = target.split("/") as [string, string];
      expect(slotDoc(root, agent, id)).toMatchObject({ schema: "clossys.slot/2", kind });
    }
  });

  it("refuses when the L1's slots hold more than one kind: the L1 no longer decides it", async () => {
    const { root, contract } = workspace();
    const ids = JSON.parse(readFileSync(join(root, "clossys", "agents", "designer", "ia.json"), "utf8")) as { nodes: { id: string; children: { slots: string[] }[] }[] };
    const sibling = ids.nodes.find(node => node.id === "themes.colors")!.children[0]!.slots[0]!;
    const file = join(root, "clossys", "agents", "designer", sibling, "slot.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), kind: "element/asset" }, null, 2));
    const result = await ia(root, ["designer/owner.house-color", "--under", "themes.colors/colors-surfaces", "--kind", "element", "--contract", contract, "--dry"]);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("designer/owner.house-color kind element has no clossys.slot/2 kind");
  });
});
