import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./slot-resolve.js", () => ({ runSlotResolve: async () => ({ exitCode: 0 }), slotResolveSummary: () => "slot integrity passed" }));
import { runCheck } from "../cli/check.js";
import { parseArgs } from "../cli/args.js";
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
  const unpinned = await runCheck(args, root);
  expect(unpinned.message).not.toContain("REF-NO-SOURCE");
  expect(unpinned.suites?.suites[0]?.exitCode ?? 0).toBe(0);
  // U9a: this consumer's IA places Designer (writeDesignerSlot writes it) and it never adopted Designer's loops, so it is
  // red in loop.agent-standard (no vacuous pass); that is the check's only red, and the exit follows it.
  expect(Object.keys(unpinned.checks ?? {})).toEqual(["loop.agent-standard"]);
  expect(unpinned.exitCode).toBe(1);
});
