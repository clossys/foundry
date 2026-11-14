import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContext } from "../context.js";
import { parseNameStatusLog, parseStatus, readCandidateHistory } from "../git.js";
import { AT, cleanSpec, contextOf, expectCatches, writeWorkspace, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import type { CandidateHistory, PathChange } from "../types.js";
import { gitBlobId, MIGRATIONS_FILE, MIGRATIONS_SCHEMA, type MigratedEvent } from "../../records/migrations.js";
import { sha256Hex } from "../../records/hash.js";
import { appendMigrationEvents } from "../../records/slot-write.js";
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

  describe("a recorded format-only migration (clossys/evidence/migrations.json)", () => {
    const BUTTON_FILE = "agents/designer/ui.button/candidates/button-v1.json";
    const blob = (text: string) => gitBlobId(text);
    const V1 = "{\"v\":1}\n", V2 = "{\"v\":2}\n", V3 = "{\"v\":3}\n", V4 = "{\"v\":4}\n";
    const event = (from: string, to: string, extra: Partial<MigratedEvent> = {}): MigratedEvent => ({
      type: "migrated", migration: "citations-to-slots", file: BUTTON_FILE,
      from: { sha256: sha256Hex(from), blob: blob(from) }, to: { sha256: sha256Hex(to), blob: blob(to) }, by: "planner", at: AT, ...extra,
    });
    /** A context whose history is `steps` (each a status with the blobs before and after) and whose manifest holds `events`. */
    const migratedContext = (steps: PathChange[], events: unknown) => {
      const { root, consumer } = writeWorkspace(cleanSpec());
      if (events !== undefined) { mkdirSync(join(consumer, "evidence"), { recursive: true }); writeFileSync(join(consumer, MIGRATIONS_FILE), typeof events === "string" ? events : JSON.stringify({ schema: MIGRATIONS_SCHEMA, events })); }
      const changes: CandidateHistory = { available: true, changes: new Map([[BUTTON, steps]]), dirty: new Set() };
      return buildContext(root, consumer, { history: () => changes });
    };
    const step = (index: number, status: PathChange["status"], from: string | null, to: string): PathChange => ({ commit: `${index}`.repeat(40), status, from: from === null ? "0".repeat(40) : blob(from), to: blob(to) });

    it("passes a later change the manifest records with the same blob ids", () => {
      expect(editedInPlace(migratedContext([step(1, "A", null, V1), step(2, "M", V1, V2)], [event(V1, V2)]))).toEqual([]);
    });

    it("still flags an unexplained edit after the migration (the mutation the explanation must not hide)", () => {
      const rows = expectCatches(editedInPlace,
        migratedContext([step(1, "A", null, V1), step(2, "M", V1, V2)], [event(V1, V2)]),
        migratedContext([step(1, "A", null, V1), step(2, "M", V1, V2), step(3, "M", V2, V3)], [event(V1, V2)]));
      expect(rows).toEqual([expect.objectContaining({ check: "R08.2", slot: "ui.button", reason: expect.stringMatching(/^edited in 1 commit after the commit that added it .*latest 333333333/) })]);
    });

    it("still flags an edit in place before the migration: the migration explains only its own change", () => {
      const rows = editedInPlace(migratedContext([step(1, "A", null, V1), step(2, "M", V1, V3), step(3, "M", V3, V4)], [event(V3, V4)]));
      expect(rows).toEqual([expect.objectContaining({ slot: "ui.button", reason: expect.stringMatching(/^edited in 1 commit .*latest 222222222/) })]);
    });

    it("explains nothing when the blob ids, the file or the migration differ, or the change carries no blob ids", () => {
      const history = [step(1, "A", null, V1), step(2, "M", V1, V2)];
      for (const events of [[event(V1, V3)], [event(V3, V2)], [event(V1, V2, { file: "agents/designer/ui.button/candidates/button-v2.json" })]]) {
        expect(editedInPlace(migratedContext(history, events)), JSON.stringify(events[0]!.file)).toEqual([expect.objectContaining({ slot: "ui.button", reason: expect.stringMatching(/^edited in 1 commit/) })]);
      }
      const unknown = editedInPlace(migratedContext(history, [{ ...event(V1, V2), migration: "hand-edit" }]));
      expect(unknown.map(row => row.reason)).toEqual([expect.stringMatching(/^migration manifest invalid.*migration is not one of citations-to-slots/), expect.stringMatching(/^edited in 1 commit/)]);
      const noBlobs = editedInPlace(migratedContext([{ commit: "1".repeat(40), status: "A" }, { commit: "2".repeat(40), status: "M" }], [event(V1, V2)]));
      expect(noBlobs).toEqual([expect.objectContaining({ reason: expect.stringMatching(/^edited in 1 commit/) })]);
    });

    it("reports an unreadable manifest and lets it explain nothing", () => {
      const rows = editedInPlace(migratedContext([step(1, "A", null, V1), step(2, "M", V1, V2)], "{not json"));
      expect(rows.map(row => `${row.slot}: ${row.reason}`)).toEqual([expect.stringMatching(/^\*: migration manifest invalid, it explains no change: not JSON/), expect.stringMatching(/^ui\.button: edited in 1 commit after the commit that added it/)]);
    });

    it("reads real git history: a recorded rewrite passes, a later unrecorded edit fails", () => {
      const { root, consumer } = writeWorkspace(cleanSpec());
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "pipe" });
      git("init", "-q");
      git("add", "-A");
      git("commit", "-qm", "add");
      const path = join(root, BUTTON);
      const before = readFileSync(path);
      const after = `${before.toString("utf8").trimEnd()}\n\n`;
      writeFileSync(path, after);
      const recorded = appendMigrationEvents(consumer, "citations-to-slots", [{ file: BUTTON_FILE, from: { sha256: sha256Hex(before), blob: gitBlobId(before) }, to: { sha256: sha256Hex(after), blob: gitBlobId(after) } }], { by: "planner", at: AT });
      expect(recorded).toHaveLength(1);
      // Recording the same rewrite again adds nothing.
      expect(appendMigrationEvents(consumer, "citations-to-slots", [{ file: BUTTON_FILE, from: recorded[0]!.from, to: recorded[0]!.to }], { by: "planner", at: AT })).toEqual([]);
      git("add", "-A");
      git("commit", "-qm", "migrate");
      expect(readCandidateHistory(root, consumer).changes.get(BUTTON)?.map(change => [change.status, change.to])).toEqual([["A", gitBlobId(before)], ["M", gitBlobId(after)]]);
      expect(editedInPlace(buildContext(root, consumer))).toEqual([]);
      writeFileSync(path, `${after}\n`);
      git("commit", "-qam", "edit after the migration");
      expect(editedInPlace(buildContext(root, consumer))).toEqual([expect.objectContaining({ slot: "ui.button", reason: expect.stringMatching(/^edited in 1 commit after the commit that added it/) })]);
    });
  });

  it("parses raw logs with blob ids", () => {
    const a = "a".repeat(40), b = "b".repeat(40), zero = "0".repeat(40);
    const log = `\0bbb\n\n:100644 100644 ${a} ${b} M\tclossys/a.json\n\0aaa\n\n:000000 100644 ${zero} ${a} A\tclossys/a.json\n`;
    expect(parseNameStatusLog(log).get("clossys/a.json")).toEqual([{ commit: "aaa", status: "A", from: zero, to: a }, { commit: "bbb", status: "M", from: a, to: b }]);
  });

  it("keeps R08.3 pending", () => {
    expect(R08.checks["R08.3"]!(clean())).toEqual([expect.objectContaining({ pending: true })]);
  });
});
