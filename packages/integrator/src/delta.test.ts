import { describe, expect, it } from "vitest";
import { emitCurrencyDelta, type EmitCurrencyDeltaInput, type InventoryDocument, type InventoryPackageEntry } from "./delta.js";
import type { CurrencySeverity, PackageCurrency } from "./currency.js";

function behind(name: string, installedVersion: string, latestVersion: string, severity: CurrencySeverity): PackageCurrency {
  return { state: "behind", name, installedVersion, latestVersion, severity };
}

function current(name: string, installedVersion = "1.0.0"): PackageCurrency {
  return { state: "current", name, installedVersion };
}

// ---------------------------------------------------------------------------
// document envelope
// ---------------------------------------------------------------------------

describe("emitCurrencyDelta -- document envelope", () => {
  it("always sets schemaVersion to 1", () => {
    const document = emitCurrencyDelta({ repositories: [] });
    expect(document.schemaVersion).toBe(1);
  });

  it("serializes a caller-supplied repository id, in the order the caller supplied", () => {
    const document = emitCurrencyDelta({
      repositories: [
        { id: "repo-one", statuses: [] },
        { id: "repo-two", statuses: [] },
      ],
    });
    expect(document.repositories.map((repository) => repository.id)).toEqual(["repo-one", "repo-two"]);
  });

  it("produces an empty packages list for a repository whose judgments carry no delta", () => {
    const document = emitCurrencyDelta({ repositories: [{ id: "r1", statuses: [] }] });
    expect(document.repositories[0]?.packages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// judged state to entry mapping
// ---------------------------------------------------------------------------

describe("emitCurrencyDelta -- judged state to entry mapping", () => {
  it("maps a behind package to an entry carrying its target version and no wiring", () => {
    const document = emitCurrencyDelta({
      repositories: [{ id: "r1", statuses: [behind("pkg", "1.0.0", "2.0.0", "major")] }],
    });
    expect(document.repositories[0]?.packages).toEqual([{ name: "pkg", version: "2.0.0" }]);
  });

  it("carries the target version for a behind package at every graded severity, including patch", () => {
    const document = emitCurrencyDelta({
      repositories: [{ id: "r1", statuses: [behind("pkg", "1.0.0", "1.0.1", "patch")] }],
    });
    expect(document.repositories[0]?.packages).toEqual([{ name: "pkg", version: "1.0.1" }]);
  });

  it("maps an extra package to an entry with wiring 'unknown' and no version", () => {
    const document = emitCurrencyDelta({
      repositories: [{ id: "r1", statuses: [{ state: "extra", name: "stray", installedVersion: "3.1.4" }] }],
    });
    expect(document.repositories[0]?.packages).toEqual([{ name: "stray", wiring: "unknown" }]);
  });

  it("maps opted-out-and-installed to the same shape as extra: wiring 'unknown', no version", () => {
    const document = emitCurrencyDelta({
      repositories: [{ id: "r1", statuses: [{ state: "opted-out-and-installed", name: "declined", installedVersion: "1.2.3", reason: "not adopted here" }] }],
    });
    expect(document.repositories[0]?.packages).toEqual([{ name: "declined", wiring: "unknown" }]);
  });

  it("serializes none of the judged-clean or unjudged states as entries", () => {
    const statuses: PackageCurrency[] = [
      current("held-current"),
      { state: "absent-with-reason", name: "decided-absent", reason: "not used here" },
      { state: "absent-without-reason", name: "unexplained-absent" },
      { state: "unreachable", name: "unprobed" },
      { state: "unauthenticated", name: "credential-blind" },
      { state: "indeterminate", name: "unparseable", reason: "version-unparseable" },
      { state: "indeterminate", name: "uncomparable", reason: "version-not-comparable" },
    ];
    expect(emitCurrencyDelta({ repositories: [{ id: "r1", statuses }] }).repositories[0]?.packages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// document shape
// ---------------------------------------------------------------------------

describe("emitCurrencyDelta -- document shape", () => {
  it("keeps entries shaped as the shared v1 contract, key by key", () => {
    const statuses: PackageCurrency[] = [behind("a", "1.0.0", "2.0.0", "major"), { state: "extra", name: "b", installedVersion: "0.9.0" }];
    const document: InventoryDocument = emitCurrencyDelta({ repositories: [{ id: "r1", statuses }] });
    const entries: readonly InventoryPackageEntry[] = document.repositories[0]?.packages ?? [];
    expect(entries).toEqual([
      { name: "a", version: "2.0.0" },
      { name: "b", wiring: "unknown" },
    ]);
  });

  it("emits within-repository order matching the judged order, reordering nothing", () => {
    const statuses: PackageCurrency[] = [
      { state: "extra", name: "first-extra", installedVersion: "1.0.0" },
      behind("then-behind", "1.0.0", "3.0.0", "major"),
      { state: "opted-out-and-installed", name: "last-contradiction", installedVersion: "2.0.0", reason: "recorded" },
    ];
    const document = emitCurrencyDelta({ repositories: [{ id: "r1", statuses }] });
    expect(document.repositories[0]?.packages.map((entry) => entry.name)).toEqual(["first-extra", "then-behind", "last-contradiction"]);
  });
});

// ---------------------------------------------------------------------------
// per-repository isolation
// ---------------------------------------------------------------------------

describe("emitCurrencyDelta -- per-repository isolation", () => {
  it("never lets one repository's statuses bleed into another's entry list", () => {
    const input: EmitCurrencyDeltaInput = {
      repositories: [
        { id: "alpha", statuses: [behind("pkg", "1.0.0", "1.1.0", "minor")] },
        { id: "beta", statuses: [{ state: "extra", name: "other", installedVersion: "2.0.0" }] },
      ],
    };
    const document = emitCurrencyDelta(input);
    expect(document.repositories[0]?.packages).toEqual([{ name: "pkg", version: "1.1.0" }]);
    expect(document.repositories[1]?.packages).toEqual([{ name: "other", wiring: "unknown" }]);
  });
});
