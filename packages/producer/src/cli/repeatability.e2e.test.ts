/**
 * Repeatability, end to end through the built CLI, from an empty folder: `clossys config --init`, then every
 * open `clossys next --owner` question and `clossys next` packet answered with its recommended option (each
 * placeholder filled from __fixtures__/repeatability/answers.json), then `clossys run` to its end or a named
 * stop, then `clossys run` again. The second run must change nothing: the same files with the same bytes and
 * mtimes, and the same stop. Verbs only: the test writes no record itself.
 *
 * The seat interview must seat every decide step the chain defines (one `clossys seat <step>` call each). A
 * seat interview that asks no seat question fails here on that count; it is not worked around.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runVerb, snapshot } from "./__fixtures__/flat-consumer.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "repeatability");
const answers = JSON.parse(readFileSync(join(fixtures, "answers.json"), "utf8")) as { fill: Record<string, string>; files: Record<string, string> };
const fill: Record<string, string> = { ...answers.fill, ...Object.fromEntries(Object.entries(answers.files).map(([key, file]) => [key, join(fixtures, file)])) };
const MAX_ROUNDS = 20;

type Call = readonly string[];
interface Option { recommended: boolean; calls?: Call[]; argv?: Call | null; fill: Record<string, string> }
interface Answered { source: string; call: Call; status: number | null; message: string }

/** A recommended call with every placeholder filled from the fixture; an unfilled placeholder is an error. */
function filled(call: Call, wanted: Record<string, string>): string[] {
  const words = (call[0] === "clossys" ? call.slice(1) : call).map(word => Object.entries(fill).reduce((text, [key, value]) => text.split(key).join(value), word));
  const open = Object.keys(wanted).filter(key => words.some(word => word.includes(key)));
  if (open.length) throw new Error(`fixture fills no ${open.join(", ")} in ${call.join(" ")}`);
  return words;
}

function recommended(options: readonly Option[], where: string): Option {
  const option = options.find(each => each.recommended);
  if (!option) throw new Error(`${where} has no recommended option`);
  return option;
}

let root: string;
const answered: Answered[] = [];
let first: ReturnType<typeof runVerb>, second: ReturnType<typeof runVerb>;
let afterFirst: unknown[], afterSecond: unknown[];
let decideSteps: string[];

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "producer-repeat-")));
  const init = runVerb(["config", "--init"], root);
  if (init.status !== 0) throw new Error(`config --init exited ${init.status}: ${init.stdout}${init.stderr}`);
  const explain = runVerb(["run", "--explain"], root);
  decideSteps = (explain.value.rows as { step: string; kind: string }[]).filter(row => row.kind.startsWith("decide")).map(row => row.step).sort();
  const answer = (source: string, call: Call, wanted: Record<string, string>) => {
    const result = runVerb(filled(call, wanted), root);
    answered.push({ source, call, status: result.status, message: result.value?.message ?? result.stderr });
  };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const owner = runVerb(["next", "--owner"], root);
    if (owner.status !== 0) throw new Error(`next --owner exited ${owner.status}: ${owner.stderr}`);
    if (owner.value.count > 0) {
      for (const question of owner.value.rounds[0] as { id: string; options: Option[] }[]) {
        const option = recommended(question.options, `next --owner ${question.id}`);
        for (const call of option.calls ?? []) answer(`next --owner ${question.id}`, call, option.fill);
      }
      continue;
    }
    const next = runVerb(["next"], root);
    if (next.status !== 0) throw new Error(`next exited ${next.status}: ${next.stderr}`);
    if (next.value.step === null) return;
    const option = recommended(next.value.options ?? [], `next ${next.value.step} ${next.value.item}`);
    if (!option.argv) throw new Error(`next ${next.value.step} ${next.value.item}: the recommended option names no argv`);
    answer(`next ${next.value.step}`, option.argv, option.fill);
  }
  throw new Error(`still open after ${MAX_ROUNDS} rounds of answers`);
}, 600_000);
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe("a fresh consumer, run twice (repeatability)", () => {
  it("records every recommended answer through its verb", () => {
    expect(answered.filter(each => each.status !== 0)).toEqual([]);
    expect(answered.length).toBeGreaterThan(0);
  });

  it("seats every decide step the chain defines", () => {
    const seated = answered.map(each => each.call).filter(call => call[1] === "seat" && !call[2]!.startsWith("--")).map(call => call[2]!);
    expect(decideSteps.length).toBeGreaterThan(0);
    expect([...new Set(seated)].sort()).toEqual(decideSteps);
  });

  it("runs to its end or a named stop, and a second run changes nothing", () => {
    first = runVerb(["run"], root);
    afterFirst = snapshot(root);
    second = runVerb(["run"], root);
    afterSecond = snapshot(root);
    for (const run of [first, second]) {
      expect(run.status === 0 || run.status === 1).toBe(true);
      const named = run.value.failed?.step ?? run.value.stop?.step ?? (run.status === 0 ? "end" : undefined);
      expect(named).toEqual(expect.any(String));
    }
    expect(second.status).toBe(first.status);
    expect(second.value.failed ?? null).toEqual(first.value.failed ?? null);
    expect(second.value.stop ?? null).toEqual(first.value.stop ?? null);
    expect(second.value.rows.map((row: { step: string; state: string }) => `${row.step} ${row.state}`)).toEqual(first.value.rows.map((row: { step: string; state: string }) => `${row.step} ${row.state}`));
    expect(afterSecond).toEqual(afterFirst);
  }, 600_000);
});
