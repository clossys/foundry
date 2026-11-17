// G2: an IA slot with no folder (ia.json places it, no slot.json yet) is an open `ia` item, reported as a gap
// or an ia packet by gaps, next --owner and options, never read as a slot (formerly ENOENT, exit 2).
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGapsCli } from "../cli/gaps.js";
import { runNextCli } from "../cli/next.js";
import { runOptionsCli } from "../cli/options.js";
import { consumerPath } from "../consumer-root.js";
import { openPackets } from "./chain.js";

// A Writer slot: --classes walks only the agents with an option-table group (director, writer).
const SLOT = "writer/lexicon.brand-names";
const dirs: string[] = [];
/** A copy of the package's consumer with one placed Writer slot's folder removed (temp copy only). */
function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ia-no-folder-")));
  dirs.push(root);
  cpSync(consumerPath(), join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "node_modules/\n/.clossys/runs/\n");
  rmSync(join(root, "clossys", "agents", SLOT), { recursive: true, force: true });
  return root;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("an IA slot with no folder", { timeout: 120_000 }, () => {
  it("is an open ia item in gaps, never an ENOENT", async () => {
    const root = workspace();
    expect(existsSync(join(root, "clossys", "agents", SLOT))).toBe(false);
    const gaps = await runGapsCli(["--agent", "writer", "--json", "--root", root], root);
    expect(gaps.exitCode, gaps.message).not.toBe(2);
    expect(JSON.stringify(gaps.output)).toContain(SLOT);
  });

  it("is asked as an ia packet by next --owner", async () => {
    const root = workspace();
    const owner = await runNextCli(["--owner", "--agent", "writer", "--json", "--root", root], root);
    expect(owner.exitCode, owner.message).not.toBe(2);
    expect(JSON.stringify(owner.output)).not.toContain("ENOENT");
  });

  it("G8: its ia packet's record is the argv option (a) runs: --contract, no --under (refused for a placed slot)", () => {
    const root = workspace();
    const packet = openPackets(root).find(each => each.step === "ia" && each.item === SLOT)!;
    expect(packet).toBeDefined();
    expect(packet.record).toBe(`clossys ia ${SLOT} --contract <file>`);
    expect(packet.options?.[0]?.argv).toEqual(["clossys", "ia", SLOT, "--contract", "<contract.json>"]);
  });

  it("is an ia gap line in options --classes --check and options <slot>", async () => {
    const root = workspace();
    const classes = await runOptionsCli(["--classes", "--check", "--root", root], root);
    expect(classes.message).toContain(`ia gap ${SLOT}: no slot.json`);
    expect((classes.output as { unplaced: string[] }).unplaced).toContain(SLOT);
    const one = await runOptionsCli([SLOT, "--more", "--root", root], root);
    expect(one.exitCode).toBe(1);
    expect(one.message).toContain(`ia gap ${SLOT}`);
  });
});
