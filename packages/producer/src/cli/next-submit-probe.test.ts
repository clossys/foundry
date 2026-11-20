/**
 * foundry-build-0048 U37c r2: `clossys next --submit`'s identity probe (cli/next.ts). Before anything is written, the
 * submission is serialized as writeCandidate would write it (records/slot-write.ts submittedBytes, the one submit
 * serializer), and its content digest is compared with every held candidate's.
 *
 * - The serializer's refusal of the bytes (CandidateRefusal) leaves the probe as the bytes themselves; writeCandidate
 *   then refuses the submission in its own order, with its own message.
 * - Any other error from the probe is a fault and propagates: it is never read as "no probe".
 * - The identity refusal reads the probe's bytes, not the submitted ones (blind A finding 1, M7).
 *
 * On M7: for every submission that passes next --submit's schema check and the int2 kind rules, today's serializer
 * gives the same content digest as the submitted bytes, so no real input tells the probe from the bytes. A Designer
 * element whose only source is meta.element.source is the shape where the two differ, but the schema check refuses it
 * ("/meta requires source") before the probe runs. So the third case gives the probe a stand-in serializer: the one
 * module mocked here is slot-write's submittedBytes as next.ts imports it, while writeCandidate keeps the real one.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { STEPS } from "../pipeline/steps/index.js";
import { validateFile } from "../pipeline/schema.js";
import { candidateHeaderOf } from "../records/slot-current.js";
import { runNextSubmitCli } from "./next.js";

const probe = vi.hoisted(() => ({ mode: "real" as "real" | "fault" | "bytes", bytes: "" }));
vi.mock("../records/slot-write.js", async original => {
  const real = await original<typeof import("../records/slot-write.js")>();
  return {
    ...real,
    submittedBytes: (...args: Parameters<typeof real.submittedBytes>) => {
      if (probe.mode === "fault") throw new TypeError("probe fault: not a refusal");
      if (probe.mode === "bytes") return probe.bytes;
      return real.submittedBytes(...args);
    },
  };
});

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const SKILL = STEPS.find(step => step.id === "designer.candidates")!.command.skill!;
const SOURCE = { kind: "original", ref: [], license: "MIT" };
const HERO = {
  $schema: "https://ui.shadcn.com/schema/registry-item.json",
  name: "hero",
  type: "registry:block",
  files: [{ path: "hero.tsx", type: "registry:block", content: "export function Hero() { return <section><h1>Hero</h1></section>; }\n" }],
  meta: { slot: "sections.hero", source: SOURCE },
};

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "next-submit-probe-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const dir = join(root, "clossys", "agents", "designer", "sections.hero");
  const state = () => ({
    candidates: existsSync(join(dir, "candidates")) ? readdirSync(join(dir, "candidates")).sort() : [],
    ledger: readFileSync(join(dir, "ledger.json"), "utf8"),
  });
  const submit = (element: unknown, guard?: { rules: [] }) => {
    const input = join(root, `hero-${Math.random().toString(36).slice(2, 8)}.json`);
    writeFileSync(input, `${JSON.stringify(element, null, 2)}\n`);
    return runNextSubmitCli(["designer/sections.hero", "--submit", input, "--model", "fixture-model", "--tier", "mid", "--skill", SKILL,
      "--basis", "agent", "--rung", "L1", "--seed", "shadcn-aria/hero", "--root", root], root, undefined, undefined, guard ?? true);
  };
  return { root, dir, state, submit };
}

describe("clossys next --submit: the identity probe (U37c r2)", () => {
  it("a serializer refusal of the probe leaves the submission to writeCandidate, which refuses it with its own message, writing nothing", async () => {
    probe.mode = "real";
    const { state, submit } = world();
    // Schema-valid and int2-valid, but the codec refuses a clossys key beside the element's own keys (CandidateRefusal).
    const element = { ...HERO, clossys: { updatedAt: "2026-11-20T00:00:00Z" } };
    expect(validateFile("candidate-element", "clossys/agents/designer/sections.hero/candidates/hero-v1.json", JSON.stringify(element))).toEqual([]);
    const before = state();
    const result = await submit(element);
    expect(result.exitCode, result.message).toBe(1);
    expect(result.message).toMatch(/hero-v1\.json: holds keys beside clossys and content; not rewritten/);
    expect(state()).toEqual(before);
  }, 300_000);

  it("any other error from the probe propagates: it is a fault, not a refusal, and nothing is written", async () => {
    probe.mode = "fault";
    try {
      const { state, submit } = world();
      const before = state();
      await expect(submit(HERO)).rejects.toThrow(new TypeError("probe fault: not a refusal"));
      expect(state()).toEqual(before);
    } finally { probe.mode = "real"; }
  }, 300_000);

  it("the identity refusal reads the probe's bytes: a submission the serializer writes as a held candidate's content is refused before the guard", async () => {
    probe.mode = "real";
    const { dir, state, submit } = world();
    // The held element, written by the same verb with the constitution registry empty (no fixture Designer slot
    // reaches a valid rung under the full guard); its file is the serializer's clossys.candidate/1 file.
    const first = await submit(HERO, { rules: [] });
    expect(first.exitCode, first.message).toBe(0);
    const name = (first.output as { candidate: string }).candidate;
    const held = readFileSync(join(dir, "candidates", name), "utf8");
    expect(candidateHeaderOf(name, held)).toMatchObject({ schema: "clossys.candidate/1", source: SOURCE });
    // A submission whose own bytes differ in content (another file body), with a stand-in serializer that writes it
    // as the held file: only the probe's bytes carry the held content digest. The full guard runs on this submit.
    const other = { ...HERO, files: [{ ...HERO.files[0]!, content: "export function Hero() { return <section><h1>Other</h1></section>; }\n" }] };
    probe.mode = "bytes";
    probe.bytes = held;
    try {
      const before = state();
      const again = await submit(other);
      expect(again.exitCode, again.message).toBe(1);
      expect(again.message).toMatch(new RegExp(`has the same content as designer/sections\\.hero candidate ${name.replace(".", "\\.")} \\(it differs only in header provenance or JSON layout\\)`));
      expect(state()).toEqual(before);
    } finally { probe.mode = "real"; }
  }, 300_000);
});
