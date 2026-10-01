import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bundleDigest } from "./change-set-digest.js";
import { validateApplyBundle, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { ApplyBundle, RepositoryChangeSet } from "./change-set-contract.js";
import { BUNDLE_STORE_REL, CHANGE_SET_STORE_REL, bindChangeSetBody, readStoredApplyBundle, readStoredChangeSet, storeApplyBundle, storeChangeSet } from "./apply-store.js";

// A pass-through spy on renameSync, so one test can make the rename step of a replacement fail (a test-only seam; nothing in production is added).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

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

/** The same bundle as a planned one: bound by an approval, with V1 to V9 satisfied (code rules A5 to A7). Same digest: the digest does not cover the mode. */
const PLANNED: ApplyBundle = {
  ...BUNDLE,
  mode: "planned",
  repositories: [
    {
      id: SET.repository.id,
      verdict: "satisfied",
      phase: SET.phase,
      changeSet: SET.changeSetDigest,
      checks: ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"].map((check) => ({ check, verdict: "satisfied" as const })),
      state: "planned",
      binding: { kind: "approved", subjectDigest: BUNDLE.bundleDigest },
    },
  ],
};
if (!validateApplyBundle(PLANNED).valid || PLANNED.bundleDigest !== BUNDLE.bundleDigest) throw new Error("this suite's planned bundle fixture does not validate against the apply-bundle contract");

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

  it("replaces a stored report bundle with the newest bytes when the same digest is stored with a later clock", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    const later: ApplyBundle = { ...BUNDLE, computedAt: "2026-09-25T00:00:00Z" };
    expect(later.bundleDigest).toBe(BUNDLE.bundleDigest);
    expect(storeApplyBundle(hub, later)).toBe(path);
    expect(readFileSync(path, "utf8")).toBe(bundleBytes(later));
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toEqual(later);
    expect(Object.keys(bundleStore())).toEqual([`${BUNDLE.bundleDigest.slice("sha256:".length)}.json`]);
  });

  it("replaces a stored report bundle with the newest bytes when the same digest is stored with a new authorization, and only that file changes", () => {
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

  it("report never replaces a stored planned bundle", () => {
    const path = storeApplyBundle(hub, PLANNED);
    const before = statSync(path);
    const bytes = readFileSync(path, "utf8");
    const attempts: ApplyBundle[] = [BUNDLE, { ...BUNDLE, computedAt: "2026-09-25T00:00:00Z" }];
    for (const attempt of attempts) {
      let caught: unknown;
      try {
        storeApplyBundle(hub, attempt);
      } catch (cause) {
        caught = cause;
      }
      expect(caught).toBeInstanceOf(TypeError);
      // The refusal names no path, digest or id.
      const message = (caught as Error).message;
      expect(message).not.toContain(hub);
      expect(message).not.toContain(tmpdir());
      expect(message).not.toContain("sha256");
      expect(message).not.toContain(SET.repository.id);
      const after = statSync(path);
      expect(readFileSync(path, "utf8")).toBe(bytes);
      expect(after.ino).toBe(before.ino);
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(readdirSync(join(hub, BUNDLE_STORE_REL))).toEqual([`${BUNDLE.bundleDigest.slice("sha256:".length)}.json`]);
    }
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toEqual(PLANNED);
  });

  it("a planned bundle replaces a stored report bundle and a stored planned one, and a report replaces a planned file that does not verify", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    expect(storeApplyBundle(hub, PLANNED)).toBe(path);
    expect(readFileSync(path, "utf8")).toBe(bundleBytes(PLANNED));
    const later: ApplyBundle = { ...PLANNED, computedAt: "2026-09-25T00:00:00Z" };
    expect(storeApplyBundle(hub, later)).toBe(path);
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toEqual(later);

    // A file that claims to be planned but does not verify (its bytes are not a bundle of this digest) is no protection: it is replaced.
    writeFileSync(path, `${JSON.stringify({ ...PLANNED, bundleDigest: `sha256:${"0".repeat(64)}` }, null, 2)}\n`);
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toBeNull();
    expect(storeApplyBundle(hub, BUNDLE)).toBe(path);
    expect(readFileSync(path, "utf8")).toBe(bundleBytes(BUNDLE));
    writeFileSync(path, "not json\n");
    expect(storeApplyBundle(hub, BUNDLE)).toBe(path);
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toEqual(BUNDLE);
  });

  it("a report replaces a genuine planned bundle stored under another digest name", () => {
    // A planned bundle under its own digest name; OTHER_BUNDLE is the report of another digest.
    const plannedPath = storeApplyBundle(hub, PLANNED);
    expect(readFileSync(plannedPath, "utf8")).toBe(bundleBytes(PLANNED));
    expect(plannedPath).toBe(bundleFile(PLANNED.bundleDigest));

    // Copy the planned bytes under OTHER_BUNDLE's file name, as a crash or an outside hand could have.
    const otherName = `${OTHER_BUNDLE.bundleDigest.slice("sha256:".length)}.json`;
    const otherPath = join(hub, BUNDLE_STORE_REL, otherName);
    writeFileSync(otherPath, readFileSync(plannedPath));

    // The copy holds a planned bundle that verifies as its own digest -- but its name is not that digest, so the
    // report's replace-protection must not read the copy as a stored planned bundle.
    expect(storeApplyBundle(hub, OTHER_BUNDLE)).toBe(otherPath);
    expect(readFileSync(otherPath, "utf8")).toBe(bundleBytes(OTHER_BUNDLE));
    expect(readStoredApplyBundle(hub, BUNDLE.bundleDigest)).toEqual(PLANNED);
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

  it("a real replacement goes through a temporary file and a rename: the file at the digest name is a new inode, never rewritten in place", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    const before = statSync(path);
    const held = readFileSync(path);
    const renames = vi.mocked(renameSync);
    renames.mockClear();
    const later: ApplyBundle = { ...BUNDLE, computedAt: "2026-09-25T00:00:00Z" };
    storeApplyBundle(hub, later);
    expect(renames).toHaveBeenCalledTimes(1);
    const [from, to] = renames.mock.calls[0] as [string, string];
    expect(to).toBe(path);
    expect(basename(from)).toMatch(/^\..+\.tmp$/);
    expect(from).not.toBe(path);
    expect(statSync(path).ino).not.toBe(before.ino);
    expect(held.toString("utf8")).toBe(bundleBytes(BUNDLE));
    expect(readFileSync(path, "utf8")).toBe(bundleBytes(later));
  });

  it("a rename that fails leaves the old bundle byte for byte and removes the temporary file", () => {
    const path = storeApplyBundle(hub, BUNDLE);
    const before = readFileSync(path);
    const directory = join(hub, BUNDLE_STORE_REL);
    let temporary = "";
    vi.mocked(renameSync).mockImplementationOnce((from) => {
      temporary = String(from);
      expect(existsSync(temporary)).toBe(true);
      throw Object.assign(new Error("simulated"), { code: "EXDEV" });
    });
    expect(() => storeApplyBundle(hub, { ...BUNDLE, computedAt: "2026-09-25T00:00:00Z" })).toThrow(/^hub store write failed \(EXDEV\)$/);
    expect(temporary).not.toBe("");
    expect(existsSync(temporary)).toBe(false);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(directory)).toEqual([basename(path)]);
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

describe("bindChangeSetBody (issue #1716)", () => {
  const A = `sha256:${"a".repeat(64)}`;
  const B = `sha256:${"b".repeat(64)}`;
  const setFile = (): string => join(hub, CHANGE_SET_STORE_REL, `${SET.changeSetDigest.slice("sha256:".length)}.json`);
  const bytesOf = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  const bound = (hash: string): RepositoryChangeSet => ({ ...SET, pullRequest: { ...SET.pullRequest, bodySha256: hash } });

  it("records the hash in the one stored set and changes nothing else in it", () => {
    storeChangeSet(hub, SET);
    const other = storeChangeSet(hub, OTHER_SET);
    const otherBefore = readFileSync(other);
    const before = readFileSync(setFile(), "utf8");
    expect(bindChangeSetBody(hub, SET.changeSetDigest, A)).toBe(setFile());
    expect(readFileSync(setFile(), "utf8")).toBe(bytesOf(bound(A)));
    const read = readStoredChangeSet(hub, SET.changeSetDigest)!;
    expect(read.changeSetDigest).toBe(SET.changeSetDigest);
    expect(read.pullRequest).toEqual({ title: SET.pullRequest.title, bodySha256: A });
    // Take the hash out and the bytes are the ones stored before: no other member moved, nor any order.
    const { bodySha256: _hash, ...rest } = read.pullRequest;
    expect(bytesOf({ ...read, pullRequest: rest })).toBe(before);
    expect(readFileSync(other).equals(otherBefore)).toBe(true);
    expect(readdirSync(join(hub, CHANGE_SET_STORE_REL)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("a bound body is never rebound", () => {
    storeChangeSet(hub, SET);
    bindChangeSetBody(hub, SET.changeSetDigest, A);
    const path = setFile();
    const held = readFileSync(path);
    // The same hash again is a no-op: nothing is renamed over the file.
    const renames = vi.mocked(renameSync);
    renames.mockClear();
    expect(() => bindChangeSetBody(hub, SET.changeSetDigest, A)).not.toThrow();
    expect(renames).not.toHaveBeenCalled();
    expect(readFileSync(path).equals(held)).toBe(true);
    // Another hash throws, names no path or hash, and keeps the bytes.
    let message = "";
    try {
      bindChangeSetBody(hub, SET.changeSetDigest, B);
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      message = String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(hub);
    expect(message).not.toContain(B);
    expect(message).not.toContain(A);
    expect(readFileSync(path).equals(held)).toBe(true);
    expect(renames).not.toHaveBeenCalled();
    // Storing the set again, with no hash or another, keeps the bound bytes.
    for (const again of [SET, bound(B)]) {
      expect(() => storeChangeSet(hub, again)).not.toThrow();
      expect(readFileSync(path).equals(held)).toBe(true);
    }
    expect(readStoredChangeSet(hub, SET.changeSetDigest)!.pullRequest.bodySha256).toBe(A);
  });

  it("goes through a temporary file and a rename, and a rename that fails leaves the stored set byte for byte", () => {
    storeChangeSet(hub, SET);
    const path = setFile();
    const before = readFileSync(path);
    vi.mocked(renameSync).mockClear();
    let temporary = "";
    vi.mocked(renameSync).mockImplementationOnce((from) => {
      temporary = String(from);
      throw Object.assign(new Error("simulated"), { code: "EXDEV" });
    });
    expect(() => bindChangeSetBody(hub, SET.changeSetDigest, A)).toThrow(/^hub store write failed \(EXDEV\)$/);
    expect(existsSync(temporary)).toBe(false);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(join(hub, CHANGE_SET_STORE_REL))).toEqual([basename(path)]);

    const held = readFileSync(path);
    const inode = statSync(path).ino;
    bindChangeSetBody(hub, SET.changeSetDigest, A);
    const [from, to] = vi.mocked(renameSync).mock.calls.at(-1) as [string, string];
    expect(to).toBe(path);
    expect(basename(from)).toMatch(/^\..+\.tmp$/);
    expect(statSync(path).ino).not.toBe(inode);
    expect(held.toString("utf8")).toBe(bytesOf(SET));
  });

  it("refuses a set that is not stored, a stored file that does not verify, and a hash or digest that is not well formed, changing nothing", () => {
    expect(() => bindChangeSetBody(hub, SET.changeSetDigest, A)).toThrow(TypeError);
    expect(existsSync(join(hub, "clossys"))).toBe(false);
    storeChangeSet(hub, SET);
    for (const digest of ["sha256:../x", `sha256:${"A".repeat(64)}`, "0".repeat(64)]) expect(() => bindChangeSetBody(hub, digest, A)).toThrow(TypeError);
    for (const hash of ["sha256:abc", `sha256:${"A".repeat(64)}`, "a".repeat(64), `${A}\n`, "", 7 as never]) expect(() => bindChangeSetBody(hub, SET.changeSetDigest, hash)).toThrow(TypeError);
    // Bytes that no longer recompute to their name are not bound.
    const path = setFile();
    const tampered: RepositoryChangeSet = { ...SET, repository: { ...SET.repository, baseCommit: "f".repeat(40) } };
    writeFileSync(path, bytesOf(tampered));
    expect(() => bindChangeSetBody(hub, SET.changeSetDigest, A)).toThrow(TypeError);
    expect(readFileSync(path, "utf8")).toBe(bytesOf(tampered));
    // Nor is another set's file, renamed to this name.
    writeFileSync(path, bytesOf(OTHER_SET));
    expect(() => bindChangeSetBody(hub, SET.changeSetDigest, A)).toThrow(TypeError);
    expect(readFileSync(path, "utf8")).toBe(bytesOf(OTHER_SET));
  });

  it("refuses a stored name held by a symbolic link, and a symbolic link in the store's directories, writing nothing through them", () => {
    storeChangeSet(hub, SET);
    const path = setFile();
    const real = readFileSync(path);
    const outside = join(hub, "outside.json");
    writeFileSync(outside, real);
    rmSync(path);
    symlinkSync(outside, path);
    expect(() => bindChangeSetBody(hub, SET.changeSetDigest, A)).toThrow(TypeError);
    expect(readFileSync(outside).equals(real)).toBe(true);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readdirSync(join(hub, CHANGE_SET_STORE_REL)).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    rmSync(path);
    const directory = join(hub, CHANGE_SET_STORE_REL);
    const moved = join(hub, "moved-change-sets");
    renameSync(directory, moved);
    symlinkSync(moved, directory, "dir");
    expect(() => bindChangeSetBody(hub, SET.changeSetDigest, A)).toThrow(TypeError);
    expect(readdirSync(moved).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
