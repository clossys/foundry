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
