import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ApprovalBinding, RepositoryChangeSet } from "./change-set-contract.js";
import { changeSetDigest } from "./change-set-digest.js";
import { ledgerSuccession, renderInstalledLedger, serializeInstalledLedger } from "./ledger-contract.js";
import type { InstalledLedger, LedgerPackageIdentity } from "./ledger-contract.js";

/*
 * Issue #1178. renderInstalledLedger(), the installed-state ledger
 * contract's RENDER section: the ledger a change set writes over a previous
 * one. Checked against the shared corpus installed-ledger.fixture.json's
 * `renders`, whose expected ledgers (and their SHA-256) were computed
 * independently of this package, and against apply-change-set-digest.fixture.json
 * for the change sets it renders from. Reading repository files here is
 * test-only.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");
const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const clone = <T>(value: T): T => structuredClone(value);

interface RenderCase {
  name: string;
  previous: string | null;
  changeSet: string;
  binding: ApprovalBinding;
  planPackages: (LedgerPackageIdentity & { act: "install" | "pin-starter" })[];
  ledger: string;
}
interface Corpus {
  ledgers: { name: string; valid: boolean; ledger: InstalledLedger; sha256?: string }[];
  renders: RenderCase[];
}
const CORPUS = JSON.parse(read("docs/contracts/installed-ledger.fixture.json")) as Corpus;
const SETS = (JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as { changeSets: { name: string; changeSet: RepositoryChangeSet }[] }).changeSets;
const ledgerNamed = (name: string) => CORPUS.ledgers.find((entry) => entry.name === name)!.ledger;
const setNamed = (name: string) => SETS.find((entry) => entry.name === name)!.changeSet;

describe("renderInstalledLedger (RENDER)", () => {
  it("reproduces every corpus render's ledger byte for byte, and its SHA-256", () => {
    for (const render of CORPUS.renders) {
      const previous = render.previous === null ? null : ledgerNamed(render.previous);
      const set = setNamed(render.changeSet);
      const bytes = renderInstalledLedger(previous, set, render.binding, render.planPackages);
      const expectedLedger = ledgerNamed(render.ledger);
      const expectedEntry = CORPUS.ledgers.find((entry) => entry.name === render.ledger)!;
      expect(bytes, render.name).toBe(serializeInstalledLedger(expectedLedger));
      expect(sha(bytes), render.name).toBe(expectedEntry.sha256);
    }
  });

  it("gives an admitted render's ledger an admitted succession over its previous", () => {
    const render = CORPUS.renders.find((entry) => entry.name === "admitted-apply")!;
    const previous = ledgerNamed(render.previous!);
    const set = setNamed(render.changeSet);
    const bytes = renderInstalledLedger(previous, set, render.binding, render.planPackages);
    const result = ledgerSuccession(Buffer.from(serializeInstalledLedger(previous), "utf8"), Buffer.from(bytes, "utf8"));
    expect(result).toEqual({ change: "next-generation", admission: "admitted", violations: [] });
  });

  it("throws when the change set's generation does not match previous's, naming no value", () => {
    const render = CORPUS.renders.find((entry) => entry.name === "setup")!;
    const set = setNamed(render.changeSet); // ledger.generation: 0
    const previous = ledgerNamed("setup-generation-1"); // generation: 1
    expect(() => renderInstalledLedger(previous, set, render.binding, render.planPackages)).toThrow(TypeError);
    expect(() => renderInstalledLedger(previous, set, render.binding, render.planPackages)).not.toThrow(/example-owner|R_example|sha256:|sha512-/);
  });

  it("throws when previous's repository differs from the set's, naming no value", () => {
    const render = CORPUS.renders.find((entry) => entry.name === "admitted-apply")!;
    const set = setNamed(render.changeSet);
    const previous = clone(ledgerNamed(render.previous!));
    previous.repository = { ...previous.repository, id: "example-owner/other" };
    expect(() => renderInstalledLedger(previous, set, render.binding, render.planPackages)).toThrow(TypeError);
    const previousNodeChanged = clone(ledgerNamed(render.previous!));
    previousNodeChanged.repository = { ...previousNodeChanged.repository, nodeId: "R_exampleOther9" };
    expect(() => renderInstalledLedger(previousNodeChanged, set, render.binding, render.planPackages)).toThrow(TypeError);
  });

  it("throws when an apply set at generation 0 writes a whole file with no previous ledger", () => {
    const render = CORPUS.renders.find((entry) => entry.name === "setup")!;
    const set = setNamed("apply-with-packages");
    expect(set.phase).toBe("apply");
    expect(set.ledger.generation).toBe(0);
    expect(set.files.some((file) => !("derived" in file) && file.after !== null)).toBe(true);
    expect(() => renderInstalledLedger(null, set, render.binding, render.planPackages)).toThrow(/files\[\d+\]/);
  });

  it("throws when an apply set updates a whole file at a path previous holds no row for", () => {
    const render = CORPUS.renders.find((entry) => entry.name === "admitted-apply")!;
    const previous = ledgerNamed(render.previous!);
    const base = setNamed(render.changeSet);
    const adopted = clone(base);
    const beforeDigest = base.files.find((file) => !("derived" in file))!.after as string;
    const afterDigest = `sha256:${"a".repeat(64)}`;
    adopted.files = [...adopted.files, { path: "clossys/unowned-note.txt", mode: "100644", before: beforeDigest, after: afterDigest, item: "brief" }];
    adopted.changeSetDigest = changeSetDigest(adopted);
    expect(() => renderInstalledLedger(previous, adopted, render.binding, render.planPackages)).toThrow(/files\[\d+\]/);
  });

  it("throws when an apply set's whole-file before is not previous's after at that path", () => {
    const render = CORPUS.renders.find((entry) => entry.name === "admitted-apply")!;
    const previous = ledgerNamed(render.previous!);
    const base = setNamed(render.changeSet);
    const mismatched = clone(base);
    const whole = mismatched.files.find((file) => !("derived" in file) && file.path === "clossys/brief.json")!;
    whole.before = `sha256:${"b".repeat(64)}`;
    mismatched.changeSetDigest = changeSetDigest(mismatched);
    expect(() => renderInstalledLedger(previous, mismatched, render.binding, render.planPackages)).toThrow(/files\[\d+\]/);
  });

  it("throws when an apply set keeps a whole file at a path previous holds no row for -- an adoption row only a setup set may write", () => {
    const render = CORPUS.renders.find((entry) => entry.name === "admitted-apply")!;
    const previous = ledgerNamed(render.previous!);
    const base = setNamed(render.changeSet);
    // Add a keep (before === after) at a path previous has no row for; recompute the digest so the set stays self-consistent.
    const adopted = clone(base);
    const extraDigest = base.files.find((file) => !("derived" in file))!.after as string;
    adopted.files = [...adopted.files, { path: "clossys/unowned-note.txt", mode: "100644", before: extraDigest, after: extraDigest, item: "brief" }];
    adopted.changeSetDigest = changeSetDigest(adopted);
    expect(() => renderInstalledLedger(previous, adopted, render.binding, render.planPackages)).toThrow(TypeError);
  });

  describe("the one apply-phase add: the Launcher guide", () => {
    const GUIDE = "clossys/AGENTS.md";
    const render = () => CORPUS.renders.find((entry) => entry.name === "admitted-apply")!;
    const previousLedger = () => clone(ledgerNamed(render().previous!));
    /** The admitted-apply set with one more whole file, before null, as an apply set over an install that predates the guide would carry. */
    const withAdd = (path: string, patch: { mode?: "100644" | "120000"; before?: string | null } = {}) => {
      const set = clone(setNamed(render().changeSet));
      set.files = [...set.files, { path, mode: patch.mode ?? "100644", before: patch.before === undefined ? null : patch.before, after: sha("added bytes\n"), item: "brief" }];
      set.changeSetDigest = changeSetDigest(set);
      return set;
    };
    const renderOver = (previous: InstalledLedger, set: RepositoryChangeSet) => renderInstalledLedger(previous, set, render().binding, render().planPackages);

    it("adds a row for the guide where previous holds none, and the result is an admitted next generation", () => {
      const previous = previousLedger();
      expect(previous.files.some((row) => row.path.toLowerCase() === GUIDE.toLowerCase())).toBe(false);
      const set = withAdd(GUIDE);
      const bytes = renderOver(previous, set);
      const head = JSON.parse(bytes) as InstalledLedger;
      expect(head.files.filter((row) => row.path === GUIDE)).toEqual([{ path: GUIDE, mode: "100644", after: sha("added bytes\n"), changeSet: set.changeSetDigest }]);
      expect(head.files.filter((row) => row.path !== GUIDE)).toEqual(previous.files);
      expect(ledgerSuccession(Buffer.from(serializeInstalledLedger(previous), "utf8"), Buffer.from(bytes, "utf8"))).toEqual({ change: "next-generation", admission: "admitted", violations: [] });
    });

    it("still refuses an apply-phase add at any other path", () => {
      for (const path of ["clossys/unowned-note.txt", "clossys/AGENTS.md.bak", ".agents/skills/clossys-advisor/SKILL.md", "clossys/agents-guide.md"]) {
        expect(() => renderOver(previousLedger(), withAdd(path)), path).toThrow(/files\[\d+\]/);
      }
    });

    it("refuses the guide add when previous already holds a row for the path, in any letter case", () => {
      for (const rowPath of [GUIDE, "clossys/agents.md"]) {
        const previous = previousLedger();
        previous.files = [...previous.files, { path: rowPath, mode: "100644", after: sha("older guide\n"), changeSet: previous.history[0]!.changeSet }].sort((a, b) => (a.path.toLowerCase() < b.path.toLowerCase() ? -1 : 1));
        expect(() => renderOver(previous, withAdd(GUIDE)), rowPath).toThrow(/files\[\d+\]/);
      }
    });

    it("refuses the guide add as a link, and an update of it (before not null) where previous holds no row", () => {
      expect(() => renderOver(previousLedger(), withAdd(GUIDE, { mode: "120000" }))).toThrow(/files\[\d+\]/);
      expect(() => renderOver(previousLedger(), withAdd(GUIDE, { before: sha("some bytes\n") }))).toThrow(/files\[\d+\]/);
    });

    it("refuses the guide add where there is no previous ledger at all, as it refuses every other add", () => {
      const set = clone(setNamed("apply-with-packages"));
      expect(set.ledger.generation).toBe(0);
      set.files = [...set.files.filter((file) => "derived" in file), { path: GUIDE, mode: "100644", before: null, after: sha("added bytes\n"), item: "brief" }];
      set.changeSetDigest = changeSetDigest(set);
      expect(() => renderInstalledLedger(null, set, render().binding, render().planPackages)).toThrow(/files\[\d+\]/);
    });

    it("still refuses an apply keep at the guide's path where previous holds no row: an adoption only a setup set may write", () => {
      const set = withAdd(GUIDE, { before: sha("added bytes\n") });
      expect(() => renderOver(previousLedger(), set)).toThrow(/keeps a file previous holds no row for/);
    });
  });

  it("throws when a deferred row's planItem names no plan package identity, naming only its position", () => {
    const render = CORPUS.renders.find((entry) => entry.name === "setup")!;
    const set = setNamed(render.changeSet);
    const shortPlanPackages = render.planPackages.filter((entry) => entry.planItem !== set.deferred[0]!.planItem);
    expect(() => renderInstalledLedger(null, set, render.binding, shortPlanPackages)).toThrow(/deferred\[0\]/);
  });

  it("throws before returning anything when the set's own changeSetDigest is wrong", () => {
    const render = CORPUS.renders.find((entry) => entry.name === "setup")!;
    const set = clone(setNamed(render.changeSet));
    set.changeSetDigest = `sha256:${"0".repeat(64)}`;
    expect(() => renderInstalledLedger(null, set, render.binding, render.planPackages)).toThrow(TypeError);
  });
});
