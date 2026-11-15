import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { answerQueueEntry } from "../queue/answer.js";
import { checkLedgerAppendOnly, LEDGER_APPEND_ONLY } from "./ledger-append-only.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const AT = "2026-11-20T08:00:00Z";
const QUEUE_ID = "20261120T0800Z-approve";
const LEDGER_ID = "20261120T0800Z-run";
const QUEUE_REL = `clossys/agents/producer/queue.approve/entries/${QUEUE_ID}.json`;
const LEDGER_REL = `clossys/agents/producer/ledger.refine/entries/${LEDGER_ID}.json`;

/** A throwaway git repository whose consumer sits in `site/` (so paths are checked relative to the workspace). */
function repo() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "append-only-")));
  roots.push(top);
  const root = join(top, "site");
  const git = (...args: string[]): string => execFileSync("git", ["-C", top, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  const put = (rel: string, doc: unknown): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), `${JSON.stringify(doc, null, 2)}\n`); };
  const queueEntry = {
    schema: "clossys.queue-entry/1", id: QUEUE_ID, agent: "producer", kind: "queue-entry", status: "open",
    createdBy: { actor: "code", cli: "clossys test", version: "0.0.0" }, createdAt: AT, refs: [],
    queue: "queue.approve", ask: "test ask", subject: { to: "writer/sections.hero.copy", rel: "input" }, decider: "owner", default: "a",
    options: [{ id: "a", summary: "option a" }, { id: "b", summary: "option b" }],
    events: [{ at: AT, op: "raised", by: "code:clossys test" }],
  };
  const ledgerEntry = { schema: "clossys.ledger-entry/1", id: LEDGER_ID, kind: "ledger-entry", status: "done", outcome: "test outcome" };
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys/clossys.config.ts"), "export default {};\n");
  put(QUEUE_REL, queueEntry);
  put(LEDGER_REL, ledgerEntry);
  const commit = (message: string): void => { git("add", "-A"); git("commit", "-q", "--allow-empty", "-m", message); };
  commit("raise");
  return {
    top, root, git, commit, queueEntry, ledgerEntry,
    put,
    read(rel: string): any { return JSON.parse(readFileSync(join(root, rel), "utf8")); },
  };
}

const details = (run: { findings: readonly { detail: string }[] }): string => run.findings.map(finding => finding.detail).join("; ");

describe("ledger.append-only", () => {
  it("fails outside a git repository instead of skipping", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "append-only-nogit-")));
    roots.push(root);
    const run = checkLedgerAppendOnly(root);
    expect(run).toMatchObject({ check: LEDGER_APPEND_ONLY, status: "fail" });
    expect(details(run)).toContain("not inside a git repository");
  });

  it("passes a history that only adds entries and appends an answer through clossys answer", () => {
    const r = repo();
    answerQueueEntry(r.root, { entry: QUEUE_ID, answer: "b", by: "owner", via: "chat", quote: "test quote" }, new Date("2026-11-20T09:00:00Z"));
    expect(checkLedgerAppendOnly(r.root)).toEqual({ check: LEDGER_APPEND_ONLY, status: "pass", findings: [] }); // uncommitted append
    r.commit("answer");
    r.put("clossys/agents/producer/ledger.refine/entries/20261120T0900Z-run.json", { ...r.ledgerEntry, id: "20261120T0900Z-run" });
    r.commit("another run");
    expect(checkLedgerAppendOnly(r.root)).toEqual({ check: LEDGER_APPEND_ONLY, status: "pass", findings: [] });
  });

  // Mutation: a ledger line edited or removed in a later commit.
  it("fails a ledger entry edited in a later commit", () => {
    const r = repo();
    r.put(LEDGER_REL, { ...r.ledgerEntry, outcome: "rewritten" });
    r.commit("edit ledger");
    const run = checkLedgerAppendOnly(r.root);
    expect(run.status).toBe("fail");
    expect(run.findings[0]).toMatchObject({ subject: `producer/ledger.refine#${LEDGER_ID}`, detail: expect.stringContaining("edits a ledger entry") as unknown as string });
  });

  it("fails a ledger entry or a queue entry deleted in a later commit", () => {
    const r = repo();
    r.git("rm", "-q", `site/${LEDGER_REL}`, `site/${QUEUE_REL}`);
    r.commit("delete");
    const run = checkLedgerAppendOnly(r.root);
    expect(run.findings.map(finding => finding.subject).sort()).toEqual([`producer/ledger.refine#${LEDGER_ID}`, `producer/queue.approve#${QUEUE_ID}`]);
    expect(details(run)).toContain("deletes the entry");
  });

  it("fails a queue event edited or removed in a later commit", () => {
    const edited = repo();
    answerQueueEntry(edited.root, { entry: QUEUE_ID, answer: "b", by: "owner", via: "chat", quote: "test quote" }, new Date("2026-11-20T09:00:00Z"));
    edited.commit("answer");
    const answered = edited.read(QUEUE_REL);
    edited.put(QUEUE_REL, { ...answered, events: [answered.events[0], { ...answered.events[1], answer: "a" }] });
    edited.commit("rewrite the answer");
    expect(details(checkLedgerAppendOnly(edited.root))).toContain("events[1] was edited");

    const removed = repo();
    answerQueueEntry(removed.root, { entry: QUEUE_ID, answer: "b", by: "owner", via: "chat", quote: "test quote" }, new Date("2026-11-20T09:00:00Z"));
    removed.commit("answer");
    removed.put(QUEUE_REL, { ...removed.queueEntry });
    removed.commit("drop the answer");
    const run = checkLedgerAppendOnly(removed.root);
    expect(details(run)).toContain("events lost 1 item");
    expect(details(run)).toContain("only an open entry changes status");
  });

  it("fails an edited ask and an uncommitted rewrite in the working tree", () => {
    const r = repo();
    r.put(QUEUE_REL, { ...r.queueEntry, ask: "rewritten ask" });
    const run = checkLedgerAppendOnly(r.root);
    expect(run.findings).toEqual([{ check: LEDGER_APPEND_ONLY, subject: `producer/queue.approve#${QUEUE_ID}`, detail: "the working tree: ask was edited" }]);
    r.commit("edit ask");
    expect(details(checkLedgerAppendOnly(r.root))).toMatch(/^commit [0-9a-f]{12}: ask was edited$/);
  });

  it("fails a rewrite that came in through a merged branch", () => {
    const r = repo();
    r.git("switch", "-q", "-c", "side");
    r.put(LEDGER_REL, { ...r.ledgerEntry, outcome: "rewritten" });
    r.commit("edit on a branch");
    r.git("switch", "-q", "main");
    r.put("clossys/agents/producer/ledger.refine/entries/20261120T0900Z-run.json", { ...r.ledgerEntry, id: "20261120T0900Z-run" });
    r.commit("main moves");
    r.git("-c", "user.name=t", "-c", "user.email=t@t", "merge", "-q", "--no-edit", "side");
    expect(details(checkLedgerAppendOnly(r.root))).toContain("edits a ledger entry");
  });

  it("fails in a shallow clone, whose history it cannot read", () => {
    const r = repo();
    r.put("clossys/agents/producer/ledger.refine/entries/20261120T0900Z-run.json", { ...r.ledgerEntry, id: "20261120T0900Z-run" });
    r.commit("second");
    const clone = realpathSync(mkdtempSync(join(tmpdir(), "append-only-shallow-")));
    roots.push(clone);
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${r.top}`, join(clone, "c")], { stdio: "ignore" });
    expect(details(checkLedgerAppendOnly(join(clone, "c", "site")))).toContain("shallow");
  });
});
