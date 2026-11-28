/**
 * CP1-REPORT (foundry-build-0048): tool feedback as a clossys.queue-entry/2 kind report in the consumer's own queue
 * (clossys/agents/producer/queue.report/entries), filed and listed through `clossys request`, closed with a re-run of
 * its recorded check, and named by every installed agent skill: the report rule, the "Your queue" first step, and
 * Producer as the front door for covered work. Runs on a tmp copy of the consumer fixture; nothing outside it is written.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeReport, evidenceOf, fileReport, fileStepReport, listReports, readReport, recheckReports, type CheckRunner, type ReportEntry } from "../records/report.js";
import { REPORT_RULE, reportIssues, reportRoute, reportSignature } from "../records/report-shape.js";
import { runRequestCli } from "./request.js";

// The check runs go through the in-process verb runner; at the workstation's shared load they exceed 5 s.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));
/** The agent skills a consumer install of @clossys/producer places (its first-party cohort, cli/init-skills.ts). */
const INSTALLED = ["producer", "director", "designer", "writer", "publisher", "controller"] as const;
const RULE = "When a clossys verb refuses with no next step, or a step you need has no verb, file `clossys request --kind report` and stop. Never edit files by hand to get around it.";
const AT = "2026-11-26T10:00:00Z";
const LATER = "2026-11-26T15:30:00Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "request-report-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  registry(root);
  return { root, consumer: join(root, "clossys") };
}
/** CP1-LOOP-LEARN: the root's rule registry a fixed close's guard names: R-ENGINE-GUARD has a fixture run, R-PROSE-ONLY none. */
const GUARD = "R-ENGINE-GUARD";
function registry(root: string) {
  mkdirSync(join(root, "scripts", "rules"), { recursive: true });
  writeFileSync(join(root, "scripts", "rules", "registry.json"), JSON.stringify({
    schema: "foundry.rule-registry/1",
    rules: [
      { id: GUARD, status: "enforced", checks: [".#check:engine"], fixture: "scripts/rules/fixtures/R-ENGINE-GUARD", fixture_runs: [{ check: ".#check:engine", cwd: ".", run: "node check.mjs {fixture}", expect: "engine: fail" }] },
      { id: "R-PROSE-ONLY", status: "unenforced", note: "no check yet" },
    ],
  }, null, 2));
}
const skill = (pkg: string) => readFileSync(join(PACKAGES, pkg, "skill", "SKILL.md"), "utf8");
/** A SKILL.md's text after its front matter. */
const body = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n+/, "");
const report = (root: string, ...more: string[]) => runRequestCli(["--kind", "report", "--about", "verb/pin", "--what", "bug", "--why", "pin refused with no next step", ...more, "--at", AT, "--root", root], root);
const stubCheck = (exitCode: number): CheckRunner & { calls: string[][] } => {
  const calls: string[][] = [];
  return Object.assign(async (argv: readonly string[]) => { calls.push([...argv]); return { exitCode, message: exitCode ? "engine.chain: 1 finding" : "engine: ok" }; }, { calls });
};

describe("clossys request --kind report", () => {
  it("a report files into the consumer queue routed upstream", async () => {
    const { root, consumer } = world();
    const filed = await report(root, "--from", "designer/sections.hero");
    expect(filed.exitCode, filed.message).toBe(0);
    const entry = filed.output as ReportEntry;
    expect(filed.message).toContain("route upstream -> producer");
    const onDisk = JSON.parse(readFileSync(join(consumer, "agents", "producer", "queue.report", "entries", `${entry.id}.json`), "utf8")) as ReportEntry;
    expect(onDisk).toMatchObject({ schema: "clossys.queue-entry/2", kind: "report", about: "verb/pin", what: "bug", from: "designer/sections.hero", status: "open", source: "cli", target: "producer/loop.audit" });
    expect(onDisk.route).toEqual({ row: "upstream", table: reportRoute().table, assignee: "producer" });
    expect(reportIssues(onDisk)).toEqual([]);
    expect(onDisk.events.map(event => event.op)).toEqual(["raised", "routed"]);
    // Producer dedupes on about plus what: a second filing returns the open one and writes nothing.
    const again = await report(root, "--from", "writer/sections.article.copy");
    expect(again.message).toContain("already open");
    expect((again.output as ReportEntry).id).toBe(entry.id);
  });

  it("a report is assigned to producer", async () => {
    const { root, consumer } = world();
    const filed = (await report(root)).output as ReportEntry;
    expect(filed.assignee).toBe("producer");
    expect(filed.route.assignee).toBe("producer");
    expect(filed.from).toBe("owner");
    expect(filed.route.table).toMatch(/^[0-9a-f]{64}$/);
    expect(REPORT_RULE).toContain("assignee producer");
    // A report routed to a consumer agent is refused by the store's validator.
    expect(reportIssues({ ...filed, assignee: "designer" }).join("; ")).toMatch(/Producer owns every report/);
    expect(reportIssues({ ...filed, route: { ...filed.route, assignee: "designer" } }).join("; ")).toMatch(/\$\.route/);
    expect(readReport(consumer, filed.id)!.assignee).toBe("producer");
  });

  it("list filters reports", async () => {
    const { root } = world();
    const listed = (kind?: string, open = true) => runRequestCli(["--list", ...(open ? ["--open"] : []), ...(kind ? ["--kind", kind] : []), "--json", "--at", LATER, "--root", root], root);
    const ids = async (kind?: string, open = true) => ((await listed(kind, open)).output as { requests: { id: string; kind: string }[] }).requests.map(entry => `${entry.kind}:${entry.id}`);
    // The fixture already holds open change and slot entries; the filters are read against them.
    const before = await ids();
    expect(before.some(id => id.startsWith("report:"))).toBe(false);
    const filed = (await report(root)).output as ReportEntry;
    const fix = await runRequestCli(["--kind", "fix", "--subject", "designer/sections.hero", "--from", "owner", "--why", "the hero overflows", "--check", "render.overflow", "--findings", "overflows at 320px", "--cause", "no wrap rule", "--at", AT, "--root", root], root);
    expect(fix.exitCode, fix.message).toBe(0);
    const fixId = `fix:${(fix.output as { id: string }).id}`;
    expect(await ids("report")).toEqual([`report:${filed.id}`]);
    expect(await ids("fix")).toEqual([fixId]);
    expect((await ids()).sort()).toEqual([...before, fixId, `report:${filed.id}`].sort());
    // --agent producer lists the reports; a closed report leaves --open.
    const mine = await runRequestCli(["--list", "--open", "--agent", "producer", "--root", root], root);
    expect(mine.message).toContain(filed.id);
    const closed = await runRequestCli([filed.id, "--close", "--outcome", "declined", "--result", "foundry@0.1.0", "--by", "owner", "--at", LATER, "--root", root], root);
    expect(closed.exitCode, closed.message).toBe(0);
    expect(await ids("report")).toEqual([]);
    expect(await ids("report", false)).toEqual([`report:${filed.id}`]);
    await expect(listed("bogus")).rejects.toThrow(/--list --kind must be/);
  });

  it("list reports ageHours", async () => {
    const { root } = world();
    const filed = (await report(root)).output as ReportEntry;
    const fix = (await runRequestCli(["--kind", "fix", "--subject", "designer/sections.hero", "--from", "owner", "--why", "the hero overflows", "--check", "render.overflow", "--findings", "overflows at 320px", "--cause", "no wrap rule", "--at", AT, "--root", root], root)).output as { id: string };
    const listed = await runRequestCli(["--list", "--open", "--json", "--at", LATER, "--root", root], root);
    const entries = (listed.output as { requests: { id: string; kind: string; ageHours: number }[] }).requests;
    // Every open entry carries ageHours; the two filed at AT are 5.5 hours old at LATER.
    for (const entry of entries) expect(typeof entry.ageHours, entry.id).toBe("number");
    const mine = entries.filter(entry => entry.id === filed.id || entry.id === fix.id);
    expect(mine.map(entry => entry.kind).sort()).toEqual(["fix", "report"]);
    for (const entry of mine) expect(entry.ageHours).toBe(5.5);
    const text = await runRequestCli(["--list", "--open", "--kind", "report", "--at", LATER, "--root", root], root);
    expect(text.message).toContain("(5.5h)");
  });

  it("a fixed close re-runs the recorded check", async () => {
    const { root, consumer } = world();
    // In the CLI, --evidence runs the named check now and keeps its failing output. On this fixture copy the engine check
    // fails (its event index names records the fixture does not carry).
    const failing = await runRequestCli(["--kind", "report", "--about", "verb/check", "--what", "bug", "--why", "the engine check fails on a fresh copy", "--evidence", "clossys check --engine", "--at", AT, "--root", root], root);
    expect(failing.exitCode, failing.message).toBe(0);
    const filed = failing.output as ReportEntry;
    expect(filed.evidence).toMatchObject({ check: "clossys check --engine", exitCode: 1 });
    expect(filed.evidence!.output).toMatch(/^engine: fail/);
    // A check that passes now is refused as evidence: a report's check is the failing one.
    await expect(evidenceOf(root, "clossys check --engine", stubCheck(0))).rejects.toThrow(/passes now \(exit 0\)/);
    // While the check still fails, a fixed close re-runs it, records rejected and the report stays open.
    const refused = await runRequestCli([filed.id, "--close", "--outcome", "fixed", "--result", "foundry@0.1.0", "--guard", GUARD, "--by", "producer", "--at", LATER, "--root", root], root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/stays open: its check clossys check --engine still fails/);
    expect(readReport(consumer, filed.id)).toMatchObject({ status: "open" });
    expect(readReport(consumer, filed.id)!.events.at(-1)).toMatchObject({ op: "rejected", by: "producer" });
    // Fixed: the re-run passes, Producer's verified event lands right before the close.
    const passed = stubCheck(0);
    const done = await closeReport(consumer, filed.id, { outcome: "fixed", result: "foundry@0.1.0", by: "producer", at: LATER, guard: GUARD }, passed);
    expect(passed.calls).toEqual([["check", "--engine"]]);
    expect(done).toMatchObject({ status: "closed", outcome: "fixed", result: "foundry@0.1.0", guard: GUARD, notified: { to: "owner", at: LATER } });
    expect(readReport(consumer, filed.id)!.events.slice(-2).map(event => event.op)).toEqual(["verified", "closed"]);
    expect(reportIssues(readReport(consumer, filed.id))).toEqual([]);
    // The recheck (loop.audit's reports step) lists the open reports whose check now passes, and only those; CP1-LOOP-LEARN:
    // it closes none, since a fixed close names its guard rule.
    const passing = fileReport(consumer, { about: "verb/run", what: "gap", why: "no verb", from: "owner", by: "owner", at: AT, source: "cli", evidence: { check: "clossys check --engine", exitCode: 1, output: "" } }).report;
    const unchecked = fileReport(consumer, { about: "verb/pick", what: "ask", why: "more options", from: "owner", by: "owner", at: AT, source: "cli" }).report;
    const ran = stubCheck(0);
    const rechecked = await recheckReports(consumer, LATER, ran);
    expect(rechecked).toEqual({ passing: [passing.id], unchecked: [unchecked.id], open: [], invalid: [] });
    expect(ran.calls).toEqual([["check", "--engine"]]);
    expect(readReport(consumer, passing.id)).toMatchObject({ status: "open" });
    await closeReport(consumer, passing.id, { outcome: "fixed", result: "foundry@0.1.0", by: "producer", at: LATER, guard: GUARD }, stubCheck(0));
    expect(readReport(consumer, passing.id)!.events.slice(-2).map(event => event.op)).toEqual(["verified", "closed"]);
    // A close that never re-ran its check is refused by the store.
    const skipped = { ...readReport(consumer, passing.id)!, events: readReport(consumer, passing.id)!.events.filter(event => event.op !== "verified") };
    expect(reportIssues(skipped).join("; ")).toMatch(/closes right after Producer's verified event/);
    // A merged duplicate names an existing other report.
    await expect(closeReport(consumer, unchecked.id, { outcome: "declined", result: `queue.report#${unchecked.id}`, by: "producer", at: LATER }, stubCheck(0))).rejects.toThrow(/cannot merge into itself/);
    const merged = await closeReport(consumer, unchecked.id, { outcome: "declined", result: `queue.report#${filed.id}`, by: "producer", at: LATER }, stubCheck(0));
    expect(merged).toMatchObject({ status: "closed", outcome: "declined", result: `queue.report#${filed.id}` });
  });
});

describe("CP1-LOOP-LEARN: a fixed problem that comes back fails", () => {
  const signed = (root: string, failure: string, ...more: string[]) =>
    runRequestCli(["--kind", "report", "--about", "verb/pin", "--what", "bug", "--why", "pin refused with no next step", "--signature", failure, ...more, "--root", root], root);
  const FAILURE = "pin: refused /tmp/run-4821/clossys/agents/designer/sections.hero/pin.json sha 3f9a2c1d0e at 2026-11-26T10:00:00Z after 3 tries";

  it("signature strips paths, shas, times and numbers", () => {
    const one = reportSignature(FAILURE);
    expect(one).toBe("pin: refused <path> sha <sha> at <time> after <n> tries");
    // The same cause on another run, machine and time signs the same.
    expect(reportSignature("Pin:  refused C:\\work\\x\\pin.json sha 9b8e7d6c5f4a at 2026-12-01 08:15:59 after 12 tries")).toBe(one);
    expect(reportSignature("loop.slot run 20261126T1000Z-ab12: step 4 failed in 12.5s (exit 2) at 10:04:59")).toBe("loop.slot run <time>-ab<n>: step <n> failed in <n>s (exit <n>) at <time>");
    // A different cause signs differently; text with nothing but variable parts signs nothing.
    expect(reportSignature("pin: the candidate is missing")).not.toBe(one);
    expect(reportSignature("/a/b 12 2026-11-26 deadbeef01")).toBeUndefined();
    expect(reportSignature("")).toBeUndefined();
  });

  it("a report matching a fixed-closed report with the same signature is REPEAT and exits 1", async () => {
    const { root, consumer } = world();
    const first = await signed(root, FAILURE, "--at", AT);
    expect(first.exitCode, first.message).toBe(0);
    const old = first.output as ReportEntry;
    expect(old.evidence).toEqual({ signature: reportSignature(FAILURE) });
    const closed = await runRequestCli([old.id, "--close", "--outcome", "fixed", "--result", "foundry@0.1.0", "--guard", GUARD, "--by", "producer", "--at", LATER, "--root", root], root);
    expect(closed.exitCode, closed.message).toBe(0);
    // The same failure on a later run, other paths, sha, time and count: a REPEAT, filed and linked, and the verb exits 1.
    const again = await signed(root, "pin: refused /home/ci/clossys/agents/designer/sections.hero/pin.json sha 77aa00bb11 at 2026-11-27T09:00:00Z after 5 tries", "--at", "2026-11-27T09:00:00Z");
    expect(again.exitCode, again.message).toBe(1);
    expect(again.message).toContain(`REPEAT`);
    expect(again.message).toContain(`queue.report#${old.id} was closed fixed with guard ${GUARD}`);
    const repeat = again.output as ReportEntry & { repeat: boolean };
    expect(repeat.id).not.toBe(old.id);
    expect(repeat).toMatchObject({ status: "open", repeat: true, repeatOf: { report: old.id, guard: GUARD } });
    const onDisk = readReport(consumer, repeat.id)!;
    expect(onDisk.events.map(event => event.op)).toEqual(["raised", "routed", "repeat"]);
    expect(onDisk.events.at(-1)).toMatchObject({ by: "producer", detail: expect.stringContaining(`queue.report#${old.id}`) });
    expect(reportIssues(onDisk)).toEqual([]);
    // --list --json shows repeat and the linked report and guard; an unrelated report is repeat: false.
    const listed = await runRequestCli(["--list", "--kind", "report", "--json", "--at", LATER, "--root", root], root);
    const rows = (listed.output as { requests: (ReportEntry & { repeat: boolean })[] }).requests;
    expect(rows.find(row => row.id === repeat.id)).toMatchObject({ repeat: true, repeatOf: { report: old.id, guard: GUARD } });
    expect(rows.find(row => row.id === old.id)).toMatchObject({ repeat: false });
    // A second filing while the repeat is open dedupes onto it (nothing new, exit 0).
    const third = await signed(root, FAILURE, "--at", "2026-11-28T09:00:00Z");
    expect(third.exitCode, third.message).toBe(0);
    expect((third.output as ReportEntry).id).toBe(repeat.id);
    // A loop step's failure is signed too: the same step failure after a fixed close is a REPEAT.
    const step = { loop: "loop.slot", step: "pin", cli: "clossys pin designer/sections.hero", why: "pin exited 2 after 3.1s", at: AT };
    const stepped = fileStepReport(root, { ...step, runId: "20261126T1000Z-run1" });
    expect(stepped).toMatchObject({ created: true });
    expect(stepped.repeat).toBeUndefined();
    const stepId = stepped.entry.slice("queue.report#".length);
    await closeReport(consumer, stepId, { outcome: "fixed", result: "foundry@0.1.0", by: "producer", at: LATER, guard: GUARD }, stubCheck(0));
    const back = fileStepReport(root, { ...step, runId: "20261127T0900Z-run2", why: "pin exited 2 after 7.9s", at: "2026-11-27T09:00:00Z" });
    expect(back).toMatchObject({ created: true, repeat: { report: stepId, guard: GUARD } });
    // An unsigned report is never a repeat: today's about-and-what key would flag every new bug of the verb.
    const plain = await report(root);
    const plainId = (plain.output as ReportEntry).id;
    await closeReport(consumer, plainId, { outcome: "fixed", result: "foundry@0.1.0", by: "owner", at: LATER, guard: GUARD }, stubCheck(0));
    const plainAgain = await runRequestCli(["--kind", "report", "--about", "verb/pin", "--what", "bug", "--why", "pin refused with no next step", "--at", "2026-11-27T09:00:00Z", "--root", root], root);
    expect(plainAgain.exitCode, plainAgain.message).toBe(0);
    expect((plainAgain.output as ReportEntry).repeatOf).toBeUndefined();
  });

  it("a different signature on the same topic is a new report, not REPEAT", async () => {
    const { root } = world();
    const first = (await signed(root, FAILURE, "--at", AT)).output as ReportEntry;
    // While the first is open, a different failure of the same verb and what is its own report, not a dedupe onto it.
    const other = await signed(root, "pin: the candidate file is missing", "--at", AT);
    expect(other.exitCode, other.message).toBe(0);
    expect((other.output as ReportEntry).id).not.toBe(first.id);
    await runRequestCli([first.id, "--close", "--outcome", "fixed", "--result", "foundry@0.1.0", "--guard", GUARD, "--by", "producer", "--at", LATER, "--root", root], root);
    // After the first closes fixed, a new failure of the same topic with another signature is a new report, not a REPEAT.
    const fresh = await signed(root, "pin: the slot contract has no kind", "--at", "2026-11-27T09:00:00Z");
    expect(fresh.exitCode, fresh.message).toBe(0);
    expect(fresh.message).not.toContain("REPEAT");
    const entry = fresh.output as ReportEntry;
    expect(entry.repeatOf).toBeUndefined();
    expect(entry.events.map(event => event.op)).toEqual(["raised", "routed"]);
  });

  it("fixed close without a guard is refused", async () => {
    const { root, consumer } = world();
    // With no recorded check, and with one: both need --guard.
    const plain = (await report(root)).output as ReportEntry;
    const checked = fileReport(consumer, { about: "verb/run", what: "gap", why: "no verb", from: "owner", by: "owner", at: AT, source: "cli", evidence: { check: "clossys check --engine", exitCode: 1, output: "engine: fail" } }).report;
    for (const id of [plain.id, checked.id]) {
      const refused = await runRequestCli([id, "--close", "--outcome", "fixed", "--result", "foundry@0.1.0", "--by", "owner", "--at", LATER, "--root", root], root);
      expect(refused.exitCode).toBe(1);
      expect(refused.message).toMatch(/a fixed close names its guard: --guard R-<id>/);
      expect(readReport(consumer, id)).toMatchObject({ status: "open" });
      const ran = stubCheck(0);
      await expect(closeReport(consumer, id, { outcome: "fixed", result: "foundry@0.1.0", by: "producer", at: LATER }, ran)).rejects.toThrow(/a fixed close names its guard/);
      expect(ran.calls).toEqual([]);
    }
    // The recheck never closes one fixed either: it lists the passing report and leaves it open.
    expect(await recheckReports(consumer, LATER, stubCheck(0))).toMatchObject({ passing: [checked.id] });
    expect(readReport(consumer, checked.id)).toMatchObject({ status: "open" });
    // A guard goes with fixed only.
    await expect(closeReport(consumer, plain.id, { outcome: "declined", result: "foundry@0.1.0", by: "owner", at: LATER, guard: GUARD }, stubCheck(0))).rejects.toThrow(/--guard goes with --outcome fixed/);
  });

  it("fixed close with an unknown or fixture-less guard is refused", async () => {
    const { root, consumer } = world();
    const filed = (await report(root)).output as ReportEntry;
    const close = (guard: string) => runRequestCli([filed.id, "--close", "--outcome", "fixed", "--result", "foundry@0.1.0", "--guard", guard, "--by", "owner", "--at", LATER, "--root", root], root);
    const unknown = await close("R-NOT-THERE");
    expect(unknown.exitCode).toBe(1);
    expect(unknown.message).toContain("--guard R-NOT-THERE: scripts/rules/registry.json has no rule R-NOT-THERE");
    const bare = await close("R-PROSE-ONLY");
    expect(bare.exitCode).toBe(1);
    expect(bare.message).toContain("--guard R-PROSE-ONLY: rule R-PROSE-ONLY in scripts/rules/registry.json has no fixture_runs entry");
    const shape = await close("engine-guard");
    expect(shape.exitCode).toBe(1);
    expect(shape.message).toContain("--guard must be a rule id R-<NAME>");
    expect(readReport(consumer, filed.id)).toMatchObject({ status: "open" });
    // With no registry in the root, no guard can be named.
    rmSync(join(root, "scripts"), { recursive: true });
    const none = await close(GUARD);
    expect(none.exitCode).toBe(1);
    expect(none.message).toContain(`--guard ${GUARD}: there is no scripts/rules/registry.json in this root`);
    registry(root);
    const ok = await close(GUARD);
    expect(ok.exitCode, ok.message).toBe(0);
    expect(readReport(consumer, filed.id)).toMatchObject({ status: "closed", outcome: "fixed", guard: GUARD });
    expect(readReport(consumer, filed.id)!.events.at(-1)!.detail).toContain(`guard ${GUARD}`);
  });

  it("producer decline is refused unless it names a duplicate", async () => {
    const { root, consumer } = world();
    const kept = (await report(root)).output as ReportEntry;
    const dup = fileReport(consumer, { about: "verb/run", what: "gap", why: "no verb", from: "owner", by: "owner", at: AT, source: "cli" }).report;
    const refused = await runRequestCli([dup.id, "--close", "--outcome", "declined", "--result", "foundry@0.1.0", "--by", "producer", "--at", LATER, "--root", root], root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/Producer declines a report only as a duplicate: --result queue\.report#<the report it duplicates>/);
    expect(readReport(consumer, dup.id)).toMatchObject({ status: "open" });
    const merged = await runRequestCli([dup.id, "--close", "--outcome", "declined", "--result", `queue.report#${kept.id}`, "--by", "producer", "--at", LATER, "--root", root], root);
    expect(merged.exitCode, merged.message).toBe(0);
    expect(readReport(consumer, dup.id)).toMatchObject({ status: "closed", outcome: "declined", result: `queue.report#${kept.id}` });
    // The owner still declines outright.
    const owner = await runRequestCli([kept.id, "--close", "--outcome", "declined", "--result", "foundry@0.1.0", "--by", "owner", "--at", LATER, "--root", root], root);
    expect(owner.exitCode, owner.message).toBe(0);
  });

  it("reports file, list and close in a root with no content slots", async () => {
    // A bare root: clossys/clossys.config.ts and the rule registry, no agents, slots or content records.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "request-report-bare-")));
    roots.push(root);
    mkdirSync(join(root, "clossys"), { recursive: true });
    writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
    registry(root);
    const consumer = join(root, "clossys");
    const filed = await signed(root, FAILURE, "--at", AT);
    expect(filed.exitCode, filed.message).toBe(0);
    const id = (filed.output as ReportEntry).id;
    const listed = await runRequestCli(["--list", "--kind", "report", "--open", "--json", "--at", LATER, "--root", root], root);
    expect(listed.exitCode, listed.message).toBe(0);
    expect((listed.output as { requests: { id: string; repeat: boolean }[] }).requests).toEqual([expect.objectContaining({ id, repeat: false })]);
    const closed = await runRequestCli([id, "--close", "--outcome", "fixed", "--result", "foundry@0.1.0", "--guard", GUARD, "--by", "producer", "--at", LATER, "--root", root], root);
    expect(closed.exitCode, closed.message).toBe(0);
    const again = await signed(root, FAILURE, "--at", "2026-11-27T09:00:00Z");
    expect(again.exitCode, again.message).toBe(1);
    expect(listReports(consumer).map(read => read.issues)).toEqual([[], []]);
  });
});

describe("the installed agent skills", () => {
  it("installed skills carry the report rule", () => {
    for (const pkg of INSTALLED) expect(skill(pkg), `${pkg}/skill/SKILL.md`).toContain(RULE);
  });

  it("every installed skill starts with its own queue", () => {
    for (const pkg of INSTALLED) {
      const text = body(skill(pkg));
      const first = text.indexOf("\n## ");
      expect(text.slice(first + 1).split("\n")[0], `${pkg}: the first section`).toBe("## Your queue");
      const section = text.slice(first + 1, text.indexOf("\n## ", first + 1));
      expect(section, pkg).toContain(`clossys request --list --open --agent ${pkg}`);
      expect(section, pkg).toMatch(/oldest open entries before new work/);
      expect(section, pkg).toMatch(/in one line/);
      expect(section, pkg).toContain("Never leave an entry silent.");
    }
  });

  it("the producer skill names itself the front door for covered work and routes each ask", () => {
    const text = body(skill("producer"));
    const flat = text.replace(/\s+/g, " ");
    expect(text.split("\n")[0]).toBe("When the owner invokes Clossys, you are the one agent they talk to for it.");
    for (const route of ["strategy to Director", "components to Designer", "copy to Writer", "pages to Publisher", "rules to Controller"]) expect(flat).toContain(route);
    expect(text).toMatch(/own fresh context, loaded with only that agent's skill, where the host\s+supports subagents\. Otherwise run the round inline, one agent at a time\./);
    expect(text).toMatch(/asking agent named/);
    expect(text).toContain("`clossys answer ");
    expect(text).toContain("## Upstream feedback");
    expect(text).toContain("log this as feedback");
    expect(text).toContain("clossys request --list --kind report --open --json");
    expect(text).toContain("--close --outcome declined --result queue.report#<id>");
    expect(text).toContain("clossys request --kind report --recheck");
    for (const pkg of INSTALLED.filter(pkg => pkg !== "producer")) {
      expect(skill(pkg), pkg).toContain("You are normally started by Producer");
      expect(skill(pkg), pkg).toContain(`a direct \`@clossys-${pkg}\` call still works`);
    }
  });
});
