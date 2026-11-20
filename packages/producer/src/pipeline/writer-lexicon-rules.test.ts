import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { gapsOf, interviewOf } from "./interview.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

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
