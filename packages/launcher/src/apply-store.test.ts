import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleDigest } from "./change-set-digest.js";
import { validateApplyBundle, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { ApplyBundle, RepositoryChangeSet } from "./change-set-contract.js";
import { BUNDLE_STORE_REL, CHANGE_SET_STORE_REL, readStoredApplyBundle, readStoredChangeSet, storeApplyBundle, storeChangeSet } from "./apply-store.js";

/*
 * Issue #1178. The hub's two apply stores, content-addressed by digest: the
 * change-set store is append-only; the bundle store replaces a file only under
 * the same digest (issue #1693). Reading corpus files here is test-only.
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
/** A second bundle, for another plan digest and change set, so it has another digest. */
const OTHER_BUNDLE: ApplyBundle = {
  ...BUNDLE,
  plan: { ...BUNDLE.plan, digest: OTHER_SET.planDigest },
  repositories: [{ id: OTHER_SET.repository.id, verdict: "satisfied", phase: OTHER_SET.phase, changeSet: OTHER_SET.changeSetDigest, checks: [{ check: "V6", verdict: "satisfied" }] }],
  bundleDigest: bundleDigest(OTHER_SET.planDigest, [{ id: OTHER_SET.repository.id, changeSetDigest: OTHER_SET.changeSetDigest }]),
};
if (!validateApplyBundle(OTHER_BUNDLE).valid) throw new Error("this suite's second bundle fixture does not validate against the apply-bundle contract");

let hub: string;

beforeEach(() => {
  // Resolved to its own real path: writeAppendOnly()/readStoredBytes() now refuse a hubDirectory that is not its own
  // realpath (issue #1545 fix 5), and on macOS os.tmpdir() itself sits behind a symbolic link (/var -> /private/var).
  hub = realpathSync(mkdtempSync(join(tmpdir(), "apply-store-")));
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

  it("is a no-op storing the same digest again with an extra tooling entry, leaving the first writer's bytes", () => {
    storeChangeSet(hub, SET);
    const path = join(hub, CHANGE_SET_STORE_REL, `${SET.changeSetDigest.slice("sha256:".length)}.json`);
    const before = readFileSync(path, "utf8");
    const collided: RepositoryChangeSet = { ...SET, tooling: [{ tool: "node", version: "24.0.0" }] };
    expect(() => storeChangeSet(hub, collided)).not.toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("is a no-op storing the same digest again with a different bundle, leaving the first writer's bytes", () => {
    storeChangeSet(hub, SET);
    const path = join(hub, CHANGE_SET_STORE_REL, `${SET.changeSetDigest.slice("sha256:".length)}.json`);
    const before = readFileSync(path, "utf8");
    const collided: RepositoryChangeSet = { ...SET, bundle: OTHER_SET.bundle };
    expect(() => storeChangeSet(hub, collided)).not.toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("refuses different bytes under the same digest name when they do not validate to that digest", () => {
    storeChangeSet(hub, SET);
    const path = join(hub, CHANGE_SET_STORE_REL, `${SET.changeSetDigest.slice("sha256:".length)}.json`);
    const before = readFileSync(path, "utf8");
    const tampered: RepositoryChangeSet = { ...SET, repository: { ...SET.repository, baseCommit: "f".repeat(40) } };
    writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`);
    const collided: RepositoryChangeSet = { ...SET, tooling: [{ tool: "node", version: "24.0.0" }] };
    expect(() => storeChangeSet(hub, collided)).toThrow(TypeError);
    expect(readFileSync(path, "utf8")).toContain("ffffffffffffffffffffffffffffffffffffffff");
    expect(readStoredChangeSet(hub, SET.changeSetDigest)).toBeNull();
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

  const bundleFile = (digest: string): string => join(hub, BUNDLE_STORE_REL, `${digest.slice("sha256:".length)}.json`);
  const bundleBytes = (document: ApplyBundle): string => `${JSON.stringify(document, null, 2)}\n`;
  /** Every file in the bundle store, with its bytes: a change to any other name shows here. */
  const bundleStore = (): Record<string, string> =>
    Object.fromEntries(readdirSync(join(hub, BUNDLE_STORE_REL)).sort().map((name) => [name, readFileSync(join(hub, BUNDLE_STORE_REL, name), "utf8")]));

  it("replaces the stored file with the newest bytes when the same digest is stored with a later clock", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    const later: ApplyBundle = { ...BUNDLE, computedAt: "2026-09-25T00:00:00Z" };
    expect(later.bundleDigest).toBe(BUNDLE.bundleDigest);
    expect(storeApplyBundle(hub, later)).toBe(path);
    expect(readFileSync(path, "utf8")).toBe(bundleBytes(later));
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toEqual(later);
    expect(Object.keys(bundleStore())).toEqual([`${BUNDLE.bundleDigest.slice("sha256:".length)}.json`]);
  });

  it("replaces the stored file with the newest bytes when the same digest is stored with a new authorization or mode, and only that file changes", () => {
    const other = storeApplyBundle(hub, OTHER_BUNDLE);
    const otherBefore = readFileSync(other, "utf8");
    const path = storeApplyBundle(hub, BUNDLE);
    const authorized: ApplyBundle = { ...BUNDLE, authorization: { planDigest: PLAN_DIGEST, expiresAt: "2999-01-01T00:00:00Z" }, computedAt: "2026-09-26T00:00:00Z" };
    expect(validateApplyBundle(authorized).valid).toBe(true);
    expect(authorized.bundleDigest).toBe(BUNDLE.bundleDigest);
    const before = bundleStore();
    storeApplyBundle(hub, authorized);
    const after = bundleStore();
    const name = `${BUNDLE.bundleDigest.slice("sha256:".length)}.json`;
    expect(after[name]).toBe(bundleBytes(authorized));
    expect(after[name]).not.toBe(before[name]);
    const { [name]: _replaced, ...untouchedAfter } = after;
    const { [name]: _was, ...untouchedBefore } = before;
    expect(untouchedAfter).toEqual(untouchedBefore);
    expect(readFileSync(other, "utf8")).toBe(otherBefore);
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toEqual(authorized);
    expect(path).toBe(bundleFile(BUNDLE.bundleDigest));
  });

  it("writes nothing when the same bytes are stored again: the file keeps its inode and modification time", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    const before = statSync(path);
    expect(storeApplyBundle(hub, BUNDLE)).toBe(path);
    const after = statSync(path);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(readdirSync(join(hub, BUNDLE_STORE_REL))).toEqual([`${BUNDLE.bundleDigest.slice("sha256:".length)}.json`]);
  });

  it("a bundle with another digest never touches the file of the first", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    const before = readFileSync(path, "utf8");
    expect(OTHER_BUNDLE.bundleDigest).not.toBe(BUNDLE.bundleDigest);
    storeApplyBundle(hub, OTHER_BUNDLE);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(readStoredApplyBundle(hub, OTHER_BUNDLE.bundleDigest)).toEqual(OTHER_BUNDLE);
  });

  it("an interrupted write never leaves a half file under the digest name: the stray temporary file is not a stored bundle", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    const name = `${BUNDLE.bundleDigest.slice("sha256:".length)}.json`;
    // What a crash between the temporary write and the rename leaves: a partial file under a dot-prefixed temporary name.
    const stray = join(hub, BUNDLE_STORE_REL, `.${name}.0123456789abcdef.tmp`);
    writeFileSync(stray, bundleBytes({ ...BUNDLE, computedAt: "2026-09-25T00:00:00Z" }).slice(0, 40));
    expect(readFileSync(path, "utf8")).toBe(bundleBytes(BUNDLE));
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toEqual(BUNDLE);
    // A later store still replaces the digest name in one step and leaves the stray file alone.
    const later: ApplyBundle = { ...BUNDLE, computedAt: "2026-09-25T00:00:00Z" };
    storeApplyBundle(hub, later);
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toEqual(later);
    expect(readdirSync(join(hub, BUNDLE_STORE_REL)).filter((entry) => entry.endsWith(".tmp"))).toEqual([basename(stray)]);
  });

  it("a failed replacement leaves the stored file as it was and no temporary file of its own", () => {
    if (process.platform === "win32" || (process.getuid?.() ?? 1) === 0) return;
    const path = storeApplyBundle(hub, BUNDLE);
    const directory = join(hub, BUNDLE_STORE_REL);
    chmodSync(directory, 0o555);
    try {
      expect(() => storeApplyBundle(hub, { ...BUNDLE, computedAt: "2026-09-25T00:00:00Z" })).toThrow(/^hub store write failed \(EACCES\)$/);
    } finally {
      chmodSync(directory, 0o755);
    }
    expect(readFileSync(path, "utf8")).toBe(bundleBytes(BUNDLE));
    expect(readdirSync(directory)).toEqual([basename(path)]);
  });

  it("refuses a digest name held by a symbolic link, writing nothing through it", () => {
    storeApplyBundle(hub, OTHER_BUNDLE);
    const directory = join(hub, BUNDLE_STORE_REL);
    const path = bundleFile(BUNDLE.bundleDigest);
    const outside = join(hub, "outside.json");
    writeFileSync(outside, "untouched\n");
    symlinkSync(outside, path);
    expect(() => storeApplyBundle(hub, BUNDLE)).toThrow(TypeError);
    expect(readFileSync(outside, "utf8")).toBe("untouched\n");
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readdirSync(directory).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("replaces a stored file whose bytes were tampered with, so a rerun repairs it", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    writeFileSync(path, "not json\n");
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toBeNull();
    storeApplyBundle(hub, BUNDLE);
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toEqual(BUNDLE);
  });

  it("an invalid bundle throws with no path or value echoed, and replaces nothing", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    const before = readFileSync(path, "utf8");
    const invalid = { ...BUNDLE, computedAt: "2026-09-25T00:00:00Z", mode: "not-a-mode" } as unknown as ApplyBundle;
    let message = "";
    try {
      storeApplyBundle(hub, invalid);
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      message = String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(hub);
    expect(message).not.toContain("not-a-mode");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("a symlinked bundles directory throws, echoes no path, and leaves the link's target empty", () => {
    const target = realpathSync(mkdtempSync(join(tmpdir(), "apply-store-target-")));
    try {
      mkdirSync(join(hub, "clossys", ".state", "apply"), { recursive: true });
      symlinkSync(target, join(hub, "clossys", ".state", "apply", "bundles"), "dir");
      let message = "";
      try {
        storeApplyBundle(hub, BUNDLE);
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
        message = String(error);
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(hub);
      expect(message).not.toContain(target);
      expect(readdirSync(target)).toEqual([]);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
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

describe("hub store directory safety (issue #1545 fix 5)", () => {
  let target: string;

  beforeEach(() => {
    target = realpathSync(mkdtempSync(join(tmpdir(), "apply-store-target-")));
  });

  afterEach(() => {
    rmSync(target, { recursive: true, force: true });
  });

  it("throws instead of following a symlinked change-sets directory, and leaves the link's target empty", () => {
    mkdirSync(join(hub, "clossys", ".state", "apply"), { recursive: true });
    symlinkSync(target, join(hub, "clossys", ".state", "apply", "change-sets"), "dir");
    expect(() => storeChangeSet(hub, SET)).toThrow(TypeError);
    expect(readdirSync(target)).toEqual([]);
  });

  it("throws instead of following a symlinked apply parent directory", () => {
    mkdirSync(join(hub, "clossys", ".state"), { recursive: true });
    symlinkSync(target, join(hub, "clossys", ".state", "apply"), "dir");
    expect(() => storeChangeSet(hub, SET)).toThrow(TypeError);
    expect(readdirSync(target)).toEqual([]);
  });

  it("throws reading through a symlinked store directory, rather than following it", () => {
    mkdirSync(join(hub, "clossys", ".state"), { recursive: true });
    symlinkSync(target, join(hub, "clossys", ".state", "apply"), "dir");
    expect(() => readStoredChangeSet(hub, SET.changeSetDigest)).toThrow(TypeError);
  });

  it("wraps a permission failure into a message that names no path, in particular not the hub directory", () => {
    // No meaningful permission enforcement to test as root, or on Windows (chmod's mode bits do not gate access there).
    if (process.platform === "win32" || (process.getuid?.() ?? 1) === 0) return;
    const directory = join(hub, "clossys", ".state", "apply", "change-sets");
    mkdirSync(directory, { recursive: true });
    chmodSync(directory, 0o000);
    try {
      expect(() => storeChangeSet(hub, SET)).toThrow(/^hub store write failed \(EACCES\)$/);
      let message = "";
      try {
        storeChangeSet(hub, SET);
      } catch (error) {
        message = String(error);
      }
      expect(message).not.toContain(hub);
      expect(message).not.toContain(directory);
    } finally {
      chmodSync(directory, 0o755);
    }
  });
});
