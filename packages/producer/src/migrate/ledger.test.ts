import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { editedInPlace } from "../constitution/checks/R08-immutability.js";
import { pinMatchesLedger, upstreamPinned } from "../constitution/checks/R02-pins-order.js";
import { eventsNameSkill, llmNamesModel, recordsMatchLedger } from "../constitution/checks/R14-provenance.js";
import { buildContext } from "../constitution/context.js";
import { cleanSpec, NO_FOUNDRY_LEAVES, sha, validPin, writeWorkspace, type WorkspaceSpec } from "../constitution/__fixtures__/workspace.js";
import { fileState, MIGRATIONS_SCHEMA } from "../records/migrations.js";
import { runMigrateCli } from "../cli/migrate.js";
import { applyLedgerBackfill, commitInfo, planLedgerBackfill, type LedgerPlan } from "./ledger.js";

// U13 r4: pin and migrate run the full guard; at the workstation's shared load the guarded cases exceed 5 s.
vi.setConfig({ testTimeout: 60_000 });

const CLAUDE = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
const BUTTON = "clossys/agents/designer/ui.button";
const BUTTON_V1 = { name: "button", type: "registry:ui", files: [{ path: "ui/button.tsx", type: "registry:ui", content: "export const Button = 1;\n" }] };
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** The clean fixture with no ledger anywhere: the state every pre-ledger workspace is in. */
function ledgerless(): WorkspaceSpec {
  const spec = cleanSpec();
  for (const slots of Object.values(spec)) for (const slot of Object.values(slots ?? {})) slot.ledger = false;
  return spec;
}

/** A git repository over the ledgerless fixture; each commit gets a fixed time (`n` minutes in). */
function repo() {
  const { root, consumer } = writeWorkspace(ledgerless(), { agentLedger: { director: false, designer: false, writer: false, publisher: false, producer: false } });
  let minute = 0;
  const git = (...args: string[]) => {
    const date = `2026-11-01T10:${String(minute).padStart(2, "0")}:00Z`;
    return execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgsign=false", ...args], {
      cwd: root, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    }).toString();
  };
  const commit = (message: string, ...trailers: string[]) => { minute++; git("add", "-A"); git("commit", "-q", "-m", message, ...trailers.flatMap(trailer => ["-m", trailer])); return git("rev-parse", "HEAD").trim(); };
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
  git("init", "-q", "-b", "main");
  const first = commit("add records", CLAUDE);
  return { root, consumer, git, commit, first, write: (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); } };
}

const context = (root: string, consumer: string) => buildContext(root, consumer, { foundryLeaves: NO_FOUNDRY_LEAVES });
const ledgerOf = (root: string, folder: string) => JSON.parse(readFileSync(join(root, folder, "ledger.json"), "utf8")) as { events: Record<string, unknown>[] };
/** The rows of the four enforced checks the backfill serves, plus R14.2 and R14.3 over its events. */
function rows(root: string, consumer: string) {
  const ctx = context(root, consumer);
  return { "R14.1": recordsMatchLedger(ctx), "R08.2": editedInPlace(ctx), "R02.3": pinMatchesLedger(ctx), "R02.2": upstreamPinned(ctx), "R14.2": eventsNameSkill(ctx), "R14.3": llmNamesModel(ctx) };
}
const summary = (found: ReturnType<typeof rows>) => Object.fromEntries(Object.entries(found).map(([check, list]) => [check, list.length]));
const NONE = { "R14.1": 0, "R08.2": 0, "R02.3": 0, "R02.2": 0, "R14.2": 0, "R14.3": 0 };

/** Pin ui.button at a second candidate in a later, unattributed commit. */
function repin(fixture: ReturnType<typeof repo>) {
  const v2 = json({ ...BUTTON_V1, files: [{ ...BUTTON_V1.files[0]!, content: "export const Button = 2;\n" }] });
  fixture.write(`${BUTTON}/candidates/button-v2.json`, v2);
  fixture.write(`${BUTTON}/pin.json`, json({ ...validPin("button-v2.json", v2), at: "2026-11-02T08:00:00Z" }));
  return { v2, commit: fixture.commit("repin button") };
}

describe("clossys migrate ledger", () => {
  it("fails the four checks before the backfill and passes them after (fixture git history)", () => {
    const fixture = repo();
    repin(fixture);
    const before = summary(rows(fixture.root, fixture.consumer));
    for (const check of ["R14.1", "R08.2", "R02.3"]) expect(before[check], check).toBeGreaterThan(0);
    const plan = planLedgerBackfill(fixture.consumer);
    expect(plan.gaps).toEqual([]);
    expect(applyLedgerBackfill(fixture.consumer, plan)).toMatchObject({ written: plan.folders.length, unchanged: 0, kept: 0, refused: [] });
    expect(summary(rows(fixture.root, fixture.consumer))).toEqual(NONE);
  });

  it("writes a genesis submit and one event per pin change, each naming its commit and author kind", () => {
    const fixture = repo();
    const { commit: second } = repin(fixture);
    applyLedgerBackfill(fixture.consumer, planLedgerBackfill(fixture.consumer));
    const events = ledgerOf(fixture.root, BUTTON).events;
    expect(events.map(event => [event.op, event.name ?? event.candidate ?? event.kind])).toEqual([
      ["submit", "button-v1.json"], ["slot", "ia"], ["pin", "button-v1.json"], ["submit", "button-v2.json"], ["pin", "button-v2.json"],
    ]);
    expect(events.map(event => [event.by, (event.backfill as { commit: string }).commit])).toEqual([
      ...Array(3).fill(["history:claude", fixture.first]), ["history:unattributed", second], ["history:unattributed", second],
    ]);
    for (const event of events) expect(event).toMatchObject({ verb: "migrate", model: "none", tier: "none", skill: { path: "packages/producer/actions/migrate/action.json" } });
    // A pin event carries the pin's own time (R02.3); the commit time stays in backfill.at.
    expect(events[4]).toMatchObject({ at: "2026-11-02T08:00:00Z", backfill: { at: "2026-11-01T10:02:00.000Z" } });
    expect(events[0]).toMatchObject({ at: "2026-11-01T10:01:00.000Z", sha256: sha(json(BUTTON_V1)) });
    expect(ledgerOf(fixture.root, "clossys/agents/designer").events).toEqual([expect.objectContaining({ op: "ia", kind: "ia", records: [{ file: "ia.json", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }] })]);
  });

  it("is idempotent: a second run, and a run after the ledgers are committed, change no byte", () => {
    const fixture = repo();
    repin(fixture);
    const plan = planLedgerBackfill(fixture.consumer);
    applyLedgerBackfill(fixture.consumer, plan);
    const bytes = readFileSync(join(fixture.root, BUTTON, "ledger.json"), "utf8");
    expect(applyLedgerBackfill(fixture.consumer, planLedgerBackfill(fixture.consumer))).toMatchObject({ written: 0, unchanged: plan.folders.length });
    fixture.commit("ledgers");
    const again = planLedgerBackfill(fixture.consumer);
    expect(again.folders).toEqual(plan.folders);
    expect(applyLedgerBackfill(fixture.consumer, again)).toMatchObject({ written: 0, unchanged: plan.folders.length });
    expect(readFileSync(join(fixture.root, BUTTON, "ledger.json"), "utf8")).toBe(bytes);
    expect(fixture.git("status", "--porcelain")).toBe("");
  });

  it("never backfills a change made after the ledger: a later hand edit still fails R14.1", () => {
    const fixture = repo();
    applyLedgerBackfill(fixture.consumer, planLedgerBackfill(fixture.consumer));
    fixture.commit("ledgers");
    const pin = JSON.parse(readFileSync(join(fixture.root, BUTTON, "pin.json"), "utf8")) as Record<string, unknown>;
    fixture.write(`${BUTTON}/pin.json`, json({ ...pin, decidedBy: "owner", basis: "picked" }));
    fixture.commit("hand edit");
    expect(applyLedgerBackfill(fixture.consumer, planLedgerBackfill(fixture.consumer))).toMatchObject({ written: 0 });
    expect(summary(rows(fixture.root, fixture.consumer))).toMatchObject({ "R14.1": 1, "R02.3": 1 });
  });

  it("carries a recorded migration (manifest blob pair) as one migrate event; an unrecorded edit stays a gap", () => {
    const fixture = repo();
    const { v2 } = repin(fixture);
    const rewritten = v2.replace("Button = 2", "Button = 3");
    const pinBefore = readFileSync(join(fixture.root, BUTTON, "pin.json"), "utf8");
    const pinAfter = json({ ...JSON.parse(pinBefore) as object, sha256: sha(rewritten) });
    fixture.write(`${BUTTON}/candidates/button-v2.json`, rewritten);
    fixture.write(`${BUTTON}/pin.json`, pinAfter);
    const event = (file: string, from: string, to: string) => ({ type: "migrated", migration: "citations-to-slots", file, from: fileState(from), to: fileState(to), by: "planner", at: "2026-11-03T00:00:00Z" });
    fixture.write("clossys/evidence/migrations.json", json({ schema: MIGRATIONS_SCHEMA, events: [
      event("agents/designer/ui.button/pin.json", pinBefore, pinAfter), event("agents/designer/ui.button/candidates/button-v2.json", v2, rewritten),
    ] }));
    fixture.commit("migrate citations");
    const card = "clossys/agents/designer/ui.card/candidates/card-v1.json";
    fixture.write(card, `${readFileSync(join(fixture.root, card), "utf8")} `);
    fixture.commit("edit in place");
    const plan = planLedgerBackfill(fixture.consumer);
    expect(plan.gaps).toEqual([{ path: card, message: expect.stringMatching(/^edited in [0-9a-f]{9} without a recorded migration: no event$/) }]);
    applyLedgerBackfill(fixture.consumer, plan);
    const migrate = ledgerOf(fixture.root, BUTTON).events.filter(item => item.op === "migrate");
    expect(migrate).toEqual([expect.objectContaining({ migration: "citations-to-slots", files: [{ name: "button-v2.json", from: sha(v2), to: sha(rewritten) }], records: [{ file: "pin.json", sha256: sha(pinAfter) }] })]);
    const after = rows(fixture.root, fixture.consumer);
    // The pinned card no longer matches its pin, so site.home's upstream is broken too (R02.2, current state).
    expect(summary(after)).toEqual({ ...NONE, "R14.1": 1, "R08.2": 1, "R02.2": 1 });
    expect(after["R14.1"].map(row => row.candidate)).toEqual(["card-v1.json"]);
    expect(after["R08.2"].map(row => row.candidate)).toEqual(["card-v1.json"]);
  });

  it("attributes a merge change to the side-line commit that authored it", () => {
    const fixture = repo();
    fixture.git("checkout", "-qb", "side");
    const { commit: side } = repin(fixture);
    fixture.git("checkout", "-q", "main");
    fixture.write("clossys/agents/writer/notes.txt", "main\n");
    fixture.commit("main change");
    fixture.git("-c", "user.name=fixture", "merge", "-q", "--no-ff", "-m", "merge side", "side");
    const merge = fixture.git("rev-parse", "HEAD").trim();
    applyLedgerBackfill(fixture.consumer, planLedgerBackfill(fixture.consumer));
    const pins = ledgerOf(fixture.root, BUTTON).events.filter(event => event.op === "pin");
    expect(pins.at(-1)).toMatchObject({ candidate: "button-v2.json", by: "history:unattributed", backfill: { commit: merge, authoredIn: side } });
    expect(summary(rows(fixture.root, fixture.consumer))).toEqual(NONE);
  });

  it("takes the genesis from the parallel side-line add whose bytes the chain kept", () => {
    const fixture = repo();
    const path = `${BUTTON}/candidates/button-v3.json`;
    const kept = json({ ...BUTTON_V1, files: [{ ...BUTTON_V1.files[0]!, content: "export const Button = 3;\n" }] });
    const dropped = json({ ...BUTTON_V1, files: [{ ...BUTTON_V1.files[0]!, content: "export const Button = 30;\n" }] });
    fixture.git("checkout", "-qb", "keep");
    fixture.write(path, kept);
    const keep = fixture.commit("add v3 (kept)", CLAUDE);
    fixture.git("checkout", "-q", "main");
    fixture.git("checkout", "-qb", "drop");
    fixture.write(path, dropped);
    fixture.commit("add v3 (dropped)");
    fixture.git("checkout", "-q", "main");
    fixture.git("checkout", "-qb", "int");
    fixture.git("merge", "-q", "--no-ff", "-m", "merge keep", "keep");
    fixture.git("merge", "-q", "-s", "ours", "-m", "merge drop, keep ours", "drop");
    fixture.git("checkout", "-q", "main");
    fixture.git("merge", "-q", "--no-ff", "-m", "merge int", "int");
    const merge = fixture.git("rev-parse", "HEAD").trim();
    const plan = planLedgerBackfill(fixture.consumer);
    expect(plan.gaps).toEqual([]);
    applyLedgerBackfill(fixture.consumer, plan);
    const submit = ledgerOf(fixture.root, BUTTON).events.find(event => event.op === "submit" && event.name === "button-v3.json");
    expect(submit).toMatchObject({ sha256: sha(kept), by: "history:claude", backfill: { commit: merge, authoredIn: keep } });
    expect(summary(rows(fixture.root, fixture.consumer))).toEqual(NONE);
  });

  it("a side-line edit before the chain is a gap, and a migrate event only when the manifest records it", () => {
    const fixture = repo();
    const path = `${BUTTON}/candidates/button-v3.json`;
    const added = json({ ...BUTTON_V1, files: [{ ...BUTTON_V1.files[0]!, content: "export const Button = 3;\n" }] });
    const edited = added.replace("Button = 3", "Button = 4");
    fixture.git("checkout", "-qb", "side");
    fixture.write(path, added);
    fixture.commit("add v3");
    fixture.write(path, edited);
    const edit = fixture.commit("edit v3 in place");
    fixture.git("checkout", "-q", "main");
    fixture.git("merge", "-q", "--no-ff", "-m", "merge side", "side");
    const merge = fixture.git("rev-parse", "HEAD").trim();
    const plan = planLedgerBackfill(fixture.consumer);
    expect(plan.gaps).toEqual([{ path, message: `edited in ${edit.slice(0, 9)} before it reached the first-parent chain (${merge.slice(0, 9)}) without a recorded migration: no event` }]);
    applyLedgerBackfill(fixture.consumer, plan);
    const before = rows(fixture.root, fixture.consumer);
    expect(summary(before)).toEqual({ ...NONE, "R14.1": 1, "R08.2": 1 });
    expect(ledgerOf(fixture.root, BUTTON).events.filter(event => event.op === "migrate")).toEqual([]);
    fixture.write("clossys/evidence/migrations.json", json({ schema: MIGRATIONS_SCHEMA, events: [
      { type: "migrated", migration: "citations-to-slots", file: "agents/designer/ui.button/candidates/button-v3.json", from: fileState(added), to: fileState(edited), by: "planner", at: "2026-11-03T00:00:00Z" },
    ] }));
    const explained = planLedgerBackfill(fixture.consumer);
    expect(explained.gaps).toEqual([]);
    applyLedgerBackfill(fixture.consumer, explained);
    const migrate = ledgerOf(fixture.root, BUTTON).events.filter(event => event.op === "migrate");
    expect(migrate).toEqual([expect.objectContaining({ files: [{ name: "button-v3.json", from: sha(added), to: sha(edited) }], backfill: expect.objectContaining({ commit: merge, authoredIn: edit }) })]);
    expect(summary(rows(fixture.root, fixture.consumer))).toEqual(NONE);
  });

  it("records a pin removed by a not-needed decision as not-needed, and a retired candidate's add and retire", () => {
    const fixture = repo();
    const seat = "clossys/agents/producer/seat.director";
    const doc = JSON.parse(readFileSync(join(fixture.root, seat, "slot.json"), "utf8")) as object;
    fixture.write(`${seat}/slot.json`, json({ ...doc, notNeeded: { reason: "not-needed: fixture", since: "2026-11-01", decidedBy: "owner" } }));
    unlinkSync(join(fixture.root, seat, "pin.json"));
    const { v2 } = repin(fixture);
    fixture.write(`${BUTTON}/pin.json`, json(validPin("button-v1.json", json(BUTTON_V1))));
    mkdirSync(join(fixture.root, BUTTON, "retired"), { recursive: true });
    renameSync(join(fixture.root, BUTTON, "candidates/button-v2.json"), join(fixture.root, BUTTON, "retired/button-v2.json"));
    fixture.write(`${BUTTON}/retired/button-v2.json.json`, json({ schema: "clossys.retire/1", slot: "ui.button", candidate: "button-v2.json", sha256: sha(v2), by: "planner", reason: "superseded: fixture", at: "2026-11-02T00:00:00Z" }));
    fixture.commit("not needed and retire");
    const plan = planLedgerBackfill(fixture.consumer);
    expect(plan.gaps).toEqual([]);
    applyLedgerBackfill(fixture.consumer, plan);
    expect(ledgerOf(fixture.root, seat).events.at(-1)).toMatchObject({ op: "not-needed", reason: "not-needed: fixture", decidedBy: "owner", records: [{ file: "slot.json" }, { file: "pin.json", sha256: null }] });
    expect(ledgerOf(fixture.root, BUTTON).events.filter(event => event.name === "button-v2.json").map(event => [event.op, event.sha256, event.code])).toEqual([
      ["submit", sha(v2), undefined], ["retire-candidate", sha(v2), "superseded"],
    ]);
    expect(summary(rows(fixture.root, fixture.consumer))).toEqual(NONE);
  });

  it("keeps a ledger that holds a verb's own event", () => {
    const fixture = repo();
    const own = { schema: "clossys.ledger/1", events: [{ op: "slot", at: "2026-11-01T00:00:00Z", by: "planner", verb: "ia", skill: { path: "packages/producer/actions/ia/skill.md", sha256: null }, model: "none", tier: "none" }] };
    fixture.write(`${BUTTON}/ledger.json`, json(own));
    expect(applyLedgerBackfill(fixture.consumer, planLedgerBackfill(fixture.consumer))).toMatchObject({ kept: 1 });
    expect(readFileSync(join(fixture.root, BUTTON, "ledger.json"), "utf8")).toBe(json(own));
  });

  it("mutation: a backfill without its pin events fails R02.3 (and R14.1)", () => {
    const fixture = repo();
    repin(fixture);
    const plan = planLedgerBackfill(fixture.consumer);
    const mutant: LedgerPlan = { ...plan, folders: plan.folders.map(folder => ({ ...folder, events: folder.events.filter(event => event.op !== "pin" && event.op !== "pick") })) };
    applyLedgerBackfill(fixture.consumer, mutant);
    const found = summary(rows(fixture.root, fixture.consumer));
    expect(found["R02.3"]).toBeGreaterThan(0);
    expect(found["R14.1"]).toBeGreaterThan(0);
  });

  it("reads the author kind from the commit's author and trailers", () => {
    const commit = (author: string, message: string) => `tree x\nauthor ${author} 1762000000 +0100\ncommitter ${author} 1762000000 +0100\n\n${message}`;
    expect(commitInfo(commit("A <a@x>", `fix\n\n${CLAUDE}\n`))).toEqual({ at: "2025-11-01T12:26:40.000Z", by: "history:claude" });
    expect(commitInfo(commit("Codex <codex@openai.com>", "fix\n")).by).toBe("history:codex");
    expect(commitInfo(commit("A <a@x>", "fix\n")).by).toBe("history:unattributed");
  });

  it("runs as clossys migrate ledger: --check exits 1 while ledgers are pending, 0 after", async () => {
    const fixture = repo();
    expect((await runMigrateCli(["ledger", "--check"], fixture.root)).exitCode).toBe(1);
    const run = await runMigrateCli(["ledger"], fixture.root);
    expect(run.exitCode).toBe(0);
    expect(run.message).toMatch(/^migrate ledger: \d+ ledger\(s\) planned/);
    expect((await runMigrateCli(["ledger", "--check"], fixture.root)).exitCode).toBe(0);
  });
});
