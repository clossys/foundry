/**
 * `clossys write --brief` names every pinned input a Writer slot's contract (slot.json `refs`, rel input) names,
 * as name and value. In process, over a copy of the shipped fixture consumer (test-fixtures/consumer), whose
 * Director and lexicon slots are pinned already; synthetic fixture data only.
 */
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./main.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

interface Input { input: string; key?: string; value: string; slots: string[] }

describe("clossys write --brief over the slot contracts", () => {
  it("briefs every pinned input a Writer slot's contract names, as name and value (director/identity.naming.name)", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "producer-write-inputs-")));
    roots.push(root);
    cpSync(FIXTURE, root, { recursive: true });
    const result = await runCli(["write", "--brief", "--json"], root) as Awaited<ReturnType<typeof runCli>> & { brief: { slotInputs: Input[]; unpinnedSlotInputs: (Input & { why: string })[] } };
    const { slotInputs, unpinnedSlotInputs } = result.brief;
    const candidate = readFileSync(join(root, "clossys/agents/director/identity.naming.name/candidates/name-v1.md"), "utf8");
    const name = /^- Name: (.*)$/m.exec(candidate)![1]!;
    expect(slotInputs).toContainEqual(expect.objectContaining({ input: "director/identity.naming.name", key: "Name", value: name, slots: expect.arrayContaining(["sections.wizard.copy"]) }));
    // A Writer input carries its pinned candidate's body; every listed value is real text.
    expect(slotInputs.find(row => row.input === "writer/lexicon.formality")?.value).toMatch(/\S/);
    expect(slotInputs.every(row => row.value.trim().length > 0)).toBe(true);
    // An input with no pinned candidate is named apart with its reason, never given a value.
    for (const row of unpinnedSlotInputs) {
      expect(row.why).toMatch(/has no pinned candidate|no Direction line keyed|is not a slot agent/);
      expect(row).not.toHaveProperty("value");
    }
  }, 120_000);
});
