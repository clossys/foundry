import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./slot-resolve.js", () => ({ runSlotResolve: async () => ({ exitCode: 0 }), slotResolveSummary: () => "slot integrity passed" }));
import { runCheck } from "../cli/check.js";
import { parseArgs } from "../cli/args.js";
import { runInitCli } from "../cli/init.js";
import { runLoopCli } from "../cli/loop.js";
// @ts-expect-error untyped test-support module
import { writeDesignerSlot } from "../../../designer/scripts/__fixtures__/slot-model.mjs";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
it("default check enforces the actual reference gate without --suites or --strict", async () => {
  const root = mkdtempSync(join(tmpdir(), "default-ref-check-")); roots.push(root);
  const clossys = join(root, "clossys");
  mkdirSync(clossys, { recursive: true });
  writeFileSync(join(clossys, "clossys.config.ts"), "export default {};");
  // A pinned Designer slot (the flat slot model: agents/designer/<slot>/) whose code has no lineage source.
  const item = { name: "hero", type: "registry:block", files: [{ path: "hero.tsx", content: "export const Hero = () => <section />\n" }] };
  const slot = writeDesignerSlot(clossys, { id: "sections.hero", candidates: { "hero-v1.json": item }, pin: "hero-v1.json" });
  const args = parseArgs(["check", "--root", root]);
  const failed = await runCheck(args, root);
  expect(failed.exitCode).toBe(1);
  expect(failed.message).toContain("REF-NO-SOURCE");
  expect(failed.suites?.suites[0]?.suite).toBe("ref-verbatim");
  // Unpinned, the same candidate is no pin to check: the default reference gate passes.
  rmSync(join(slot, "pin.json"));
  const unseated = await runCheck(args, root);
  expect(unseated.message).not.toContain("REF-NO-SOURCE");
  expect(unseated.suites?.suites[0]).toMatchObject({ suite: "ref-verbatim", exitCode: 0 });
  // U9a: this consumer's IA places Designer (writeDesignerSlot writes it) and it never adopted Designer's loops, so it is
  // red in loop.agent-standard (no vacuous pass).
  // foundry-build-0048: publisher.admin-seated judges every slot-model workspace, so this one is red until clossys init
  // seats the admin workspace. Those two are the check's only reds, and the exit follows them.
  expect(Object.keys(unseated.checks ?? {})).toEqual(["loop.agent-standard", "publisher.admin-seated"]);
  expect(unseated.exitCode).toBe(1);
  expect((await runInitCli(["--root", root, "--at", "2026-11-18T00:00:00Z"], root)).exitCode).toBe(0);
  // Seated, publisher.admin-seated passes. foundry-build-0048 U20: init also adopts and pins the five loops of every
  // agent the workspace places (Designer, from writeDesignerSlot's IA, and Publisher, which the seat places), so the loop
  // checks pass too. The default check exits 0 here only because this file mocks slot integrity: unmocked, a fresh init
  // stays red on the admin slots' pins, which wait for upstream pins (pinned in cli/init-admin.test.ts).
  const seated = await runCheck(args, root);
  expect(Object.keys(seated.checks ?? {})).toEqual([]);
  expect(seated.exitCode).toBe(0);
  // clossys loop <agent>/loop.scope on an agent init already adopted changes nothing and stays green.
  for (const agent of ["designer", "publisher"]) expect((await runLoopCli([`${agent}/loop.scope`, "--root", root, "--at", "2026-11-18T00:00:00Z"], root)).exitCode).toBe(0);
  const adopted = await runCheck(args, root);
  expect(Object.keys(adopted.checks ?? {})).toEqual([]);
  expect(adopted.exitCode).toBe(0);
});
