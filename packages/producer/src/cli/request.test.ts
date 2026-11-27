/**
 * CP1-REPORT (foundry-build-0048): tool feedback as a clossys.queue-entry/2 kind report in the consumer's own queue
 * (clossys/agents/producer/queue.report/entries), filed and listed through `clossys request`, closed with a re-run of
 * its recorded check, and named by every installed agent skill: the report rule, the "Your queue" first step, and
 * Producer as the front door for covered work. Runs on a tmp copy of the consumer fixture; nothing outside it is written.
 */
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeReport, evidenceOf, fileReport, readReport, recheckReports, type CheckRunner, type ReportEntry } from "../records/report.js";
import { REPORT_RULE, reportIssues, reportRoute } from "../records/report-shape.js";
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
  return { root, consumer: join(root, "clossys") };
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
    const refused = await runRequestCli([filed.id, "--close", "--outcome", "fixed", "--result", "foundry@0.1.0", "--by", "producer", "--at", LATER, "--root", root], root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/stays open: its check clossys check --engine still fails/);
    expect(readReport(consumer, filed.id)).toMatchObject({ status: "open" });
    expect(readReport(consumer, filed.id)!.events.at(-1)).toMatchObject({ op: "rejected", by: "producer" });
    // Fixed: the re-run passes, Producer's verified event lands right before the close.
    const passed = stubCheck(0);
    const done = await closeReport(consumer, filed.id, { outcome: "fixed", result: "foundry@0.1.0", by: "producer", at: LATER }, passed);
    expect(passed.calls).toEqual([["check", "--engine"]]);
    expect(done).toMatchObject({ status: "closed", outcome: "fixed", result: "foundry@0.1.0", notified: { to: "owner", at: LATER } });
    expect(readReport(consumer, filed.id)!.events.slice(-2).map(event => event.op)).toEqual(["verified", "closed"]);
    expect(reportIssues(readReport(consumer, filed.id))).toEqual([]);
    // The recheck (loop.audit's reports step) closes the open reports whose check now passes, and only those.
    const passing = fileReport(consumer, { about: "verb/run", what: "gap", why: "no verb", from: "owner", by: "owner", at: AT, source: "cli", evidence: { check: "clossys check --engine", exitCode: 1, output: "" } }).report;
    const unchecked = fileReport(consumer, { about: "verb/pick", what: "ask", why: "more options", from: "owner", by: "owner", at: AT, source: "cli" }).report;
    const ran = stubCheck(0);
    const rechecked = await recheckReports(consumer, LATER, ran);
    expect(rechecked).toMatchObject({ closed: [passing.id], unchecked: [unchecked.id], open: [], invalid: [] });
    expect(ran.calls).toEqual([["check", "--engine"]]);
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
