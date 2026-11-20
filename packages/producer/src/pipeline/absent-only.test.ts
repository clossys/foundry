/**
 * R-NO-HIDDEN-FALLBACKS for the chain and the run trace: an absent file, folder or ref is tolerated
 * (no item, no record, no head); every other read failure is thrown rather than turned into an
 * empty listing, a null sha, a default summary or an unrecorded read.
 */
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidatesOf, openItems, packetOf, skillLine, skillOf, type Context } from "./chain.js";
import type { Step } from "./define.js";
import { appendRecord, buildRecord, currentSha, observe, readRuns, readSink, readStore, RUN_SCHEMA, storeFile, storeIgnored, type RunRecord } from "./trace.js";

const fs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
let root: string;
const locked: string[] = [];
const lock = (path: string) => { chmodSync(path, 0o000); locked.push(path); };
beforeEach(() => { root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "absent-only-"))); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const path of locked.splice(0)) chmodSync(path, 0o755);
  rmSync(root, { recursive: true, force: true });
});

const step = (fields: Partial<Step>): Step => ({ id: "probe", kind: "decide:creative", summary: "The probe summary.", command: {}, inputs: [], outputs: [], ...fields }) as unknown as Step;
const context = (): Context => ({ root, steps: [], agents: {}, seats: {} });

describe("chain", () => {
  it("throws when an output glob's folder cannot be listed (not an open item)", () => {
    mkdirSync(join(root, "out"));
    lock(join(root, "out"));
    expect(() => openItems(step({ outputs: [{ glob: "out/*" }] } as Partial<Step>), context())).toThrow(expect.objectContaining({ code: "EACCES", syscall: "scandir" }));
  });
  it("still opens an output whose folder is absent", () => {
    expect(openItems(step({ outputs: [{ glob: "out/*" }] } as Partial<Step>), context())).toEqual(["probe"]);
  });
  it("throws when the model reader refuses an agent folder (an alias) instead of reading it as unplaced", () => {
    const agents = join(root, "clossys", "agents");
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    mkdirSync(agents, { recursive: true });
    for (const agent of ["director", "designer", "writer", "publisher", "producer"]) symlinkSync(join(root, "elsewhere"), join(agents, agent));
    expect(() => openItems(step({ open: "slots-without-slot-json" } as Partial<Step>), context())).toThrow(/Symbolic links/);
  });
  it("candidatesOf throws a candidates folder under an aliased slot instead of listing none", () => {
    mkdirSync(join(root, "elsewhere", "tokens.color", "candidates"), { recursive: true });
    mkdirSync(join(root, "clossys", "agents"), { recursive: true });
    symlinkSync(join(root, "elsewhere"), join(root, "clossys", "agents", "designer"));
    expect(() => candidatesOf(root, "designer/tokens.color")).toThrow(/Symbolic links/);
    expect(candidatesOf(root, "writer/copy.hero")).toEqual([]);
  });
  it("throws a slot.json presence check it cannot make instead of opening the slot", () => {
    const designer = join(root, "clossys", "agents", "designer");
    mkdirSync(join(designer, "tokens.color"), { recursive: true });
    writeFileSync(join(designer, "ia.json"), JSON.stringify({ nodes: [{ children: [{ slots: ["tokens.color"] }] }] }));
    const open = () => openItems(step({ open: "slots-without-slot-json" } as Partial<Step>), context());
    expect(open()).toContain("designer/tokens.color");
    lock(join(designer, "tokens.color"));
    expect(open).toThrow(expect.objectContaining({ code: "EACCES", syscall: "lstat" }));
  });
  it("skillOf and skillLine throw when the skill file cannot be read", () => {
    const probe = step({ command: { skill: "actions/probe/skill.md" }, package: "producer" } as Partial<Step>);
    mkdirSync(join(root, "actions", "probe", "skill.md"), { recursive: true });
    expect(() => skillOf(probe, root)).toThrow(expect.objectContaining({ code: "EISDIR" }));
    expect(() => skillLine(probe, root)).toThrow(expect.objectContaining({ code: "EISDIR" }));
  });
  it("skillOf and skillLine keep their absent answers", () => {
    const probe = step({ command: { skill: "actions/probe/skill.md" }, package: "producer" } as Partial<Step>);
    expect(skillOf(probe, root)).toEqual({ path: "actions/probe/skill.md", file: null, sha256: null });
    expect(skillLine(probe, root)).toBe("The probe summary.");
  });
  it("packetOf throws on a slot.json that is not JSON", () => {
    mkdirSync(join(root, "clossys", "agents", "designer", "tokens.color"), { recursive: true });
    writeFileSync(join(root, "clossys", "agents", "designer", "tokens.color", "slot.json"), "{ not json");
    expect(() => packetOf(step({}), "designer/tokens.color", 1, context(), { packageRoot: root })).toThrow(/not JSON/);
  });
});

describe("trace", () => {
  const record = (): RunRecord => ({
    schema: RUN_SCHEMA, run: "r0", step: "ia", invocation: "ia", argv: ["ia"], start: "2026-11-19T00:00:00.000Z", end: "2026-11-19T00:00:01.000Z",
    exit: 0, head: null, tool: null, inputs: "0".repeat(64), reads: [], writes: [],
  }) as unknown as RunRecord;
  const run = () => buildRecord({ root, step: "ia", invocation: "ia", argv: ["ia"], start: new Date(0), end: new Date(1), exit: 0, observation: { reads: new Map(), writes: new Set() } });

  it("an observed copy throws when its source cannot be hashed, rather than dropping the read", () => {
    writeFileSync(join(root, "from"), "x");
    lock(join(root, "from"));
    const seen = observe();
    try { expect(() => copyFileSync(join(root, "from"), join(root, "to"))).toThrow(expect.objectContaining({ code: "EACCES", syscall: "open" })); }
    finally { seen.stop(); }
  });
  it("currentSha throws an unreadable file and keeps null for an absent one", () => {
    writeFileSync(join(root, "file"), "x");
    lock(join(root, "file"));
    expect(() => currentSha(root, "file")).toThrow(expect.objectContaining({ code: "EACCES" }));
    expect(currentSha(root, "missing")).toBeNull();
  });
  it("gitHead throws an unreadable .git file and keeps null outside a checkout", () => {
    expect(run().head).toBeNull();
    writeFileSync(join(root, ".git"), "gitdir: elsewhere\n");
    lock(join(root, ".git"));
    expect(run).toThrow(expect.objectContaining({ code: "EACCES" }));
  });
  it("headOf throws an unreadable HEAD, commondir, loose ref or packed-refs", () => {
    const git = join(root, ".git");
    mkdirSync(join(git, "refs", "heads"), { recursive: true });
    writeFileSync(join(git, "HEAD"), "ref: refs/heads/main\n");
    expect(run().head).toBeNull();
    mkdirSync(join(git, "packed-refs"));
    expect(run).toThrow(expect.objectContaining({ code: "EISDIR" }));
    rmSync(join(git, "packed-refs"), { recursive: true });
    writeFileSync(join(git, "refs", "heads", "main"), "a".repeat(40));
    expect(run().head).toBe("a".repeat(40));
    lock(join(git, "refs", "heads", "main"));
    expect(run).toThrow(expect.objectContaining({ code: "EACCES" }));
    chmodSync(join(git, "refs", "heads", "main"), 0o644);
    mkdirSync(join(git, "commondir"));
    expect(run).toThrow(expect.objectContaining({ code: "EISDIR" }));
    rmSync(join(git, "commondir"), { recursive: true });
    lock(join(git, "HEAD"));
    expect(run).toThrow(expect.objectContaining({ code: "EACCES" }));
  });
  it("the tool version throws a package.json that is not JSON", async () => {
    vi.resetModules();
    const fresh = await import("./trace.js");
    const pkg = fileURLToPath(new URL("../../package.json", import.meta.url));
    const read = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((path: unknown, options?: unknown) => path === pkg ? Buffer.from("{ not json") : read(path as string, options as undefined)) as typeof fs.readFileSync);
    expect(() => fresh.buildRecord({ root, step: "ia", invocation: "ia", argv: ["ia"], start: new Date(0), end: new Date(1), exit: 0, observation: { reads: new Map(), writes: new Set() } })).toThrow(/package\.json: not JSON/);
  });
  it("storeIgnored throws an unreadable .gitignore and keeps false for an absent one", () => {
    expect(storeIgnored(root)).toBe(false);
    mkdirSync(join(root, ".gitignore"));
    expect(() => storeIgnored(root)).toThrow(expect.objectContaining({ code: "EISDIR" }));
  });
  it("readStore throws a store it cannot open and keeps no runs for an absent one", () => {
    expect(readStore(root, storeFile("ia"))).toEqual([]);
    mkdirSync(join(root, ".clossys", "runs"), { recursive: true });
    writeFileSync(join(root, ...storeFile("ia").split("/")), "");
    lock(join(root, ...storeFile("ia").split("/")));
    expect(() => readStore(root, storeFile("ia"))).toThrow(expect.objectContaining({ code: "EACCES", syscall: "open" }));
  });
  it("appendRecord throws when the store cannot be stat'ed for other than absence", () => {
    writeFileSync(join(root, ".gitignore"), "/.clossys/runs/\n");
    const file = join(root, ...storeFile("ia").split("/"));
    const stat = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation(((path: unknown, options?: unknown) => {
      if (path === file) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      return stat(path as string, options as undefined);
    }) as typeof fs.statSync);
    expect(() => appendRecord(root, record())).toThrow(expect.objectContaining({ code: "EACCES" }));
  });
  it("readRuns throws a runs folder it cannot list and keeps none for an absent one", () => {
    expect(readRuns(root)).toEqual([]);
    mkdirSync(join(root, ".clossys", "runs"), { recursive: true });
    lock(join(root, ".clossys", "runs"));
    expect(() => readRuns(root)).toThrow(expect.objectContaining({ code: "EACCES" }));
  });
  it("readSink throws a sink it cannot read and keeps an empty observation for an absent one", () => {
    expect(readSink(join(root, "sink")).reads.size).toBe(0);
    mkdirSync(join(root, "sink"));
    expect(() => readSink(join(root, "sink"))).toThrow(expect.objectContaining({ code: "EISDIR" }));
  });
});
