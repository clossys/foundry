// Pin history is read from git once per HEAD, not once per Studio request (R2F-C3: a capture run
// spawned `git log --follow` and `git rev-parse` ~3,000 times each). The memo must answer exactly
// what the unmemoised reader answered, follow new commits, and leave the working-tree fallback live.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.js";
import { jsonBytes, slotPositions, type IaDoc } from "./slot-model/index.js";
import { pinHistory, setGitRunner, type GitRunner, type PinEvent } from "./slots.js";

const agent = "designer" as const;
const slots = ["components.alpha", "components.beta", "components.gamma"];
let repo: string, consumer: string, calls: string[][];

const git = (...args: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
  cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
});
const commit = (message: string) => { git("add", "-A"); git("commit", "-q", "--allow-empty", "-m", message); };
const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "components.examples", label: "Examples", children: [{ id: "group", label: "Group", slots }] }] };
const dirOf = (slot: string) => join(consumer, "agents", agent, slot);
function candidate(slot: string, version: number): string {
  const bytes = jsonBytes({ name: `example-${version}`, type: "registry:item", files: [], meta: { source: { kind: "original", ref: [] } } });
  writeFileSync(join(dirOf(slot), "candidates", `sample-v${version}.json`), bytes);
  return bytes;
}
function pin(slot: string, version: number, decider: Record<string, string> = { decidedBy: "migrated", basis: "bulk" }): void {
  const bytes = candidate(slot, version);
  writeFileSync(join(dirOf(slot), "pin.json"), jsonBytes({ candidate: `sample-v${version}.json`, sha256: sha256Hex(bytes), ...decider, at: `2026-10-2${version}T00:00:00Z` }));
}

/** The reader as it was before the memo: one `git log` and one `git show` per commit, every call. */
function referenceHistory(slot: string): PinEvent[] {
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: consumer, encoding: "utf8" }).trim();
  const rel = relative(top, join(dirOf(slot), "pin.json")).split("\\").join("/");
  const log = execFileSync("git", ["log", "--follow", "--format=%x00%H", "--name-only", "--", rel], { cwd: top, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const read = log.split("\0").filter(Boolean).map(chunk => {
    const [c = "", ...paths] = chunk.split("\n").map(line => line.trim()).filter(Boolean);
    const at = paths[0] ?? rel;
    try { return { commit: c, at, bytes: execFileSync("git", ["show", `${c}:${at}`], { cwd: top, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) as string | undefined }; }
    catch { return { commit: c, at, bytes: undefined }; }
  });
  const events: PinEvent[] = [];
  for (const [index, entry] of read.entries()) {
    if (entry.bytes === undefined) continue;
    const older = read[index + 1];
    if (older && older.at !== entry.at && older.bytes === entry.bytes) continue;
    const { pinnedBy, ...doc } = JSON.parse(entry.bytes) as PinEvent & { pinnedBy?: string };
    events.push({ ...doc, decidedBy: doc.decidedBy ?? pinnedBy ?? "", commit: entry.commit });
  }
  if (events.length) return events;
  return [];
}

const counting: GitRunner = (args, { cwd, input }) => {
  calls.push([...args]);
  return execFileSync("git", args, { cwd, ...(input === undefined ? { stdio: ["ignore", "pipe", "pipe"] } : { input, stdio: ["pipe", "pipe", "pipe"] }) });
};
const spawned = (verb: string) => calls.filter(args => args[0] === verb).length;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "pin-history-")));
  consumer = join(repo, "site");
  git("init", "-q", "-b", "main");
  for (const slot of slots) {
    mkdirSync(join(dirOf(slot), "candidates"), { recursive: true });
    writeFileSync(join(dirOf(slot), "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: slot, agent, ia: slotPositions(agent, ia).get(slot), kind: "element", contract: {}, inputs: [], uses: [] }));
  }
  writeFileSync(join(consumer, "agents", agent, "ia.json"), jsonBytes(ia));
  // alpha: pinned (old `pinnedBy` field), repinned, unpinned, pinned again. beta: pinned once. gamma: never committed.
  pin("components.alpha", 1, { pinnedBy: "planner-old", basis: "planner" }); pin("components.beta", 1); commit("first pins");
  pin("components.alpha", 2); commit("repin alpha");
  rmSync(join(dirOf("components.alpha"), "pin.json")); commit("unpin alpha");
  pin("components.alpha", 3); commit("pin alpha again");
  calls = [];
  setGitRunner(counting);
});
afterEach(() => {
  setGitRunner();
  rmSync(repo, { recursive: true, force: true });
});

describe("pin history memo (one git read per HEAD)", () => {
  it("answers exactly what the unmemoised reader answered", () => {
    for (const slot of ["components.alpha", "components.beta"]) {
      const expected = referenceHistory(slot);
      expect(expected.length).toBeGreaterThan(0);
      expect(JSON.stringify(pinHistory(consumer, agent, slot))).toBe(JSON.stringify(expected));
      // A memoised answer is the same answer.
      expect(JSON.stringify(pinHistory(consumer, agent, slot))).toBe(JSON.stringify(expected));
    }
    expect(pinHistory(consumer, agent, "components.alpha").map(event => event.candidate)).toEqual(["sample-v3.json", "sample-v2.json", "sample-v1.json"]);
    expect(pinHistory(consumer, agent, "components.alpha").at(-1)?.decidedBy).toBe("planner-old");
  });

  it("spawns git O(1) per HEAD and path, however many requests ask", () => {
    for (let request = 0; request < 25; request++) pinHistory(consumer, agent, "components.alpha");
    expect(spawned("rev-parse")).toBe(1);
    expect(spawned("log")).toBe(1);
    expect(spawned("cat-file")).toBe(1);
    expect(spawned("show")).toBe(0);
    expect(calls.length).toBe(3);
  });

  it("reads a new commit once HEAD moves", () => {
    const before = pinHistory(consumer, agent, "components.beta");
    pin("components.beta", 2); commit("repin beta");
    for (let request = 0; request < 10; request++) expect(JSON.stringify(pinHistory(consumer, agent, "components.beta"))).toBe(JSON.stringify(referenceHistory("components.beta")));
    const after = pinHistory(consumer, agent, "components.beta");
    expect(after.length).toBe(before.length + 1);
    expect(after[0]?.candidate).toBe("sample-v2.json");
    expect(spawned("log")).toBe(2);
    expect(spawned("rev-parse")).toBe(1);
  });

  it("keeps the uncommitted working-tree pin live without re-reading git", () => {
    expect(pinHistory(consumer, agent, "components.gamma")).toEqual([]);
    pin("components.gamma", 1);
    expect(pinHistory(consumer, agent, "components.gamma").map(event => [event.candidate, event.commit])).toEqual([["sample-v1.json", "working-tree"]]);
    pin("components.gamma", 2);
    expect(pinHistory(consumer, agent, "components.gamma").map(event => [event.candidate, event.commit])).toEqual([["sample-v2.json", "working-tree"]]);
    expect(spawned("log")).toBe(1);
  });
});
