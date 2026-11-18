import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runAdvisor, workspaceRoot } from "./cli.js";
import { runDoctor } from "./doctor.js";
import { doctorProbeIssues, intakePlanIssues, isSecretPath } from "./guard.js";
import type { CommandResult, Host } from "./host.js";
import { runInit } from "./init.js";
import { INSTALL_RECORD, runInstall, runUpdate } from "./install.js";
import { INTAKE_RECORD, readIntakeRecord, runIntake } from "./intake.js";
import { loadProducerFacts, producerDir, type ProducerFacts } from "./producer.js";
import { RELATIONS_RECORD, runRelations } from "./relations.js";
import { directorCells, loadConformFiles, loadLoops, loadTree, PACKAGE_ROOT, runRound, type AdvisorTree, type ConformFiles, type LoopDoc } from "./tree.js";

const DIRECTOR_ROOT = join(PACKAGE_ROOT, "..", "director");
const HEAD_A = "a".repeat(40); const TREE_A = "b".repeat(40);
const HEAD_B = "c".repeat(40); const TREE_B = "d".repeat(40);
const scratch: string[] = [];
function temp(): string { const dir = mkdtempSync(join(tmpdir(), "advisor-front-door-")); scratch.push(dir); return dir; }
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

interface Call { command: string; args: string[]; cwd: string }
/** Records every command. npm install lays down a fake clossys bin and the real Director tree; clossys evidence writes the file it would. */
function fakeHost(answers: Partial<Record<string, CommandResult>> = {}): Host & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    today: () => "2026-11-17",
    now: () => "2026-11-17T00:00:00Z",
    run(command, args, { cwd }) {
      calls.push({ command, args: [...args], cwd });
      const line = [command.endsWith("/clossys") ? "clossys" : command, ...args.slice(0, 2)].join(" ");
      const canned = answers[line] ?? answers[command];
      if (canned) return canned;
      if (command === "npm" && args[0] === "install") {
        mkdirSync(join(cwd, "node_modules", ".bin"), { recursive: true });
        writeFileSync(join(cwd, "node_modules", ".bin", "clossys"), "#!/bin/sh\n");
        const director = join(cwd, "node_modules", "@clossys", "director", "src", "catalog", "ia");
        mkdirSync(director, { recursive: true });
        writeFileSync(join(director, "strategy.json"), readFileSync(join(DIRECTOR_ROOT, "src", "catalog", "ia", "strategy.json")));
        return { status: 0, stdout: "added 6 packages", stderr: "" };
      }
      if (command.endsWith("/clossys") && args[0] === "evidence") {
        const root = args[args.indexOf("--root") + 1]!;
        const file = join(root, "clossys", "evidence", "director", `${args[1]}.md`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `---\nid: ${args[1]}\n---\n${readFileSync(args[args.indexOf("--body") + 1]!, "utf8")}`);
        return { status: 0, stdout: `evidence: wrote ${args[1]}`, stderr: "" };
      }
      if (command.endsWith("/clossys")) return { status: 0, stdout: `${args[0]}: done`, stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    },
  };
}

const ROLES = ["controller", "director", "designer", "writer", "publisher", "producer", "advisor"];
interface PackOptions { dirty?: boolean; drop?: string; corrupt?: string; tag?: string; complete?: unknown; noSource?: boolean; versions?: Record<string, string> }
function makePack(head = HEAD_A, tree = TREE_A, options: PackOptions = {}): string {
  const dir = temp();
  const artifacts = ROLES.filter(role => role !== options.drop).map(role => {
    const version = options.versions?.[role] ?? `${options.tag ?? "1"}.0.0`;
    const filename = `clossys-${role}-${version}.tgz`;
    const bytes = Buffer.from(`${role}-${head}`);
    writeFileSync(join(dir, filename), bytes);
    const sha256 = createHash("sha256").update(options.corrupt === role ? Buffer.from("other") : bytes).digest("hex");
    return { role, name: `@clossys/${role}`, version, filename, sha256 };
  });
  const source = options.noSource ? {} : { source: { head, tree, dirty: options.dirty ?? false } };
  writeFileSync(join(dir, "artifacts.json"), JSON.stringify({ schemaVersion: 1, head, tree, ...source, complete: "complete" in options ? options.complete : true, artifacts }));
  return dir;
}
function installed(): { root: string; host: ReturnType<typeof fakeHost> } {
  const root = temp(); const host = fakeHost();
  expect(runInstall(root, makePack(), host).exitCode).toBe(0);
  host.calls.length = 0;
  return { root, host };
}

describe("advisor doctor", () => {
  const tree = loadTree();
  it("passes on Node 20+, npm, Git and a repository, running only the four read-only probes", () => {
    const host = fakeHost({ node: { status: 0, stdout: "v22.4.0\n", stderr: "" } });
    const result = runDoctor(tree, "/work", host);
    expect(result.exitCode).toBe(0);
    expect(host.calls.map(call => [call.command, ...call.args].join(" "))).toEqual(["node --version", "npm --version", "git --version", "git rev-parse --show-toplevel"]);
  });
  it("names Node as the next thing to fix when it is older than 20", () => {
    const result = runDoctor(tree, "/work", fakeHost({ node: { status: 0, stdout: "v18.19.0", stderr: "" } }));
    expect(result.exitCode).toBe(1);
    expect(result.lines.at(-1)).toBe("next to fix: Node.js 20 or newer");
  });
  it("fails outside a Git repository", () => {
    const result = runDoctor(tree, "/work", fakeHost({ node: { status: 0, stdout: "v22.0.0", stderr: "" }, "git rev-parse --show-toplevel": { status: 128, stdout: "", stderr: "not a git repository" } }));
    expect(result.exitCode).toBe(1);
    expect(result.lines.at(-1)).toBe("next to fix: Inside a Git repository");
  });
  it("refuses a probe that would read a file, before running anything (guard)", () => {
    const tampered = clone(tree) as AdvisorTree & { slots: Record<string, { probe?: unknown }> };
    tampered.slots["machine.tools.node"]!.probe = { command: "cat", args: [".env"] };
    const host = fakeHost();
    const result = runDoctor(tampered, "/work", host);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("doctor runs only");
    expect(host.calls).toEqual([]);
  });
});

describe("advisor install", () => {
  it("vendors verified tarballs, runs one npm install and records the foundry commit", () => {
    const root = temp(); const host = fakeHost();
    const result = runInstall(root, makePack(), host);
    expect(result.exitCode).toBe(0);
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]!.args.slice(0, 4)).toEqual(["install", "--save-exact", "--no-audit", "--no-fund"]);
    expect(host.calls[0]!.args.slice(4).every(arg => arg.startsWith("./vendor/clossys/") && arg.endsWith(".tgz"))).toBe(true);
    const record = JSON.parse(readFileSync(join(root, INSTALL_RECORD), "utf8"));
    expect(record.foundry).toEqual({ head: HEAD_A, tree: TREE_A });
    expect(record.packages.map((entry: { role: string }) => entry.role).sort()).toEqual([...ROLES].sort());
  });
  it("refuses a tarball whose SHA-256 differs from the manifest, before npm runs (guard)", () => {
    const root = temp(); const host = fakeHost();
    const result = runInstall(root, makePack(HEAD_A, TREE_A, { corrupt: "director" }), host);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("SHA-256 does not match");
    expect(host.calls).toEqual([]);
    expect(existsSync(join(root, "vendor"))).toBe(false);
  });
  it("refuses a dirty pack, a pack without artifacts.json and a pack missing an MVP agent or Advisor", () => {
    const host = fakeHost();
    expect(runInstall(temp(), makePack(HEAD_A, TREE_A, { dirty: true }), host).lines.join("\n")).toContain("dirty checkout");
    expect(runInstall(temp(), temp(), host).lines.join("\n")).toContain("artifacts.json not found");
    expect(runInstall(temp(), makePack(HEAD_A, TREE_A, { drop: "writer" }), host).lines.join("\n")).toContain("writer exactly once");
    expect(runInstall(temp(), makePack(HEAD_A, TREE_A, { drop: "advisor" }), host).lines.join("\n")).toContain("advisor exactly once");
    expect(host.calls).toEqual([]);
  });
  it("refuses an incomplete pack, before npm runs (guard)", () => {
    for (const complete of [false, undefined, "yes"]) {
      const root = temp(); const host = fakeHost();
      const result = runInstall(root, makePack(HEAD_A, TREE_A, { complete }), host);
      expect(result.exitCode).toBe(1);
      expect(result.lines.join("\n")).toContain("not a complete pack");
      expect(host.calls).toEqual([]);
      expect(existsSync(join(root, INSTALL_RECORD))).toBe(false);
    }
  });
  it("refuses a pack that names no source checkout, so the dirty check cannot fail open (guard)", () => {
    const root = temp(); const host = fakeHost();
    const result = runInstall(root, makePack(HEAD_A, TREE_A, { noSource: true }), host);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("names no source checkout");
    expect(host.calls).toEqual([]);
    const { root: done, host: again } = installed();
    expect(runUpdate(done, makePack(HEAD_B, TREE_B, { tag: "2", noSource: true }), again).lines.join("\n")).toContain("names no source checkout");
    expect(again.calls).toEqual([]);
  });
  it("refuses a second install and points to update", () => {
    const { root, host } = installed();
    const result = runInstall(root, makePack(), host);
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toContain("advisor update");
  });
  it("needs --from", () => { expect(runInstall(temp(), undefined, fakeHost()).exitCode).toBe(2); });
});

describe("advisor update", () => {
  it("refuses without an install record", () => { expect(runUpdate(temp(), makePack(), fakeHost()).exitCode).toBe(1); });
  it("changes nothing for the same head and tree", () => {
    const { root, host } = installed();
    const before = readFileSync(join(root, INSTALL_RECORD), "utf8");
    const result = runUpdate(root, makePack(), host);
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toContain("nothing changed");
    expect(host.calls).toEqual([]);
    expect(readFileSync(join(root, INSTALL_RECORD), "utf8")).toBe(before);
  });
  it("installs a newer pack, keeps the previous commit and reports stale tarballs without deleting them", () => {
    const { root, host } = installed();
    const result = runUpdate(root, makePack(HEAD_B, TREE_B, { tag: "2" }), host);
    expect(result.exitCode).toBe(0);
    const record = JSON.parse(readFileSync(join(root, INSTALL_RECORD), "utf8"));
    expect(record.foundry.head).toBe(HEAD_B);
    expect(record.previous).toMatchObject({ head: HEAD_A, tree: TREE_A });
    expect(result.lines.filter(line => line.startsWith("stale (kept, not deleted)"))).toHaveLength(7);
    expect(readdirSync(join(root, "vendor", "clossys"))).toHaveLength(14);
    expect(record.packages.find((entry: { role: string }) => entry.role === "advisor")).toMatchObject({ name: "@clossys/advisor", version: "2.0.0" });
  });
  it("refuses a pack that moves any package to a lower version, before npm runs (guard)", () => {
    const { root, host } = installed();
    const before = readFileSync(join(root, INSTALL_RECORD), "utf8");
    const result = runUpdate(root, makePack(HEAD_B, TREE_B, { tag: "2", versions: { writer: "0.9.0" } }), host);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("@clossys/writer 1.0.0 -> 0.9.0 is a downgrade");
    expect(host.calls).toEqual([]);
    expect(readFileSync(join(root, INSTALL_RECORD), "utf8")).toBe(before);
    expect(runUpdate(root, makePack(HEAD_B, TREE_B, { versions: { advisor: "1.0.0-rc.1" } }), host).lines.join("\n")).toContain("is a downgrade");
  });
});

describe("advisor init", () => {
  it("refuses before install and runs nothing", () => {
    const host = fakeHost();
    expect(runInit(temp(), host).exitCode).toBe(1);
    expect(host.calls).toEqual([]);
  });
  it("calls clossys config --init when the config is missing, then clossys init", () => {
    const { root, host } = installed();
    expect(runInit(root, host).exitCode).toBe(0);
    expect(host.calls.map(call => call.args.slice(0, 2))).toEqual([["config", "--init"], ["init", "--root"]]);
    expect(host.calls.every(call => call.command === join(root, "node_modules", ".bin", "clossys"))).toBe(true);
  });
  it("leaves an existing config to Producer and only runs clossys init", () => {
    const { root, host } = installed();
    mkdirSync(join(root, "clossys"), { recursive: true });
    writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
    expect(runInit(root, host).exitCode).toBe(0);
    expect(host.calls.map(call => call.args[0])).toEqual(["init"]);
  });
  it("reports a failing clossys init", () => {
    const { root } = installed();
    const host = fakeHost({ "clossys init --root": { status: 2, stdout: "", stderr: "no workspace" } });
    const result = runInit(root, host);
    expect(result.exitCode).toBe(1);
    expect(result.lines.at(-1)).toContain("no workspace");
  });
});

describe("advisor intake", () => {
  const tree = loadTree();
  function answersFile(answers: Record<string, unknown>): string {
    const file = join(temp(), "answers.json");
    writeFileSync(file, JSON.stringify({ schema: "clossys.advisor-intake-answers/1", answers }));
    return file;
  }
  const ALL = { "intake.business.offer": "Bookkeeping for small cafes", "intake.business.audience": "Cafe owners", "intake.business.name": "Ledger & Bean", "intake.limits.constraint": "One person, evenings only", "intake.limits.horizon": "Six months" };
  const evidenceCalls = (host: ReturnType<typeof fakeHost>) => host.calls.filter(call => call.args[0] === "evidence").map(call => call.args[1]);
  it("records each answer through clossys evidence only and writes its own record; skipped questions leave it partial", () => {
    const { root, host } = installed();
    const answers = answersFile({ "intake.business.offer": "Bookkeeping for small cafes", "intake.business.name": "Ledger & Bean", "intake.limits.constraint": "One person, evenings only" });
    const result = runIntake(tree, root, { answers }, host);
    expect(result.exitCode).toBe(0);
    expect(host.calls.map(call => call.args[0])).toEqual(["evidence", "evidence", "evidence"]);
    for (const call of host.calls) {
      expect(call.args[call.args.indexOf("--source") + 1]).toBe("user");
      expect(call.args[call.args.indexOf("--observed") + 1]).toBe("2026-11-17");
      expect(call.args).not.toContain("--finding");
    }
    const offer = readFileSync(join(root, "clossys", "evidence", "director", "owner-intake-offer-2026-11-17.md"), "utf8");
    expect(offer).toContain('- Words: "Bookkeeping for small cafes"');
    expect(offer).toContain("- Informs: focus.offer.included");
    const record = JSON.parse(readFileSync(join(root, INTAKE_RECORD), "utf8"));
    expect(record.status).toBe("partial");
    expect(record.skipped).toEqual(["intake.business.audience", "intake.limits.horizon"]);
    expect(result.lines.filter(line => line.startsWith("skipped "))).toHaveLength(2);
    expect(existsSync(join(root, "clossys", "agents"))).toBe(false);
  });
  it("tries every answer when one fails, and reports each as recorded, skipped or failed", () => {
    const { root } = installed();
    const host = fakeHost({ "clossys evidence owner-intake-name-2026-11-17": { status: 1, stdout: "", stderr: "evidence: disk full" } });
    const result = runIntake(tree, root, { answers: answersFile({ ...ALL, "intake.limits.horizon": undefined }) }, host);
    expect(result.exitCode).toBe(1);
    expect(evidenceCalls(host)).toEqual(["owner-intake-offer-2026-11-17", "owner-intake-audience-2026-11-17", "owner-intake-name-2026-11-17", "owner-intake-constraint-2026-11-17"]);
    const text = result.lines.join("\n");
    expect(text).toContain("recorded clossys/evidence/director/owner-intake-constraint-2026-11-17.md");
    expect(text).toContain("failed intake.business.name: evidence: disk full");
    expect(text).toContain("skipped intake.limits.horizon");
    const record = readIntakeRecord(root);
    expect(record).toMatchObject({ status: "partial", skipped: ["intake.limits.horizon"], failed: [{ question: "intake.business.name" }] });
    expect((record as unknown as { recorded: { question: string }[] }).recorded.map(entry => entry.question)).toEqual(["intake.business.offer", "intake.business.audience", "intake.limits.constraint"]);
  });
  it("resumes a partial intake: only the missing and failed answers run, and recorded answers are never recorded twice", () => {
    const { root } = installed();
    const first = fakeHost({ "clossys evidence owner-intake-name-2026-11-17": { status: 1, stdout: "", stderr: "transient" } });
    expect(runIntake(tree, root, { answers: answersFile({ ...ALL, "intake.limits.horizon": undefined }) }, first).exitCode).toBe(1);
    const second = fakeHost();
    const result = runIntake(tree, root, { answers: answersFile({ ...ALL, "intake.business.offer": "A different offer" }), observed: "2026-11-18" }, second);
    expect(result.exitCode).toBe(0);
    expect(evidenceCalls(second)).toEqual(["owner-intake-name-2026-11-18", "owner-intake-horizon-2026-11-18"]);
    expect(result.lines.join("\n")).toContain("kept clossys/evidence/director/owner-intake-offer-2026-11-17.md (already recorded; the new answer was not recorded)");
    expect(readFileSync(join(root, "clossys", "evidence", "director", "owner-intake-offer-2026-11-17.md"), "utf8")).toContain("Bookkeeping for small cafes");
    const record = readIntakeRecord(root) as unknown as { status: string; recorded: { question: string }[] };
    expect(record.status).toBe("complete");
    expect(record.recorded.map(entry => entry.question).sort()).toEqual(Object.keys(ALL).sort());
  });
  it("a pre-existing evidence file fails only that answer, never overwritten; the rest are recorded and a later date resumes it", () => {
    const { root, host } = installed();
    const existing = join(root, "clossys", "evidence", "director", "owner-intake-name-2026-11-17.md");
    mkdirSync(dirname(existing), { recursive: true });
    writeFileSync(existing, "earlier evidence\n");
    const result = runIntake(tree, root, { answers: answersFile(ALL), observed: "2026-11-17" }, host);
    expect(result.exitCode).toBe(1);
    expect(evidenceCalls(host)).toEqual(["owner-intake-offer-2026-11-17", "owner-intake-audience-2026-11-17", "owner-intake-constraint-2026-11-17", "owner-intake-horizon-2026-11-17"]);
    expect(result.lines.join("\n")).toContain("failed intake.business.name: clossys/evidence/director/owner-intake-name-2026-11-17.md already exists; not overwritten");
    expect(readFileSync(existing, "utf8")).toBe("earlier evidence\n");
    expect(readIntakeRecord(root)).toMatchObject({ status: "partial" });
    const sameDay = fakeHost();
    expect(runIntake(tree, root, { answers: answersFile(ALL), observed: "2026-11-17" }, sameDay).exitCode).toBe(1);
    expect(evidenceCalls(sameDay)).toEqual([]);
    const nextDay = fakeHost();
    expect(runIntake(tree, root, { answers: answersFile(ALL), observed: "2026-11-18" }, nextDay).exitCode).toBe(0);
    expect(evidenceCalls(nextDay)).toEqual(["owner-intake-name-2026-11-18"]);
    expect(readIntakeRecord(root)).toMatchObject({ status: "complete" });
  });
  it("runs once when complete; a second intake runs nothing and points to Director", () => {
    const { root, host } = installed();
    expect(runIntake(tree, root, { answers: answersFile(ALL) }, host).exitCode).toBe(0);
    host.calls.length = 0;
    const again = runIntake(tree, root, { answers: answersFile({ "intake.business.name": "Other" }), observed: "2026-11-20" }, host);
    expect(again.exitCode).toBe(1);
    expect(again.lines[0]).toContain("intake runs once");
    expect(again.lines[0]).toContain("@clossys-director");
    expect(host.calls).toEqual([]);
  });
  it("refuses an unreadable intake record, leaving it as it is", () => {
    const { root, host } = installed();
    mkdirSync(join(root, "clossys", "advisor"), { recursive: true });
    writeFileSync(join(root, INTAKE_RECORD), "{\"status\":\"complete\"}");
    expect(runIntake(tree, root, { answers: answersFile(ALL) }, host).lines[0]).toContain("is not a clossys.advisor-intake/1 record");
    expect(host.calls).toEqual([]);
  });
  it("refuses an unknown question or multi-line words, running nothing", () => {
    const { root, host } = installed();
    expect(runIntake(tree, root, { answers: answersFile({ "focus.offer.included": "x" }) }, host).lines.join("\n")).toContain("unknown question");
    expect(runIntake(tree, root, { answers: answersFile({ "intake.business.name": "a\nb" }) }, host).lines.join("\n")).toContain("one line");
    expect(host.calls).toEqual([]);
  });
  it("refuses an intake that would write a Director slot directly, before anything runs (guard)", () => {
    const { root, host } = installed();
    const tampered = clone(tree) as AdvisorTree & { slots: Record<string, { contract: { record: string } }> };
    tampered.slots["intake.business.offer"]!.contract.record = "clossys/agents/director/focus.offer.included/slot.json";
    const result = runIntake(tampered, root, { answers: answersFile({ "intake.business.offer": "Bookkeeping" }) }, host);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("intake never writes Director slots");
    expect(host.calls).toEqual([]);
    expect(existsSync(join(root, INTAKE_RECORD))).toBe(false);
  });
  it("refuses feeds the installed Director does not have", () => {
    const { root, host } = installed();
    const tampered = clone(tree) as AdvisorTree & { slots: Record<string, { feeds?: string[] }> };
    tampered.slots["intake.business.name"]!.feeds = ["identity.naming.nope"];
    expect(runIntake(tampered, root, { answers: answersFile({ "intake.business.name": "x" }) }, host).lines.join("\n")).toContain("identity.naming.nope");
  });
  it("the plan guard refuses any clossys verb but evidence, and Advisor writes outside clossys/advisor/", () => {
    const root = "/work";
    expect(intakePlanIssues({ root, writes: [], commands: [{ target: "clossys/agents/director/x/slot.json", args: ["pin", "director/x", "v1", "--root", root] }] }).join("\n")).toContain("intake runs only clossys evidence");
    expect(intakePlanIssues({ root, writes: ["clossys/agents/director/x/slot.json"], commands: [] }).join("\n")).toContain("agent slot");
    expect(intakePlanIssues({ root, writes: ["clossys/notes.json"], commands: [] }).join("\n")).toContain("outside clossys/advisor/");
    expect(intakePlanIssues({ root, writes: [INTAKE_RECORD], commands: [{ target: "clossys/evidence/director/owner-intake-name-2026-11-17.md", args: ["evidence", "owner-intake-name-2026-11-17", "--source", "user", "--root", root] }] })).toEqual([]);
  });
  it("the plan guard pins --source user, no --finding and --root equal to the workspace (guard)", () => {
    const root = "/work"; const target = "clossys/evidence/director/owner-intake-name-2026-11-17.md";
    const plan = (args: string[]) => intakePlanIssues({ root, writes: [], commands: [{ target, args: ["evidence", "owner-intake-name-2026-11-17", ...args] }] }).join("\n");
    expect(plan(["--source", "user", "--root", root])).toBe("");
    expect(plan(["--source", "agent", "--root", root])).toContain("--source must be user");
    expect(plan(["--root", root])).toContain("--source must be user");
    expect(plan(["--source", "user", "--finding", "--root", root])).toContain("owner words are not a finding");
    expect(plan(["--source", "user", "--root", "/elsewhere"])).toContain("--root must be the workspace root");
    expect(plan(["--source", "user"])).toContain("--root must be the workspace root");
  });
});

describe("advisor relations", () => {
  function setFile(doc: unknown): string { const file = join(temp(), "relations.json"); writeFileSync(file, JSON.stringify(doc)); return file; }
  it("shows none, records a valid note and reads it back", () => {
    const root = temp();
    expect(runRelations(root, undefined).lines[0]).toContain("none recorded");
    const doc = { schema: "clossys.advisor-relations/1", sisters: [{ name: "site", relation: "downstream", note: "Marketing site that consumes this design system" }] };
    expect(runRelations(root, setFile(doc)).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(root, RELATIONS_RECORD), "utf8"))).toEqual(doc);
    expect(runRelations(root, undefined).lines).toEqual(["downstream site: Marketing site that consumes this design system"]);
  });
  it("refuses a path, URL or command in an entry (guard)", () => {
    const root = temp();
    const withPath = { schema: "clossys.advisor-relations/1", sisters: [{ name: "site", relation: "sibling", note: "ok", path: "../site" }] };
    expect(runRelations(root, setFile(withPath)).lines.join("\n")).toContain("sisters[0].path is not allowed");
    const withUrl = { schema: "clossys.advisor-relations/1", sisters: [{ name: "site", relation: "sibling", note: "see https://example.com" }] };
    expect(runRelations(root, setFile(withUrl)).lines.join("\n")).toContain("must not hold a path, URL or command");
    expect(existsSync(join(root, RELATIONS_RECORD))).toBe(false);
  });
});

describe("advisor conform (L0-L3 round)", () => {
  const tree = loadTree();
  const loops = loadLoops(tree);
  const cells = directorCells([DIRECTOR_ROOT]);
  const files = loadConformFiles();
  let producer: ProducerFacts;
  beforeAll(async () => {
    const facts = await loadProducerFacts(producerDir(undefined));
    // The round reads Producer's real loop names, triggers and schemas; a missing built Producer is a failure, not a skip.
    expect(facts, "build @clossys/producer first: the round reads its dist and schemas").not.toBeNull();
    producer = facts!;
  });
  // Drafts are deliberately loose: each mutation writes what the typed tree forbids.
  type Draft = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  type Loops = Record<string, { extends: unknown; content: Record<string, any> & { steps: Record<string, any>[] } }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const statusOf = (id: string, mutate: (draft: Draft, loopsDraft: Loops, filesDraft: { adapter: any; edges: Record<string, any> }) => void) => {
    const draft = clone(tree) as Draft; const loopsDraft = clone(loops) as unknown as Loops; const filesDraft = clone(files) as { adapter: any; edges: Record<string, any> };
    mutate(draft, loopsDraft, filesDraft);
    return runRound(draft as AdvisorTree, loopsDraft as unknown as Record<string, LoopDoc>, cells, producer, filesDraft as ConformFiles).find(row => row.id === id)!;
  };
  const red = (id: string, mutate: Parameters<typeof statusOf>[1], why?: string) => {
    const row = statusOf(id, mutate);
    expect(row.status, `${id} should be red: ${row.detail}`).toBe("red");
    if (why) expect(row.detail).toContain(why);
  };

  it("the packaged draft tree has no red row against Producer's real loop facts and reports its draft, owner-reserved status", () => {
    const rows = runRound(tree, loops, cells, producer, files);
    expect(rows.map(row => row.id)).toEqual(["A.R1", "A.R2", "A.R3", "A.R4", "A.W1", "A.W2", "A.E1", "A.C1", "A.S1"]);
    expect(rows.filter(row => row.status === "red")).toEqual([]);
    expect(rows.find(row => row.id === "A.S1")!.detail).toContain("draft, owner-reserved");
    expect(rows.find(row => row.id === "A.C1")!.status).toBe("green");
  });
  it("reads Producer's own exports, not a copy", () => {
    expect(producer.loopNames).toContain("loop.fill");
    expect(producer.loopTriggers["loop.fill"]).toContain("T1");
    expect(producer.loopTriggers["loop.audit"]).not.toContain("T8");
    expect(producer.loopIssues(loops["loop.onboard"]!.content)).toEqual([]);
    expect(producer.loopIssues(loops["loop.update"]!.content)).toEqual([]);
    expect(producer.adapterIssues(files.adapter, "advisor")).toEqual([]);
  });
  it("is red with no built Producer, never green by default", () => {
    const rows = runRound(tree, loops, cells, null, files);
    expect(rows.find(row => row.id === "A.W2")!.status).toBe("red");
    expect(rows.find(row => row.id === "A.C1")!.status).toBe("red");
  });
  it("conform.json is a clossys.conform-adapter/1 that names this tree, its skill and an existing edge file", () => {
    const adapter = files.adapter as { schema: string; agent: string; trees: { file: string }[]; edgeFiles: { file: string }[]; skill: string };
    expect(adapter.schema).toBe("clossys.conform-adapter/1");
    expect(adapter.agent).toBe("advisor");
    for (const file of [adapter.trees[0]!.file, adapter.skill, ...adapter.edgeFiles.map(entry => entry.file)]) expect(existsSync(join(PACKAGE_ROOT, file))).toBe(true);
  });

  it("turns red on a twice-placed leaf, a missing contract, overlapping feeds, a bad loop step and an unknown Director cell", () => {
    red("A.R1", draft => { draft.nodes[0].children[1].leaves.push("machine.tools.git"); });
    red("A.R2", draft => { draft.slots["intake.business.name"].feeds = ["focus.offer.included"]; });
    red("A.R3", draft => { delete draft.nodes[0].splitBy; });
    red("A.R4", draft => { draft.slots["workspace.files.config"].contract = { record: "", requirements: [] }; });
    red("A.W1", draft => { draft.slots["relations.sisters.note"].verb = "hire"; });
    red("A.W2", (_draft, loopsDraft) => { loopsDraft["loop.onboard"]!.content.steps[0]!.cli = "clossys hub join"; });
    red("A.E1", draft => { draft.slots["intake.business.name"].feeds = ["identity.naming.nope"]; });
  });
  it("A.R3 is red when a split rule is not declared (D5) or an L0/L1 name is not an axis value", () => {
    red("A.R3", draft => { for (const l1 of draft.nodes) { l1.splitBy = "x"; for (const l2 of l1.children) l2.splitBy = "x"; } }, "which splitRules does not declare");
    red("A.R3", draft => { draft.nodes[0].children[0].splitBy = "x"; }, "splits by x");
    red("A.R3", draft => { draft.layers[0].label = "Elsewhere"; }, "is not an L0 axis value");
    red("A.R3", draft => { draft.nodes[0].name = "Renamed"; }, "is not a value of the");
  });
  it("A.W2 is red on a handoff to a loop that does not take the trigger (D1)", () => {
    const fill = (loopsDraft: Loops) => loopsDraft["loop.onboard"]!.content.steps.find(step => step.id === "fill")!;
    red("A.W2", (_d, loopsDraft) => { fill(loopsDraft).cli = "clossys run loop.release --trigger T1"; }, "hands T1 to loop.release");
    red("A.W2", (_d, loopsDraft) => { fill(loopsDraft).cli = "clossys run loop.release --init"; }, "--init starts loop.fill only");
    red("A.W2", (_d, loopsDraft) => { fill(loopsDraft).cli = "clossys run loop.fill"; }, "without naming its trigger");
    red("A.W2", (_d, loopsDraft) => { fill(loopsDraft).cli = "clossys run loop.nope --trigger T1"; }, "not a Producer loop");
    red("A.W2", (_d, loopsDraft) => { loopsDraft["loop.onboard"]!.content.trigger = ["T99"]; }, "not a Producer trigger");
  });
  it("A.W2 is red when the update loop raises to a loop that does not take the failed-check trigger (T8 to loop.audit)", () => {
    const check = (loopsDraft: Loops) => loopsDraft["loop.update"]!.content.steps.find(step => step.id === "check")!;
    red("A.W2", (_d, loopsDraft) => { check(loopsDraft).cli = "clossys run loop.audit --trigger T8"; }, "hands T8 to loop.audit");
    red("A.W2", (_d, loopsDraft) => { check(loopsDraft).onFail.then = "loop.release"; }, "does not take the failed-check trigger");
    red("A.W2", (_d, loopsDraft) => { check(loopsDraft).onFail.then = "loop.nope"; }, "not a Producer loop");
  });
  it("A.W2 is red on a schema-illegal loop: garbage decider, boolean or numeric repeat, an extra key (D2)", () => {
    red("A.W2", (_d, loopsDraft) => { loopsDraft["loop.onboard"]!.content.steps[1]!.decider = { by: "check" }; }, "clossys.loop-version/1");
    red("A.W2", (_d, loopsDraft) => { loopsDraft["loop.onboard"]!.content.repeat = 42; }, "clossys.loop-version/1");
    red("A.W2", (_d, loopsDraft) => { loopsDraft["loop.update"]!.content.repeat = true; }, "clossys.loop-version/1");
    red("A.W2", (_d, loopsDraft) => { loopsDraft["loop.onboard"]!.content.handoff = { loop: "producer/loop.fill", trigger: "T1" }; }, "clossys.loop-version/1");
    red("A.W2", (_d, loopsDraft) => { loopsDraft["loop.onboard"]!.content.steps[3]!.onFail = { raise: "queue.later", then: "retry" }; }, "clossys.loop-version/1");
  });
  it("A.W2 is red on reversed (D3) or removed (D4) steps, and on a check of another verb's L3", () => {
    red("A.W2", (_d, loopsDraft) => { loopsDraft["loop.onboard"]!.content.steps.reverse(); }, "in that order");
    red("A.W2", (_d, loopsDraft) => { const steps = loopsDraft["loop.onboard"]!.content.steps; [steps[1], steps[3]] = [steps[3]!, steps[1]!]; }, "in that order");
    red("A.W2", (_d, loopsDraft) => { const content = loopsDraft["loop.onboard"]!.content; content.steps = content.steps.filter(step => !["install", "init", "intake"].includes(step.id)); }, "in that order");
    red("A.W2", (_d, loopsDraft) => { const content = loopsDraft["loop.update"]!.content; content.steps = content.steps.filter(step => step.id !== "update"); }, "in that order");
    red("A.W2", (_d, loopsDraft) => { loopsDraft["loop.onboard"]!.content.steps[0]!.checks = ["packages.record.install"]; }, "not an L3 of doctor");
    red("A.W2", draft => { draft.slots["loop.onboard"].runs = ["doctor", "install", "init"]; }, "in that order");
  });
  it("A.W2 is red when a loop reaches no Producer loop or extends an unknown one", () => {
    red("A.W2", (_d, loopsDraft) => { const content = loopsDraft["loop.onboard"]!.content; content.steps = content.steps.filter(step => step.id !== "fill"); }, "reaches no Producer loop");
    red("A.W2", (_d, loopsDraft) => { loopsDraft["loop.update"]!.extends = "producer/loop.nope"; }, "extends unknown");
  });
  it("A.C1 is red on a conform.json Producer refuses or an edge file that disagrees with the tree", () => {
    red("A.C1", (_d, _l, filesDraft) => { filesDraft.adapter.schema = "clossys.advisor-conform/1"; });
    red("A.C1", (_d, _l, filesDraft) => { filesDraft.adapter.rows = ["A.R1"]; });
    red("A.C1", (_d, _l, filesDraft) => { delete filesDraft.adapter.kinds; });
    red("A.C1", (_d, _l, filesDraft) => { filesDraft.adapter.trees = [{ file: "front-door/other.json", freeze: null }]; }, "does not name front-door/tree.json");
    red("A.C1", (_d, _l, filesDraft) => { filesDraft.edges["front-door/intake-feeds.json"].slots[0].feeds = ["focus.offer.excluded"]; }, "the tree says");
    red("A.C1", (_d, _l, filesDraft) => { filesDraft.edges["front-door/intake-feeds.json"].slots.pop(); }, "feeding nothing");
    red("A.C1", (_d, _l, filesDraft) => { filesDraft.edges["front-door/intake-feeds.json"] = undefined; }, "missing");
    red("A.C1", draft => { draft.slots["intake.business.name"].feeds = ["identity.naming.name", "context.customer.need"]; }, "the tree says");
  });
});

describe("advisor cli and secret guard", () => {
  it("prints usage, refuses unknown verbs and flags", async () => {
    expect((await runAdvisor(["--help"], "/work", fakeHost())).exitCode).toBe(0);
    expect((await runAdvisor(["hire"], "/work", fakeHost())).exitCode).toBe(2);
    expect((await runAdvisor(["constructor"], "/work", fakeHost())).exitCode).toBe(2);
    expect((await runAdvisor(["doctor", "--from", "x"], "/work", fakeHost())).exitCode).toBe(2);
    expect((await runAdvisor([], "/work", fakeHost())).exitCode).toBe(2);
  });
  it("runs conform over the packaged tree, loops and conform.json with no red row", async () => {
    const result = await runAdvisor(["conform"], temp(), fakeHost());
    expect(result.exitCode, result.lines.join("\n")).toBe(0);
    expect(result.lines.at(-1)).toBe("advisor conform: 9 rows, 0 red");
  });
  it("conform resolves Director from the consumer's node_modules", async () => {
    const root = temp();
    const director = join(root, "node_modules", "@clossys", "director", "src", "catalog", "ia");
    mkdirSync(director, { recursive: true });
    writeFileSync(join(director, "strategy.json"), JSON.stringify({ slots: { "focus.offer.included": {} } }));
    const result = await runAdvisor(["conform", "--root", root], "/work", fakeHost());
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("feeds unknown Director cell");
  });
  it("takes the workspace root from --root, else the Git top level, else the current directory", () => {
    const top = fakeHost({ "git rev-parse --show-toplevel": { status: 0, stdout: "/repo\n", stderr: "" } });
    expect(workspaceRoot("/repo/apps/web", undefined, top)).toBe("/repo");
    expect(top.calls.map(call => [call.command, ...call.args].join(" "))).toEqual(["git rev-parse --show-toplevel"]);
    expect(workspaceRoot("/repo/apps/web", "../..", top)).toBe("/repo");
    expect(workspaceRoot("/loose", undefined, fakeHost({ "git rev-parse --show-toplevel": { status: 128, stdout: "", stderr: "not a git repository" } }))).toBe("/loose");
  });
  it("treats environment, key and credential files as secret", () => {
    for (const path of [".env", ".env.local", "app/.env.production", ".npmrc", "id_ed25519", ".ssh/config", "deploy.pem", "credentials.json"]) expect(isSecretPath(path)).toBe(true);
    for (const path of ["package.json", "clossys/advisor/install.json", "environment.md"]) expect(isSecretPath(path)).toBe(false);
    expect(doctorProbeIssues("x", { command: "node", args: ["--version"] })).toEqual([]);
  });
});
