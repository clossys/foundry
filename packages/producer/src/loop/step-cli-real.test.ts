/**
 * The loop steps' cli templates are real verb calls: filled the way the runner fills them (stepArgv) and run
 * through the real CLI, never a stub. The loop.fill and loop.refine `check` code steps run through cliHooks with
 * its default runner (the in-process `clossys` CLI, as `clossys run loop.fill` runs them), and every package
 * loop's refine-brief template is accepted by `clossys brief`. The old templates (`clossys check <ref>`,
 * `--tighten <path> <op> <value>`) are refused as usage errors, so these tests bite.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { runIaSyncCli } from "../cli/ia-sync.js";
import { PACKAGE_ROOT } from "../pipeline/options.js";
import { LATER, tallyhouseWorld } from "../records/__fixtures__/slot2-workspace.js";
import { cliHooks } from "./cli.js";
import { stepArgv } from "./slots.js";

interface LoopStepFile { readonly id: string; readonly cli: string; readonly decider: { readonly by: string } }
const PACKAGES = join(PACKAGE_ROOT, "..");

/** Every package loop version file: packages/<agent>/loops/<loop>/<stem>-v1.json. */
function packageLoops(): { file: string; steps: LoopStepFile[] }[] {
  const out: { file: string; steps: LoopStepFile[] }[] = [];
  for (const agent of readdirSync(PACKAGES).sort()) {
    const loops = join(PACKAGES, agent, "loops");
    if (!existsSync(loops)) continue;
    for (const loop of readdirSync(loops).sort()) for (const name of readdirSync(join(loops, loop)).filter(file => /-v1\.json$/.test(file))) {
      const content = (JSON.parse(readFileSync(join(loops, loop, name), "utf8")) as { content?: { steps?: LoopStepFile[] } }).content;
      out.push({ file: `${agent}/loops/${loop}/${name}`, steps: content?.steps ?? [] });
    }
  }
  return out;
}

const HERO = "writer/sections.hero.copy";
const HEADING = "contract.copy.fields[header.heading].maxLength.en";

async function synced() {
  const ws = tallyhouseWorld();
  await runIaSyncCli(["sync", "--at", LATER], ws.root);
  return ws;
}

describe("loop step templates through the real CLI", () => {
  it("runs the loop.fill and loop.refine check step through cliHooks' own runner: real arguments, never a usage error", async () => {
    const ws = await synced();
    const checks = packageLoops().filter(loop => /producer\/loops\/loop\.(fill|refine)\//.test(loop.file)).map(loop => ({ file: loop.file, step: loop.steps.find(step => step.id === "check")! }));
    expect(checks.map(row => row.file)).toEqual(["producer/loops/loop.fill/fill-v1.json", "producer/loops/loop.refine/refine-v1.json"]);
    const hooks = cliHooks(ws.root);
    for (const { file, step } of checks) {
      expect(step.decider.by, file).toBe("code");
      const filled = stepArgv(step.cli, { ref: HERO });
      expect(filled.unfilled, file).toEqual([]);
      const outcome = await hooks.code({ runId: "20261118T1140Z-fill-hero", step: "check", cli: filled.text, argv: filled.argv, ref: HERO });
      expect(outcome.detail ?? "", file).not.toMatch(/Unknown argument|Usage: clossys/);
      expect([0, 1], `${file}: ${outcome.detail}`).toContain(outcome.exit);
      expect(outcome.detail ?? "", file).toMatch(/constitution focus: 1 slot\(s\): writer\/sections\.hero\.copy/);
    }
  });

  it("the old check template is a usage error through the same hook (the test above bites)", async () => {
    const ws = await synced();
    const filled = stepArgv("clossys check <ref>", { ref: HERO });
    const outcome = await cliHooks(ws.root).code({ runId: "20261118T1140Z-fill-hero", step: "check", cli: filled.text, argv: filled.argv, ref: HERO });
    expect(outcome.exit).toBe(2);
    expect(outcome.detail).toMatch(/Unknown argument/);
  });

  it("every package loop's refine-brief template is accepted by clossys brief and appends the tighten entry", async () => {
    const briefs = packageLoops().flatMap(loop => loop.steps.filter(step => step.id === "refine-brief").map(step => ({ file: loop.file, cli: step.cli })));
    expect(briefs.length).toBeGreaterThanOrEqual(3);
    for (const { file, cli } of briefs) {
      const ws = await synced();
      const before = ws.read("writer", "sections.hero.copy").tighten.length;
      const filled = stepArgv(cli, { ref: HERO, path: HEADING, op: "max", value: "48", why: "owner feedback 20261118T0912Z-home-hero-copy", by: "owner:cli:clossys brief 2026-11-16T09:18:40Z" });
      expect(filled.unfilled, file).toEqual([]);
      const result = await runCli([...filled.argv.slice(1), "--at", LATER, "--root", ws.root], ws.root);
      expect(result.exitCode, `${file}: ${result.message}`).toBe(0);
      expect(ws.read("writer", "sections.hero.copy").tighten.length, file).toBe(before + 1);
    }
  });

  it("the old refine-brief template is a usage error (the test above bites)", async () => {
    const ws = await synced();
    const filled = stepArgv("clossys brief <ref> --tighten <path> <op> <value> --why <why>", { ref: HERO, path: HEADING, op: "max", value: "48", why: "owner feedback" });
    const result = await runCli([...filled.argv.slice(1), "--root", ws.root], ws.root);
    expect(result.exitCode).toBe(2);
  });
});
