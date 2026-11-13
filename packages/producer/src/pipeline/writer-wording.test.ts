import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { readCandidate } from "../records/slots.js";
import { writeCandidate, writePin } from "../records/slot-write.js";
import { writerWording } from "../records/writer-wording.js";
import { CONFIRM_REF, gapsOf, interviewIssues, interviewOf } from "./interview.js";
import { PACKAGE_ROOT } from "./options.js";
import { SEAT_POLICY_FILE } from "./seat-policy.js";

/** The foundry consumer this package ships beside: a real slot model to copy (never the real records). */
const FOUNDRY = join(PACKAGE_ROOT, "..", "..", "clossys");
const dirs: string[] = [];
function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "writer-wording-")));
  dirs.push(root);
  cpSync(FOUNDRY, join(root, "clossys"), { recursive: true, filter: source => !source.endsWith(SEAT_POLICY_FILE.split("/").at(-1)!) });
  writeFileSync(join(root, ".gitignore"), "node_modules/\n/.clossys/runs/\n");
  return root;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const SLOT = "strings.actions";
const ITEM = `writer/${SLOT}`;
const REF = "clossys/workspace#46 issuecomment-1";
/**
 * The fixture wording finding: a bulk-pinned candidate whose first action ends with "!", which the pinned
 * lexicon's `studio.pattern.exclamation` rule (W-VOICE) reports. The slot's older candidates hold the same
 * record without it: the Writer's rewrite.
 */
function exclaimed(root: string): { pinned: string; original: string } {
  const consumer = join(root, "clossys");
  const pin = JSON.parse(readFileSync(join(consumer, "agents", "writer", SLOT, "pin.json"), "utf8")) as { candidate: string };
  const bytes = readCandidate(consumer, "writer", SLOT, pin.candidate).bytes;
  const fixture = bytes.replace(/^Request change$/m, "Request change!");
  expect(fixture).not.toBe(bytes);
  const written = writeCandidate(consumer, "writer", SLOT, "studio", fixture);
  writePin(consumer, "writer", SLOT, written.name, { decidedBy: "owner", basis: "bulk", at: "2026-11-12T00:00:00.000Z" });
  return { pinned: written.name, original: pin.candidate };
}
/** The fixture slot's wording question (the real records carry wording findings of their own on other slots). */
const wordingOf = (root: string) => interviewOf(root, { agent: "writer" }).rounds.flat().filter(question => question.id === `writer.wording:${ITEM}`);

describe("Writer wording findings reach the Writer's owner questions (R2F-W1)", { timeout: 120_000 }, () => {
  it("a wording finding on pinned copy is one Writer MC packet: the rewrite (recommended), keep as is, own words", async () => {
    const root = workspace();
    const { pinned } = exclaimed(root);
    const row = writerWording(join(root, "clossys")).rows.find(each => each.slot === SLOT)!;
    expect(row.findings.map(finding => [finding.record, finding.check, finding.current])).toContainEqual(["studio.action.request-change", "W-VOICE", "Request change!"]);
    expect(row.rewrite?.texts).toContainEqual({ record: "studio.action.request-change", locale: "en", text: "Request change" });

    const interview = interviewOf(root, { agent: "writer" });
    const questions = wordingOf(root);
    expect(questions).toHaveLength(1);
    const question = questions[0]!;
    expect(question).toMatchObject({ agent: "writer", header: "Wording", items: [ITEM] });
    expect(question.question).toContain("\"Request change!\"");
    expect(question.reason).toBeTruthy();
    const [rewrite, keep] = question.options;
    expect(rewrite).toMatchObject({ recommended: true, calls: [["clossys", "pin", ITEM, row.rewrite!.candidate, "--basis", "picked", "--by", `owner:${CONFIRM_REF}`]] });
    expect(rewrite!.label).toMatch(/^Rewrite \(Recommended\): "Request change"/);
    expect(keep).toMatchObject({ recommended: false, calls: [["clossys", "pin", ITEM, pinned, "--basis", "picked", "--by", `owner:${CONFIRM_REF}`]] });
    expect(keep!.label).toMatch(/^Keep as is: "Request change!"/);
    expect(question.freeText.calls?.at(-1)).toEqual(["clossys", "options", ITEM, "--redraft"]);
    expect(interviewIssues(interview, gapsOf(root))).toEqual([]);

    // The answer flows back through pin with the ledger ref; the slot is then settled and asked no more.
    for (const call of rewrite!.calls) {
      const result = await runCli([...call.slice(1).map(word => word.replace(CONFIRM_REF, REF)), "--root", root], root);
      expect(result.exitCode, result.message).toBe(0);
    }
    expect(wordingOf(root)).toEqual([]);
  });

  it("with no rewrite drafted yet, the Writer drafts first and nothing is asked", () => {
    const root = workspace();
    const consumer = join(root, "clossys");
    const { original } = exclaimed(root);
    // Every other candidate carries the same finding: no candidate rewrites the record.
    for (const name of ["studio-v1.md", "studio-v2.md", original]) {
      const path = join(consumer, "agents", "writer", SLOT, "candidates", name);
      writeFileSync(path, readFileSync(path, "utf8").replace(/^Request change$/m, "Request change!"));
    }
    expect(wordingOf(root)).toEqual([]);
    const gap = gapsOf(root, { agent: "writer" }).gaps.find(each => each.code === "writer.wording" && each.item === ITEM)!;
    expect(gap).toMatchObject({ decider: "agent" });
    expect(gap.message).toContain(`clossys options ${ITEM} --redraft`);
  });

  it("a narrative (JSON block) record reads its title and block text: a redraft that differs is offered", () => {
    const root = workspace();
    const consumer = join(root, "clossys");
    const slot = "narratives.article";
    const pin = JSON.parse(readFileSync(join(consumer, "agents", "writer", slot, "pin.json"), "utf8")) as { candidate: string };
    const bytes = readCandidate(consumer, "writer", slot, pin.candidate).bytes;
    const fixture = bytes.replace("A change is a new version, so history is git.", "A change is a new version, so history is git!");
    expect(fixture).not.toBe(bytes);
    const written = writeCandidate(consumer, "writer", slot, "studio", fixture);
    writePin(consumer, "writer", slot, written.name, { decidedBy: "owner", basis: "bulk", at: "2026-11-12T00:00:00.000Z" });

    const row = writerWording(consumer).rows.find(each => each.slot === slot)!;
    const finding = row.findings.find(each => each.record === "studio.docs.slot-model.article" && each.check === "W-VOICE")!;
    expect(finding.current).toContain("so history is git!");
    expect(row.rewrite).not.toBeNull();
    const text = row.rewrite!.texts.find(each => each.record === "studio.docs.slot-model.article")!.text;
    expect(text).toContain("so history is git.");
    expect(text).not.toBe(finding.current);
    const question = interviewOf(root, { agent: "writer" }).rounds.flat().find(each => each.id === `writer.wording:writer/${slot}`)!;
    expect(question.options[0]!.label).toMatch(/^Rewrite \(Recommended\): "The slot model/);
  });
});
