import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleDigest } from "./change-set-digest.js";
import { validateApplyBundle, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { ApplyBundle, RepositoryChangeSet } from "./change-set-contract.js";
import { BUNDLE_STORE_REL, CHANGE_SET_STORE_REL, readStoredApplyBundle, readStoredChangeSet, storeApplyBundle, storeChangeSet } from "./apply-store.js";

/*
 * Issue #1178. The hub's two apply stores: append-only, content-addressed by
 * digest. Reading corpus files here is test-only.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");
const corpus = JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as {
  changeSets: { name: string; valid: boolean; changeSet: RepositoryChangeSet }[];
};
const byName = (name: string) => corpus.changeSets.find((entry) => entry.name === name)!;

// Both entries are `valid: true` in the corpus, so they validate against the
// change-set contract as they stand -- the same "simplest if its entries
// validate" fixtures apply-bundle-contract.test.ts builds its own bundle from.
const SET = byName("setup-site").changeSet;
const OTHER_SET = byName("apply-after-setup").changeSet;
// Asserted once, at module load, rather than inside a test: a fixture drift
// here would otherwise fail every test below for an unrelated reason.
if (!validateRepositoryChangeSet(SET).valid || !validateRepositoryChangeSet(OTHER_SET).valid) {
  throw new Error("the fixtures this suite relies on no longer validate against the change-set contract");
}

const PLAN_DIGEST = SET.planDigest;
/** A single-repository, report-mode bundle built the way apply-bundle-contract.test.ts's own BUNDLE is: known to validate. */
const BUNDLE: ApplyBundle = {
  schemaVersion: 1,
  kind: "clossys.apply-bundle",
  mode: "report",
  plan: { path: "clossys/advisor/plan.json", digest: PLAN_DIGEST, committed: true },
  snapshot: null,
  engine: SET.engine,
  authorization: null,
  computedAt: "2026-09-24T12:00:00Z",
  repositories: [{ id: SET.repository.id, verdict: "satisfied", phase: SET.phase, changeSet: SET.changeSetDigest, checks: [{ check: "V6", verdict: "satisfied" }] }],
  bundleDigest: bundleDigest(PLAN_DIGEST, [{ id: SET.repository.id, changeSetDigest: SET.changeSetDigest }]),
};
if (!validateApplyBundle(BUNDLE).valid) throw new Error("this suite's own bundle fixture does not validate against the apply-bundle contract");

let hub: string;

beforeEach(() => {
  hub = mkdtempSync(join(tmpdir(), "apply-store-"));
});

afterEach(() => {
  rmSync(hub, { recursive: true, force: true });
});

describe("storeChangeSet / readStoredChangeSet", () => {
  it("round-trips a valid change set", () => {
    const path = storeChangeSet(hub, SET);
    expect(path).toBe(join(hub, CHANGE_SET_STORE_REL, `${SET.changeSetDigest.slice("sha256:".length)}.json`));
    expect(existsSync(path)).toBe(true);
    expect(readStoredChangeSet(hub, SET.changeSetDigest)).toEqual(SET);
  });

  it("reads null for a digest nothing was ever stored under", () => {
    expect(readStoredChangeSet(hub, OTHER_SET.changeSetDigest)).toBeNull();
  });

  it("reads null for a file named for another digest (renamed after writing)", () => {
    storeChangeSet(hub, SET);
    const directory = join(hub, CHANGE_SET_STORE_REL);
    const wrongName = `${OTHER_SET.changeSetDigest.slice("sha256:".length)}.json`;
    // Move SET's own bytes under a name that claims a different digest.
    const bytes = readFileSync(join(directory, `${SET.changeSetDigest.slice("sha256:".length)}.json`));
    writeFileSync(join(directory, wrongName), bytes);
    expect(readStoredChangeSet(hub, OTHER_SET.changeSetDigest)).toBeNull();
  });

  it("reads null for tampered bytes under the right name", () => {
    storeChangeSet(hub, SET);
    const path = join(hub, CHANGE_SET_STORE_REL, `${SET.changeSetDigest.slice("sha256:".length)}.json`);
    // repository.baseCommit is inside the digest subject; the stored changeSetDigest field is left as it was, so it no longer recomputes.
    const tampered: RepositoryChangeSet = { ...SET, repository: { ...SET.repository, baseCommit: "f".repeat(40) } };
    writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`);
    expect(readStoredChangeSet(hub, SET.changeSetDigest)).toBeNull();
  });

  it("is a no-op storing the same set again, byte for byte", () => {
    const path = storeChangeSet(hub, SET);
    const before = statSync(path);
    expect(() => storeChangeSet(hub, SET)).not.toThrow();
    const after = statSync(path);
    expect(after.size).toBe(before.size);
    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(SET, null, 2)}\n`);
  });

  it("refuses different bytes stored under the same digest name", () => {
    storeChangeSet(hub, SET);
    const path = join(hub, CHANGE_SET_STORE_REL, `${SET.changeSetDigest.slice("sha256:".length)}.json`);
    const before = readFileSync(path, "utf8");
    // Same changeSetDigest field, but a document that is not byte-identical
    // to what is already stored (an extra, contract-tolerated tooling entry).
    const collided: RepositoryChangeSet = { ...SET, tooling: [{ tool: "node", version: "24.0.0" }] };
    expect(() => storeChangeSet(hub, collided)).toThrow(TypeError);
    expect(readFileSync(path, "utf8")).toBe(before);
    // No leftover temporary file after the refusal.
    expect(readdirSync(join(hub, CHANGE_SET_STORE_REL)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("throws before storing a change set that does not validate", () => {
    const invalid: RepositoryChangeSet = { ...SET, changeSetDigest: `sha256:${"0".repeat(64)}` };
    expect(() => storeChangeSet(hub, invalid)).toThrow(TypeError);
    expect(existsSync(join(hub, CHANGE_SET_STORE_REL))).toBe(false);
  });

  it("a malformed digest argument throws before any path is joined, and creates nothing", () => {
    for (const bad of ["sha256:../x", `sha256:${"A".repeat(64)}`, "0".repeat(64), `sha256:${"0".repeat(63)}`, "sha256:"]) {
      expect(() => readStoredChangeSet(hub, bad)).toThrow(TypeError);
    }
    expect(existsSync(hub)).toBe(true);
    expect(readdirSync(hub)).toEqual([]);
  });
});

describe("storeApplyBundle / readStoredApplyBundle", () => {
  it("round-trips a valid apply bundle", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    expect(path).toBe(join(hub, BUNDLE_STORE_REL, `${BUNDLE.bundleDigest.slice("sha256:".length)}.json`));
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toEqual(BUNDLE);
  });

  it("reads null for a digest nothing was ever stored under", () => {
    expect(readStoredApplyBundle(hub, SET.changeSetDigest)).toBeNull();
  });

  it("reads null for a file named for another digest", () => {
    storeApplyBundle(hub, BUNDLE);
    const directory = join(hub, BUNDLE_STORE_REL);
    const bytes = readFileSync(join(directory, `${BUNDLE.bundleDigest.slice("sha256:".length)}.json`));
    const otherDigest = `sha256:${randomBytes(32).toString("hex")}`;
    writeFileSync(join(directory, `${otherDigest.slice("sha256:".length)}.json`), bytes);
    expect(readStoredApplyBundle(hub, otherDigest)).toBeNull();
  });

  it("reads null for tampered bytes under the right name", () => {
    storeApplyBundle(hub, BUNDLE);
    const path = join(hub, BUNDLE_STORE_REL, `${BUNDLE.bundleDigest.slice("sha256:".length)}.json`);
    // The repository's changeSet is part of the bundle digest; the stored bundleDigest field is left as it was, so it no longer recomputes.
    const tampered: ApplyBundle = {
      ...BUNDLE,
      repositories: [{ ...(BUNDLE.repositories[0] as Extract<ApplyBundle["repositories"][number], { changeSet: string }>), changeSet: OTHER_SET.changeSetDigest }],
    };
    writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`);
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toBeNull();
  });

  it("is a no-op storing the same bundle again, byte for byte", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    const before = statSync(path);
    expect(() => storeApplyBundle(hub, BUNDLE)).not.toThrow();
    const after = statSync(path);
    expect(after.size).toBe(before.size);
  });

  it("refuses different bytes stored under the same digest name", () => {
    storeApplyBundle(hub, BUNDLE);
    const path = join(hub, BUNDLE_STORE_REL, `${BUNDLE.bundleDigest.slice("sha256:".length)}.json`);
    const before = readFileSync(path, "utf8");
    const collided: ApplyBundle = { ...BUNDLE, plan: { ...BUNDLE.plan, committed: false } };
    expect(() => storeApplyBundle(hub, collided)).toThrow(TypeError);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(readdirSync(join(hub, BUNDLE_STORE_REL)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("throws before storing a bundle that does not validate", () => {
    const invalid = { ...BUNDLE, mode: "not-a-mode" } as unknown as ApplyBundle;
    expect(() => storeApplyBundle(hub, invalid)).toThrow(TypeError);
    expect(existsSync(join(hub, BUNDLE_STORE_REL))).toBe(false);
  });

  it("a malformed digest argument throws before any path is joined, and creates nothing", () => {
    for (const bad of ["sha256:../x", `sha256:${"A".repeat(64)}`, "0".repeat(64), `sha256:${"0".repeat(63)}`, "sha256:"]) {
      expect(() => readStoredApplyBundle(hub, bad)).toThrow(TypeError);
    }
    expect(existsSync(hub)).toBe(true);
    expect(readdirSync(hub)).toEqual([]);
  });
});
