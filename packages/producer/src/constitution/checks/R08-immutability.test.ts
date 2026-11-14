import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContext } from "../context.js";
import { parseNameStatusLog, parseStatus, readCandidateHistory } from "../git.js";
import { cleanSpec, contextOf, expectCatches, writeWorkspace, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import type { CandidateHistory } from "../types.js";
import { R08, editedInPlace, naming } from "./R08-immutability.js";

const clean = () => contextOf(cleanSpec());
const broken = (edit: (spec: WorkspaceSpec) => void) => { const spec = cleanSpec(); edit(spec); return contextOf(spec); };
const BUTTON = "clossys/agents/designer/ui.button/candidates/button-v1.json";
const history = (changes: Record<string, string[]>, dirty: string[] = []): CandidateHistory => ({
  available: true,
  changes: new Map(Object.entries(changes).map(([path, statuses]) => [path, statuses.map((status, index) => ({ commit: `${index}`.repeat(40), status: status as "A" | "M" | "D" | "T" }))])),
  dirty: new Set(dirty),
});

describe("R08.1 naming", () => {
  it("passes leaf-named, kind-extension, unique-version candidates", () => {
    expect(naming(clean())).toEqual([]);
  });

  it("flags a stem that is not the leaf, the wrong extension and a reused version", () => {
    const rows = expectCatches(naming, clean(), broken(spec => {
      const item = spec.designer!["ui.button"]!.candidates!["button-v1.json"];
      spec.designer!["ui.button"]!.candidates = { "button-v1.json": item, "btn-v2.json": { ...(item as object), name: "btn" }, "button-v1.md": "# button\n" };
    }));
    expect(rows.map(row => `${row.candidate}: ${row.reason}`).sort()).toEqual([
      "btn-v2.json: stem btn is not the slot leaf button",
      "button-v1.json: v1 is also used by button-v1.md",
      "button-v1.md: .md is not this kind's extension (.json); v1 is also used by button-v1.json",
    ]);
  });

  it("flags a version reused after retire and a retired name written again", () => {
    const rows = expectCatches(naming, clean(), broken(spec => {
      const slot = spec.designer!["ui.button"]!;
      slot.candidates = { ...slot.candidates, "button-v2.json": { name: "button", type: "registry:ui", files: [] } };
      slot.retired = { "button-v2.json.json": { schema: "clossys.retire/1", slot: "ui.button", candidate: "button-v2.json", sha256: "0".repeat(64), by: "planner", reason: "superseded", at: "2026-11-13T00:00:00Z" } };
    }));
    expect(rows).toEqual([expect.objectContaining({ candidate: "button-v2.json", reason: expect.stringContaining("name was retired and is written again") })]);
  });
});

describe("R08.2 edited in place", () => {
  it("passes candidates added once and never changed", () => {
    expect(editedInPlace(contextOf(cleanSpec(), {}, history({ [BUTTON]: ["A"] })))).toEqual([]);
  });

  it("flags a later modify, a path with no add, and an uncommitted edit", () => {
    const rows = expectCatches(editedInPlace, contextOf(cleanSpec(), {}, history({ [BUTTON]: ["A"] })), contextOf(cleanSpec(), {}, history({
      [BUTTON]: ["A", "M", "M"],
      "clossys/agents/writer/home.hero/candidates/hero-v1.md": ["M"],
    }, ["clossys/agents/director/brand.voice/candidates/voice-v1.md"])));
    expect(rows.map(row => `${row.slot}: ${row.reason.split(" (")[0]}`).sort()).toEqual([
      "brand.voice: has uncommitted edits",
      "home.hero: history has no commit that added it",
      "ui.button: edited in 2 commits after the commit that added it",
    ]);
  });

  it("never passes when history is unavailable", () => {
    const rows = editedInPlace(contextOf(cleanSpec(), {}, { available: false, error: "not a git repository", changes: new Map(), dirty: new Set() }));
    expect(rows).toEqual([expect.objectContaining({ check: "R08.2", agent: "*", reason: "cannot prove immutability: not a git repository" })]);
  });

  it("reads real git history: an in-place edit after the creating commit is flagged", () => {
    const { root, consumer } = writeWorkspace(cleanSpec());
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "pipe" });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "add");
    expect(editedInPlace(buildContext(root, consumer))).toEqual([]);
    writeFileSync(join(root, BUTTON), "{\"name\":\"button\",\"files\":[]}\n");
    expect(editedInPlace(buildContext(root, consumer))).toEqual([expect.objectContaining({ slot: "ui.button", reason: "has uncommitted edits" })]);
    git("commit", "-qam", "edit in place");
    const rows = editedInPlace(buildContext(root, consumer));
    expect(rows).toEqual([expect.objectContaining({ slot: "ui.button", reason: expect.stringMatching(/^edited in 1 commit after the commit that added it/) })]);
    expect(readCandidateHistory(root, consumer).changes.get(BUTTON)?.map(change => change.status)).toEqual(["A", "M"]);
  });

  it("parses name-status logs oldest first and porcelain status", () => {
    const log = "\0bbb\n\nM\tclossys/a.json\n\0aaa\n\nA\tclossys/a.json\nA\tclossys/b.md\n";
    const parsed = parseNameStatusLog(log);
    expect(parsed.get("clossys/a.json")).toEqual([{ commit: "aaa", status: "A" }, { commit: "bbb", status: "M" }]);
    expect(parsed.get("clossys/b.md")).toEqual([{ commit: "aaa", status: "A" }]);
    expect([...parseStatus(" M clossys/a.json\0A  clossys/c.json\0")]).toEqual(["clossys/a.json"]);
  });

  it("keeps R08.3 pending", () => {
    expect(R08.checks["R08.3"]!(clean())).toEqual([expect.objectContaining({ pending: true })]);
  });
});
