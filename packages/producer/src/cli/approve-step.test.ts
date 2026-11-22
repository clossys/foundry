import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runApproveCli } from "./owner.js";
import { readRuns } from "../pipeline/trace.js";

/**
 * One writer per output (BR-PIPELINE2): pin.writer is the only step that writes a Writer pin.json, so
 * `clossys approve` reaches the pin through the runner as the pin step, never through the pin module directly.
 */
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const AT = "2026-11-21T12:00:00.000Z";

function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "approve-step-")));
  roots.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  // The run store's contract: a workspace keeps run records only when it ignores them (trace.ts storeIgnored).
  writeFileSync(join(root, ".gitignore"), "/clossys/.state/runs/\n");
  const slot = join(root, "clossys", "agents", "writer", "home.hero");
  mkdirSync(join(slot, "candidates"), { recursive: true });
  writeFileSync(join(slot, "slot.json"), `${JSON.stringify({ schema: "clossys.slot/2", kind: "copy" })}\n`);
  writeFileSync(join(slot, "candidates", "copy-v1.json"), "{}\n");
  return root;
}

describe("clossys approve runs its pin through the pin step", () => {
  it("records a pin.writer run carrying the approval's decider, basis and time", async () => {
    const root = workspace();
    const by = "owner:queue.approve#20261121T1200Z-home-hero";
    expect(readRuns(root).filter(run => run.record.step === "pin.writer")).toEqual([]);
    await runApproveCli(["writer/home.hero#copy", "copy-v1", "--by", by, "--at", AT, "--root", root], root);
    const pins = readRuns(root).filter(run => run.record.step === "pin.writer");
    expect(pins).toHaveLength(1);
    expect(pins[0]!.record.argv).toEqual(["pin", "writer/home.hero#copy", "copy-v1.json", "--by", by, "--basis", "picked", "--at", AT, "--root", "."]);
  });
});
