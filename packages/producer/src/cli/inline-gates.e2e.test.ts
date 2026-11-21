/**
 * Inline gates end to end (foundry-feedback-0018): the maker is stopped at the write, with the rule
 * id and a one-line fix, and only by the slot it writes.
 * - submit refuses a non-derived theme candidate on R20.1 with the fix, writes nothing, and takes the
 *   corrected candidate, while an unrelated slot already failing R20.1 never blocks it;
 * - an adopt is held to the Designer ref-verbatim gate at submit;
 * - `check --constitution --slot` is the per-slot preflight (only that slot's rows, each with a fix);
 * - `check --constitution --changed <ref>` runs it on the slots changed against a git ref.
 * The guard's registry is the real rules.json joined to the real rule modules (R03, R06, R20: the
 * guards this unit moved to write time); R05's certification needs a standard and fixture per slot
 * and is proven by its own tests.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { designerTrace } from "../constitution/checks/R20-director-derived.js";
import { changedSlots } from "../constitution/changed.js";
import { buildContext } from "../constitution/context.js";
import { REF_VERBATIM_FIX } from "../constitution/fix.js";
import { registeredRules } from "../constitution/registry.js";
import { PROVENANCE_RULE_PATH, REFERENCE_MANIFEST_PATH } from "../constitution/rules/r03.js";
import { MANIFEST, RULE } from "../constitution/rules/r03.world.js";
import type { Row } from "../constitution/types.js";
import { cleanSpec, ledgerDoc, ledgerEvent, NO_HISTORY, sha, slotDoc, writeWorkspace, type WorkspaceSpec } from "../constitution/__fixtures__/workspace.js";
import { STEPS } from "../pipeline/steps/index.js";
import { parseArgs } from "./args.js";
import { runCheck } from "./check.js";
import "./main.js";
import { runNextSubmitCli } from "./next.js";

const THEME = "themes.primary";
const OTHER = "themes.accent";
const R20_FIX = "fix: cite the pinned Director slot it realises in meta.element.reason (director:<slot-id>)";
const skill = STEPS.find(step => step.id === "designer.candidates")!.command.skill!;
/** A Designer theme candidate (an original: the fixture rule lists themes.* as consumer assets) whose meta.element.reason is `reason` (omitted when undefined). */
const element = (name: string, reason?: string) => ({
  name, type: "registry:theme", files: [],
  meta: { source: { kind: "original", ref: [] }, element: { id: name, ...(reason === undefined ? {} : { reason }) } },
});

function spec(): WorkspaceSpec {
  const base = cleanSpec();
  // Positions follow the fixture IA's one designer bucket: ui.button 0, ui.card 1, then these two.
  const placed = (id: string, order: number) => { const doc = slotDoc("designer", id, { inputs: ["brand.voice"] }); return { ...doc, ia: { ...(doc.ia as object), order } }; };
  const theme = placed(THEME, 2);
  base.designer![THEME] = {
    slot: theme, pin: false,
    // A P2 slot: the latest verdict is create, so a create-rung submit is allowed (section 5).
    ledger: ledgerDoc([
      ledgerEvent("slot", "ia", "packages/producer/actions/ia/skill.md", {}, [{ file: "slot.json", sha256: sha(`${JSON.stringify(theme, null, 2)}\n`) }]),
      ledgerEvent("verdict", "verdict", "packages/producer/actions/verdict/skill.md", { verdict: "create", model: "fixture-llm", tier: "high" }),
    ]),
  };
  // An unrelated slot that already fails R20.1: its pinned theme cites no Director slot.
  base.designer![OTHER] = { slot: placed(OTHER, 3), candidates: { "accent-v1.json": element("accent") } };
  return base;
}

let root: string;
let consumer: string;
beforeEach(() => {
  ({ root, consumer } = writeWorkspace(spec()));
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
  // The Designer provenance rule and reference manifest R03.2 reads: the R03 world's, with the fixture
  // themes as consumer-owned originals, so R03.2 has nothing to say and R20 is the only gate in play.
  const put = (rel: string, value: unknown) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), `${JSON.stringify(value, null, 2)}\n`); };
  put(PROVENANCE_RULE_PATH, { ...RULE, consumerAssets: { slots: [...RULE.consumerAssets.slots, "themes.*"] } });
  put(REFERENCE_MANIFEST_PATH, MANIFEST);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const moved = registeredRules().filter(rule => ["R03", "R06", "R20"].includes(rule.id));
const submit = (value: unknown, guard: Record<string, unknown> = { rules: moved, refVerbatim: true, history: () => NO_HISTORY }, ladder = ["--rung", "L4", "--reason", "fixture: no seed realises this brand voice"], slot = THEME) => {
  writeFileSync(join(root, "made.json"), `${JSON.stringify(value, null, 2)}\n`);
  return runNextSubmitCli([`designer/${slot}`, "--submit", "made.json", "--model", "fixture-llm", "--tier", "high", "--basis", "agent", "--skill", skill, ...ladder], root, undefined, undefined, guard);
};
const candidates = (slot = THEME) => { const dir = join(consumer, "agents", "designer", slot, "candidates"); return existsSync(dir) ? readdirSync(dir).sort() : []; };

describe("submit: refused at the write with the rule id and a one-line fix", () => {
  it("refuses a non-derived theme on R20.1 with its fix and writes nothing; takes the corrected one; the unrelated failing slot never blocks", async () => {
    // The unrelated slot's finding is real: R20.1 reports it on a full run.
    expect(designerTrace(buildContext(root, consumer, { history: () => NO_HISTORY })).map(row => row.slot)).toEqual([OTHER]);
    const refused = await submit(element("primary", "shadcn neutral mapped to the brand value."));
    expect(refused.exitCode, refused.message).toBe(1);
    expect((refused.output as { checks: string[] }).checks, refused.message).toEqual(["R20.1"]);
    expect(refused.message).toMatch(/R20\.1 primary-v1\.json: meta\.element\.reason cites no Director slot/);
    expect(refused.message).toContain(R20_FIX);
    expect(refused.message).not.toContain(OTHER);
    expect(candidates()).toEqual([]);

    const taken = await submit(element("primary", "Realises director:brand.voice: one calm primary."));
    expect(taken.exitCode, taken.message).toBe(0);
    expect(candidates()).toEqual(["primary-v1.json"]);
  });

  it("refuses a theme that cites an unpinned Director slot, naming R20.1 and the fix", async () => {
    const refused = await submit(element("primary", "Realises director:brand.tone."));
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/director:brand\.tone, which is not a pinned Director slot/);
    expect(refused.message).toContain(R20_FIX);
  });

  it("holds a composition to the ref-verbatim gate at the create rung (create.app-section, create.frame): a hand-written primitive is refused", async () => {
    const composed = (kind: string) => ({
      name: "primary", type: "registry:block",
      files: [{ path: "ui/primary.tsx", type: "registry:block", content: 'import { Button } from "@/components/ui/button"\n\nexport function Primary() {\n  return <section><div className="rounded-md border">hand-written</div><Button>Go</Button></section>\n}\n' }],
      meta: { source: { kind, ref: [], license: "MIT", ...(kind === "composition" ? { parts: [{ slot: "ui.button", files: ["registry/aria-nova/ui/button.tsx"] }] } : {}) }, element: { id: "primary", reason: "Realises director:brand.voice: composes ui.button only." } },
    });
    const refused = await submit(composed("composition"), { rules: [], refVerbatim: true, history: () => NO_HISTORY });
    expect(refused.exitCode, refused.message).toBe(1);
    expect(refused.message).toMatch(/REF-COMP-[A-Z]+ .*\[composition: composition lineage\]/);
    expect(refused.message).toMatch(/REF-COMP-MARKUP/);
    expect(candidates()).toEqual([]);
    // The same draft with the gate off is written: the refusal was the composition gate's.
    expect((await submit(composed("composition"), { rules: [], refVerbatim: false })).exitCode).toBe(0);
  });

  it("holds an adopt to the ref-verbatim gate: refused with its fix while no vendored reference backs it", async () => {
    const adopt = ["--rung", "L1", "--seed", "shadcn-aria/button"];
    const button = { name: "button", type: "registry:ui", files: [{ path: "ui/button.tsx", type: "registry:ui", content: "export const Button = 2;\n" }], meta: { source: { kind: "registry", ref: ["shadcn-aria/button@4.23.0"] } } };
    const refused = await submit(button, { rules: [], refVerbatim: true, history: () => NO_HISTORY }, adopt, "ui.button");
    expect(refused.exitCode, refused.message).toBe(1);
    expect((refused.output as { checks: string[] }).checks).toEqual(["ref-verbatim"]);
    expect(refused.message).toMatch(/ref-verbatim REF-[A-Z-]+ .*\[adopt: ladder rung L1\]/);
    expect(refused.message).toContain(`fix: ${REF_VERBATIM_FIX}`);
    expect(candidates("ui.button")).toEqual(["button-v1.json"]);
    // The same submit with the gate off is written: the refusal was the gate's.
    expect((await submit(button, { rules: [], refVerbatim: false }, adopt, "ui.button")).exitCode).toBe(0);
  });
});

describe("check --constitution --slot: the per-slot preflight", () => {
  const check = (...flags: string[]) => runCheck(parseArgs(["check", "--constitution", "--root", root, ...flags]), root);

  it("keeps only the named slot's rows, each with its one-line fix", async () => {
    const failing = await check("--strict", "--slot", `designer/${OTHER}`);
    const rows = (failing.output as { rows: Row[] }).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.agent === "designer" && row.slot === OTHER)).toBe(true);
    expect(rows.map(row => row.check)).toContain("R20.1");
    expect(failing.message).toMatch(/constitution focus: 1 slot\(s\): designer\/themes\.accent/);
    expect(failing.message).toContain(`fix: ${R20_FIX.slice("fix: ".length)}`);
    expect(failing.exitCode).toBe(1);

    const other = await check("--strict", "--slot", "designer/ui.button");
    expect((other.output as { rows: Row[] }).rows.every(row => row.slot === "ui.button")).toBe(true);
    expect((other.output as { rows: Row[] }).rows.map(row => row.check)).not.toContain("R20.1");
  });

  it("refuses a malformed --slot and --slot without --constitution", () => {
    expect(() => parseArgs(["check", "--constitution", "--slot", "themes.accent"])).toThrow(/--slot must be <agent>\/<slot>/);
    expect(() => parseArgs(["check", "--slot", "designer/themes.accent"])).toThrow(/require check --constitution/);
    expect(() => parseArgs(["check", "--constitution", "--record-green", "--slot", "designer/themes.accent"])).toThrow(/full run/);
  });
});

describe("check --constitution --changed <ref>: only the slots a change touched", () => {
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");

  it("focuses the changed and untracked slots and keeps agent-level files as paths", async () => {
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "fixture");
    expect(changedSlots(root, consumer, "HEAD")).toEqual({ focus: [], paths: [], files: [] });
    // An untracked file on one slot, an edited tracked file on another, an agent-level file.
    mkdirSync(join(consumer, "agents", "designer", OTHER, "notes"), { recursive: true });
    writeFileSync(join(consumer, "agents", "designer", OTHER, "notes", "draft.md"), "draft\n");
    writeFileSync(join(consumer, "agents", "writer", "home.hero", "candidates", "hero-v1.md"), "---\nsource:\n  kind: authored\n---\nWelcome back.\n");
    writeFileSync(join(consumer, "agents", "designer", "README.md"), "agent-level note\n");
    const changed = changedSlots(root, consumer, "HEAD");
    expect(changed.focus).toEqual([{ agent: "designer", slot: OTHER }, { agent: "writer", slot: "home.hero" }]);
    expect(changed.paths).toEqual(["clossys/agents/designer/README.md"]);
    expect(changed.files).toEqual(["clossys/agents/designer/README.md", `clossys/agents/designer/${OTHER}/notes/draft.md`, "clossys/agents/writer/home.hero/candidates/hero-v1.md"]);

    const result = await runCheck(parseArgs(["check", "--constitution", "--strict", "--changed", "HEAD", "--root", root]), root);
    const rows = (result.output as { rows: Row[] }).rows;
    expect(rows.every(row => (row.agent === "designer" && row.slot === OTHER) || (row.agent === "writer" && row.slot === "home.hero") || row.path === "clossys/agents/designer/README.md")).toBe(true);
    expect(rows.map(row => `${row.check} ${row.slot}`)).toContain(`R20.1 ${OTHER}`);
    expect(result.message).toMatch(/constitution focus: 2 slot\(s\) changed vs HEAD \(3 file\(s\), 1 agent-level\)/);
    expect(() => changedSlots(root, consumer, "--output=x")).toThrow(/not a git ref/);
  });
});
