import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAdvisor } from "./cli.js";
import { runDoctor } from "./doctor.js";
import { doctorProbeIssues, intakePlanIssues, isSecretPath } from "./guard.js";
import type { CommandResult, Host } from "./host.js";
import { runInit } from "./init.js";
import { INSTALL_RECORD, runInstall, runUpdate } from "./install.js";
import { INTAKE_RECORD, runIntake } from "./intake.js";
import { RELATIONS_RECORD, runRelations } from "./relations.js";
import { directorCells, loadLoops, loadTree, PACKAGE_ROOT, runRound, type AdvisorTree, type LoopDoc } from "./tree.js";

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

const ROLES = ["controller", "director", "designer", "writer", "publisher", "producer"];
function makePack(head = HEAD_A, tree = TREE_A, options: { dirty?: boolean; drop?: string; corrupt?: string; tag?: string } = {}): string {
  const dir = temp();
  const artifacts = ROLES.filter(role => role !== options.drop).map(role => {
    const filename = `clossys-${role}-${options.tag ?? "1"}.0.0.tgz`;
    const bytes = Buffer.from(`${role}-${head}`);
    writeFileSync(join(dir, filename), bytes);
    const sha256 = createHash("sha256").update(options.corrupt === role ? Buffer.from("other") : bytes).digest("hex");
    return { role, name: `@clossys/${role}`, version: `${options.tag ?? "1"}.0.0`, filename, sha256 };
  });
  writeFileSync(join(dir, "artifacts.json"), JSON.stringify({ schemaVersion: 1, head, tree, source: { head, tree, dirty: options.dirty ?? false }, complete: true, artifacts }));
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
  it("refuses a dirty pack, a pack without artifacts.json and a pack missing an MVP agent", () => {
    const host = fakeHost();
    expect(runInstall(temp(), makePack(HEAD_A, TREE_A, { dirty: true }), host).lines.join("\n")).toContain("dirty checkout");
    expect(runInstall(temp(), temp(), host).lines.join("\n")).toContain("artifacts.json not found");
    expect(runInstall(temp(), makePack(HEAD_A, TREE_A, { drop: "writer" }), host).lines.join("\n")).toContain("writer exactly once");
    expect(host.calls).toEqual([]);
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
    expect(result.lines.filter(line => line.startsWith("stale (kept, not deleted)"))).toHaveLength(6);
    expect(readdirSync(join(root, "vendor", "clossys"))).toHaveLength(12);
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
  it("records each answer through clossys evidence only, skips unanswered questions and writes its own record", () => {
    const { root, host } = installed();
    const answers = answersFile({ "intake.business.offer": "Bookkeeping for small cafes", "intake.business.name": "Ledger & Bean", "intake.limits.constraint": "One person, evenings only" });
    const result = runIntake(tree, root, { answers }, host);
    expect(result.exitCode).toBe(0);
    expect(host.calls.map(call => call.args[0])).toEqual(["evidence", "evidence", "evidence"]);
    for (const call of host.calls) {
      expect(call.args[call.args.indexOf("--source") + 1]).toBe("user");
      expect(call.args).not.toContain("--finding");
    }
    const offer = readFileSync(join(root, "clossys", "evidence", "director", "owner-intake-offer-2026-11-17.md"), "utf8");
    expect(offer).toContain('- Words: "Bookkeeping for small cafes"');
    expect(offer).toContain("- Informs: focus.offer.included");
    const record = JSON.parse(readFileSync(join(root, INTAKE_RECORD), "utf8"));
    expect(record.status).toBe("complete");
    expect(record.skipped).toEqual(["intake.business.audience", "intake.limits.horizon"]);
    expect(existsSync(join(root, "clossys", "agents"))).toBe(false);
  });
  it("runs once; a second intake points to Director", () => {
    const { root, host } = installed();
    expect(runIntake(tree, root, { answers: answersFile({ "intake.business.name": "Ledger & Bean" }) }, host).exitCode).toBe(0);
    const again = runIntake(tree, root, { answers: answersFile({ "intake.business.name": "Other" }) }, host);
    expect(again.exitCode).toBe(1);
    expect(again.lines[0]).toContain("@clossys-director");
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
  it("the packaged draft tree has no red row and reports its draft, owner-reserved status", () => {
    const rows = runRound(tree, loops, cells);
    expect(rows.map(row => row.id)).toEqual(["A.R1", "A.R2", "A.R3", "A.R4", "A.W1", "A.W2", "A.E1", "A.S1"]);
    expect(rows.filter(row => row.status === "red")).toEqual([]);
    expect(rows.find(row => row.id === "A.S1")!.detail).toContain("draft, owner-reserved");
    expect(rows.find(row => row.id === "A.R3")!.status).toBe("report");
  });
  it("conform.json names the same rows, loops, verbs and files the round runs", () => {
    const adapter = JSON.parse(readFileSync(join(PACKAGE_ROOT, "conform.json"), "utf8"));
    expect(adapter.rows).toEqual(runRound(tree, loops, cells).map(row => row.id));
    expect(adapter.loops).toEqual(Object.values(tree.slots).flatMap(slot => slot.loop ? [slot.loop] : []));
    expect(adapter.verbs).toEqual(["doctor", "install", "init", "intake", "update", "relations"]);
    for (const file of [adapter.trees[0].file, ...adapter.loops, adapter.skill]) expect(existsSync(join(PACKAGE_ROOT, file))).toBe(true);
  });
  it("turns red on a twice-placed leaf, a missing contract, overlapping feeds, a bad loop step and an unknown Director cell", () => {
    const red = (mutate: (draft: any, loopsDraft: Record<string, LoopDoc & { content: { steps: { cli: string }[] } }>) => void, id: string) => {
      const draft = clone(tree) as any; const loopsDraft = clone(loops) as any;
      mutate(draft, loopsDraft);
      expect(runRound(draft, loopsDraft, cells).find(row => row.id === id)!.status).toBe("red");
    };
    red(draft => { draft.nodes[0].children[1].leaves.push("machine.tools.git"); }, "A.R1");
    red(draft => { draft.slots["intake.business.name"].feeds = ["focus.offer.included"]; }, "A.R2");
    red(draft => { delete draft.nodes[0].splitBy; }, "A.R3");
    red(draft => { draft.slots["workspace.files.config"].contract = { record: "", requirements: [] }; }, "A.R4");
    red(draft => { draft.slots["relations.sisters.note"].verb = "hire"; }, "A.W1");
    red((_draft, loopsDraft) => { loopsDraft["loop.onboard"]!.content.steps[0]!.cli = "clossys hub join"; }, "A.W2");
    red(draft => { draft.slots["intake.business.name"].feeds = ["identity.naming.nope"]; }, "A.E1");
  });
});

describe("advisor cli and secret guard", () => {
  it("prints usage, refuses unknown verbs and flags", () => {
    expect(runAdvisor(["--help"], "/work", fakeHost()).exitCode).toBe(0);
    expect(runAdvisor(["hire"], "/work", fakeHost()).exitCode).toBe(2);
    expect(runAdvisor(["doctor", "--from", "x"], "/work", fakeHost()).exitCode).toBe(2);
    expect(runAdvisor([], "/work", fakeHost()).exitCode).toBe(2);
  });
  it("runs conform over the packaged tree", () => { expect(runAdvisor(["conform"], "/work", fakeHost()).exitCode).toBe(0); });
  it("treats environment, key and credential files as secret", () => {
    for (const path of [".env", ".env.local", "app/.env.production", ".npmrc", "id_ed25519", ".ssh/config", "deploy.pem", "credentials.json"]) expect(isSecretPath(path)).toBe(true);
    for (const path of ["package.json", "clossys/advisor/install.json", "environment.md"]) expect(isSecretPath(path)).toBe(false);
    expect(doctorProbeIssues("x", { command: "node", args: ["--version"] })).toEqual([]);
  });
});
