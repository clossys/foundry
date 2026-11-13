import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { readCandidate } from "../records/slots.js";
import { writeCandidate, writePin } from "../records/slot-write.js";
import { writerWording } from "../records/writer-wording.js";
import { gapsOf, interviewOf } from "./interview.js";
import { PACKAGE_ROOT } from "./options.js";
import { SEAT_POLICY_FILE } from "./seat-policy.js";

/** The foundry consumer this package ships beside: its pinned Writer lexicon is the rule source under test. */
const FOUNDRY = join(PACKAGE_ROOT, "..", "..", "clossys");
const dirs: string[] = [];
function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "writer-lexicon-")));
  dirs.push(root);
  cpSync(FOUNDRY, join(root, "clossys"), { recursive: true, filter: source => !source.endsWith(SEAT_POLICY_FILE.split("/").at(-1)!) });
  writeFileSync(join(root, ".gitignore"), "node_modules/\n/.clossys/runs/\n");
  return root;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const SLOT = "strings.actions";
const ITEM = `writer/${SLOT}`;
const RECORD = "studio.action.request-change";

describe("Writer lexicon rules for the known wording issues (R2F-W2)", { timeout: 120_000 }, () => {
  it("copy that speaks of the owner in third person breaks the pinned owner-voice rule and is one Writer wording packet", () => {
    const root = workspace();
    const consumer = join(root, "clossys");
    const pin = JSON.parse(readFileSync(join(consumer, "agents", "writer", SLOT, "pin.json"), "utf8")) as { candidate: string };
    const bytes = readCandidate(consumer, "writer", SLOT, pin.candidate).bytes;
    // The fixture: one action label reworded to "the owner pins" (the slot's other candidates keep the old label: the rewrite).
    const fixture = bytes.replace(/^Request change$/m, "Request change before the owner pins");
    expect(fixture).not.toBe(bytes);
    const written = writeCandidate(consumer, "writer", SLOT, "studio", fixture);
    writePin(consumer, "writer", SLOT, written.name, { decidedBy: "owner", basis: "bulk", at: "2026-11-12T00:00:00.000Z" });

    const row = writerWording(consumer).rows.find(each => each.slot === SLOT)!;
    expect(row.findings.filter(finding => finding.record === RECORD).map(finding => [finding.check, finding.message]))
      .toContainEqual(["W-VOICE", expect.stringContaining("writer:studio.pattern.owner-third-person")]);
    const questions = interviewOf(root, { agent: "writer" }).rounds.flat().filter(question => question.id === `writer.wording:${ITEM}`);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.question).toContain("\"Request change before the owner pins\"");
    expect(questions[0]!.options[0]!.label).toMatch(/^Rewrite \(Recommended\): "Request change"/);
  });

  it("a drafted legal revision date breaks the pinned legal-date rule", () => {
    const consumer = join(workspace(), "clossys");
    const rows = writerWording(consumer).rows;
    const legal = rows.find(each => each.slot === "passages.legal-prose");
    expect(legal?.findings.map(finding => [finding.record, finding.message])).toContainEqual(["studio.license.revision.value", expect.stringContaining("writer:studio.pattern.drafted-legal-date")]);
  });
});

describe("Producer interview text reads as English when grouped (R2F-W2 item 5)", { timeout: 120_000 }, () => {
  it("two agents' IA packets merge into one question whose options name no 'each IA'", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "interview-ia-")));
    dirs.push(root);
    const at = ["--root", root];
    expect((await runCli(["config", "--init", ...at], root)).exitCode).toBe(0);
    expect((await runCli(["ia", "director", "--adopt", ...at], root)).exitCode).toBe(0);
    const question = interviewOf(root).rounds.flat().find(each => each.step === "ia" && each.items.length === 2)!;
    expect(question.items).toEqual(["designer", "writer"]);
    const labels = question.options.map(option => option.label);
    expect(labels).toContain("Adopt the Foundry IA for each: its tree and every slot's contract, inputs and uses.");
    for (const label of labels) expect(label).not.toMatch(/\beach IA\b/);
  });

  it("the no-request note counts citations in a sentence", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "interview-notes-")));
    dirs.push(root);
    const at = ["--root", root];
    expect((await runCli(["config", "--init", ...at], root)).exitCode).toBe(0);
    for (const agent of ["director", "designer", "writer"]) expect((await runCli(["ia", agent, "--adopt", ...at], root)).exitCode).toBe(0);
    const notes = gapsOf(root).notes;
    for (const note of notes) expect(note).not.toMatch(/of the \d+ name /);
    expect(notes.some(note => /: \d+ of the \d+ citations? name \w+ slots with no candidates yet/.test(note))).toBe(true);
  });
});
