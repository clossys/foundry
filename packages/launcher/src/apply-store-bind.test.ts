import { mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateRepositoryChangeSet } from "./change-set-contract.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import { CHANGE_SET_STORE_REL, BodyBoundError, bindChangeSetBody, readStoredChangeSet, storeChangeSet } from "./apply-store.js";

// Pass-through spies on renameSync and readFileSync, so a test can run code at the exact point a bind renames or reads (a test-only seam; nothing in production is added).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), readFileSync: vi.fn(actual.readFileSync) };
});

/*
 * Issue #1738. Two binds of one stored change set, and a set that changes or
 * vanishes under a bind, are interleaved only through the node:fs spies above:
 * no timer, no retry and no second process.
 */
const REPO = new URL("../../../", import.meta.url);
const corpus = JSON.parse(readFileSync(new URL("docs/contracts/apply-change-set-digest.fixture.json", REPO), "utf8")) as {
  changeSets: { name: string; valid: boolean; changeSet: RepositoryChangeSet }[];
};
const SET = corpus.changeSets.find((entry) => entry.name === "setup-site")!.changeSet;
if (!validateRepositoryChangeSet(SET).valid) throw new Error("the fixture this suite relies on no longer validates against the change-set contract");

let hub: string;

beforeEach(() => {
  // Resolved to its own real path: the store refuses a hubDirectory that is not its own realpath (issue #1545 fix 5).
  hub = realpathSync(mkdtempSync(join(tmpdir(), "apply-store-bind-")));
});

afterEach(() => {
  rmSync(hub, { recursive: true, force: true });
});

describe("bindChangeSetBody under interleaving (issue #1738)", () => {
  const A = `sha256:${"a".repeat(64)}`;
  const B = `sha256:${"b".repeat(64)}`;
  const C = `sha256:${"c".repeat(64)}`;
  const directory = (): string => join(hub, CHANGE_SET_STORE_REL);
  const setFile = (): string => join(directory(), `${SET.changeSetDigest.slice("sha256:".length)}.json`);
  const bytesOf = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  const bound = (hash: string): RepositoryChangeSet => ({ ...SET, pullRequest: { ...SET.pullRequest, bodySha256: hash } });
  const thrown = (run: () => unknown): unknown => {
    try {
      run();
    } catch (error) {
      return error;
    }
    return undefined;
  };
  /** A refusal is a plain TypeError that names no path, digest or hash. */
  const expectPlainRefusal = (error: unknown): void => {
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(BodyBoundError);
    const message = String(error);
    for (const forbidden of [hub, directory(), SET.changeSetDigest, SET.changeSetDigest.slice("sha256:".length), A, B, C]) expect(message).not.toContain(forbidden);
  };

  it("two interleaved binds: exactly one succeeds", { timeout: 20_000 }, async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    storeChangeSet(hub, SET);
    const path = setFile();
    vi.mocked(renameSync).mockClear();
    let inner: unknown = "not run";
    vi.mocked(renameSync).mockImplementationOnce((from, to) => {
      inner = thrown(() => bindChangeSetBody(hub, SET.changeSetDigest, B));
      actual.renameSync(from, to);
    });
    expect(bindChangeSetBody(hub, SET.changeSetDigest, A)).toBe(path);
    expectPlainRefusal(inner);
    expect(readStoredChangeSet(hub, SET.changeSetDigest)!.pullRequest.bodySha256).toBe(A);
    expect(readFileSync(path, "utf8")).toBe(bytesOf(bound(A)));
    expect(readdirSync(directory())).toEqual([basename(path)]);
    expect(thrown(() => bindChangeSetBody(hub, SET.changeSetDigest, B))).toBeInstanceOf(BodyBoundError);
  });

  it("a set changed while binding is refused and left as it is", { timeout: 20_000 }, async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    storeChangeSet(hub, SET);
    const path = setFile();
    vi.mocked(renameSync).mockClear();
    let armed = false;
    vi.mocked(readFileSync).mockImplementationOnce(((target: string, options?: never) => {
      armed = true;
      const real = actual.readFileSync(target, options);
      writeFileSync(path, bytesOf(bound(C)));
      return real;
    }) as never);
    expectPlainRefusal(thrown(() => bindChangeSetBody(hub, SET.changeSetDigest, A)));
    expect(armed).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(bytesOf(bound(C)));
    expect(renameSync).not.toHaveBeenCalled();
    expect(readdirSync(directory())).toEqual([basename(path)]);
  });

  it("a set removed while binding is refused, not recreated", { timeout: 20_000 }, async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    storeChangeSet(hub, SET);
    const path = setFile();
    vi.mocked(renameSync).mockClear();
    let armed = false;
    vi.mocked(readFileSync).mockImplementationOnce(((target: string, options?: never) => {
      armed = true;
      const real = actual.readFileSync(target, options);
      rmSync(path);
      return real;
    }) as never);
    expectPlainRefusal(thrown(() => bindChangeSetBody(hub, SET.changeSetDigest, A)));
    expect(armed).toBe(true);
    expect(actual.existsSync(path)).toBe(false);
    expect(renameSync).not.toHaveBeenCalled();
    expect(readdirSync(directory())).toEqual([]);
  });
});
