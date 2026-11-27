/**
 * BR-E2E9: `clossys next --submit --name` takes the stems constitution R08.1 takes (records/slot-model
 * candidateStemIssue, the one rule both read): the slot's leaf, or a record the slot's contract declares
 * (page.home.meta declares `home.meta`). An undeclared stem and another slot's record are refused before anything
 * is written. Runs on a temp copy of `test-fixtures/consumer` (the fixture stays byte-identical).
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { STEPS } from "../pipeline/steps/index.js";
import { runNextSubmitCli } from "./next.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const COPY = fileURLToPath(new URL("../../e2e/home-meta.md", import.meta.url));
const SKILL = STEPS.find(step => step.id === "writer.candidates")!.command.skill!;
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "next-submit-name-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const dir = join(root, "clossys", "agents", "writer", "page.home.meta");
  const state = () => ({ candidates: readdirSync(join(dir, "candidates")).sort(), ledger: readFileSync(join(dir, "ledger.json"), "utf8") });
  const submit = (name?: string) => runNextSubmitCli(["writer/page.home.meta", "--submit", COPY, "--model", "fixture-model", "--tier", "mid", "--skill", SKILL,
    "--basis", "agent", "--rung", "create", "--reason", "fixture: no seed fits", ...(name === undefined ? [] : ["--name", name]), "--root", root], root);
  return { state, submit };
}

describe("clossys next --submit --name: the R08.1 stem rule", () => {
  // The fixture slot has run no craft stages, so every accepted name reaches the submit guard and stops at R15.7
  // there; the guard also runs R08.1 and finds no row, and the candidate it judges carries the given stem.
  it("takes the leaf and a record the slot's contract declares as far as no --name goes, to the guard, under that stem", async () => {
    const { submit } = world();
    const unnamed = await submit();
    expect(unnamed.message).toContain("submit refused by the constitution guard: R15.7");
    expect(unnamed.message).toContain("critiques/meta-v2.json");
    expect(unnamed.message).not.toContain("R08.1");
    expect((await submit("meta")).message).toBe(unnamed.message);
    // c3-12: the refusal also names the candidate file the slot takes, under the given stem.
    expect(unnamed.message).toContain("the slot takes candidate file meta-v2.md; its critique is critiques/meta-v2.json");
    expect((await submit("home.meta")).message).toBe(unnamed.message.replaceAll("critiques/meta-v2.json", "critiques/home.meta-v2.json").replace("candidate file meta-v2.md", "candidate file home.meta-v2.md"));
  });

  it("refuses an undeclared stem and another slot's record, naming the declared records, and writes nothing", async () => {
    const { state, submit } = world();
    const before = state();
    for (const name of ["nope", "about.meta"]) {
      const result = await submit(name);
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain(`--name ${name} for writer/page.home.meta is not the slot leaf meta or a record its contract declares (home.meta); a candidate is named <leaf>-v<n> (R08.1)`);
      expect(state()).toEqual(before);
    }
  });
});
