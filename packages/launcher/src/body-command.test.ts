import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LATER_AT, commitHubPlan, decide, mutateSet } from "./admission-fixture.js";
import { bindChangeSetBody, BUNDLE_STORE_REL, CHANGE_SET_STORE_REL, readStoredChangeSet, storeApplyBundle } from "./apply-store.js";
import { bodyMain } from "./apply-plan-cli.js";
import { buildMaterializedFixture, writeSnapshot } from "./apply-step-fixture.js";
import type { ApplyBundle, ApprovalBinding, RepositoryChangeSet } from "./change-set-contract.js";
import { renderPullRequest } from "./pull-request-body.js";

// `launcher-apply-plan body` (issue #1716): the body of the pull request for one stored change set, bound by the hub's own decision, with its
// hash recorded. Each test builds a real hub (a git repository holding the committed plan) and a real clone.

const SITE = "example-owner/site";
const TIMEOUT = 120_000;

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const sha256 = (bytes: Buffer): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** What one run printed: every byte of standard output, and every line of standard error. */
async function run(argv: string[], options: Parameters<typeof bodyMain>[1]): Promise<{ code: number; stdout: Buffer; stderr: string[] }> {
  const written: Buffer[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    written.push(Buffer.from(chunk));
    return true;
  }) as never);
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    written.push(Buffer.from(`${args.join(" ")}\n`));
  });
  const stderr: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.join(" "));
  });
  const code = await bodyMain(argv, options);
  vi.restoreAllMocks();
  return { code, stdout: Buffer.concat(written), stderr };
}

/** A hub that approved a stored setup set, and the clone it is applied to. */
function world(options: Parameters<typeof buildMaterializedFixture>[1] = {}) {
  const site = buildMaterializedFixture(roots, { storeSet: true, ...options });
  const setPath = join(site.hub, CHANGE_SET_STORE_REL, `${site.set.changeSetDigest.slice("sha256:".length)}.json`);
  const stored = (): RepositoryChangeSet => readStoredChangeSet(site.hub, site.set.changeSetDigest)!;
  const args = (taskRecord = "12", ...more: string[]): string[] => ["--repo", SITE, "--task-record", taskRecord, ...more];
  return { ...site, setPath, stored, args, options: { cwd: site.hub, clone: site.clone } };
}
type World = ReturnType<typeof world>;

/** The bundle the hub stored, as a planned bundle holding `binding` for its one set: same digest, only the mode and the entry differ. */
function planned(bundle: ApplyBundle, binding: ApprovalBinding): ApplyBundle {
  return {
    ...bundle,
    mode: "planned",
    repositories: bundle.repositories.map((entry) => ({
      ...entry,
      checks: ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"].map((check) => ({ check, verdict: "satisfied" as const })),
      state: "planned" as const,
      binding,
    })),
  } as ApplyBundle;
}

const expectedBody = (w: World, taskRecord = 12, supersedes?: number[]): string => {
  const out = renderPullRequest({ set: w.stored(), binding: w.binding, taskRecord, ...(supersedes === undefined ? {} : { supersedes }) });
  if (out.state !== "rendered") throw new Error(`refused: ${out.reason}`);
  return out.body;
};

/** Every file the hub keeps under clossys/.state, and the clone: two snapshots are equal only when nothing moved. */
const state = (w: World): string => writeSnapshot(w.clone, w.hub);

describe("launcher-apply-plan body", () => {
  it(
    "a withdrawn approval renders nothing",
    async () => {
      const w = world();
      // A planned bundle that still records the binding: the decision that withdrew the approval is what counts, not what was recorded.
      storeApplyBundle(w.hub, planned(w.bundle, w.binding));
      commitHubPlan(w.hub, decide(w.plan, "rejected", LATER_AT));
      const before = state(w);
      const bytes = readFileSync(w.setPath);
      const out = await run(w.args(), w.options);
      expect(out.code).toBe(2);
      expect(out.stdout.length).toBe(0);
      expect(out.stderr).toEqual(["launcher-apply-plan body: indeterminate (awaiting-approval)"]);
      expect(readFileSync(w.setPath).equals(bytes)).toBe(true);
      expect(w.stored().pullRequest.bodySha256).toBeUndefined();
      expect(state(w)).toBe(before);
    },
    TIMEOUT,
  );

  it(
    "a tampered planned binding refuses",
    async () => {
      const w = world();
      for (const forged of [
        { kind: "approved", subjectDigest: `sha256:${"c".repeat(64)}` },
        { kind: "approved", subjectDigest: `sha256:${"c".repeat(64)}`.replace("c", "d") },
      ] as ApprovalBinding[]) {
        storeApplyBundle(w.hub, planned(w.bundle, forged));
        const before = state(w);
        const out = await run(w.args(), w.options);
        expect(out.code).toBe(1);
        expect(out.stdout.length).toBe(0);
        expect(out.stderr).toEqual(["launcher-apply-plan body: refused (binding-mismatch)"]);
        expect(w.stored().pullRequest.bodySha256).toBeUndefined();
        expect(state(w)).toBe(before);
      }
      // The same bundle holding the binding the hub decides now is not in the way.
      storeApplyBundle(w.hub, planned(w.bundle, w.binding));
      const ok = await run(w.args(), w.options);
      expect(ok.code).toBe(0);
      expect(ok.stdout.toString("utf8")).toBe(expectedBody(w));
      // A report bundle, or none, records no binding to hold it to.
      const bare = world();
      expect((await run(bare.args(), bare.options)).code).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "stdout hashes to the stored bodySha256",
    async () => {
      const w = world();
      const before = w.stored();
      const beforeFiles = readdirSync(join(w.hub, CHANGE_SET_STORE_REL)).sort();
      const bundlesBefore = readdirSync(join(w.hub, BUNDLE_STORE_REL)).sort();
      const out = await run(w.args(), w.options);
      expect(out.code).toBe(0);
      expect(out.stderr).toEqual([]);
      const body = expectedBody(w);
      expect(out.stdout.toString("utf8")).toBe(body);
      expect(body.endsWith("\n")).toBe(true);
      const rendered = renderPullRequest({ set: before, binding: w.binding, taskRecord: 12 });
      if (rendered.state !== "rendered") throw new Error("not rendered");
      // The hash covers exactly the bytes on standard output, final line feed included.
      const stored = w.stored();
      expect(stored.pullRequest.bodySha256).toBe(sha256(out.stdout));
      expect(stored.pullRequest.bodySha256).toBe(rendered.bodySha256);
      // Nothing else in the set moved, the digest included, and no other file of the hub's.
      const { bodySha256: _hash, ...pullRequest } = stored.pullRequest;
      expect({ ...stored, pullRequest }).toEqual(before);
      expect(stored.changeSetDigest).toBe(before.changeSetDigest);
      expect(stored.texts).toEqual(before.texts);
      expect(readdirSync(join(w.hub, CHANGE_SET_STORE_REL)).sort()).toEqual(beforeFiles);
      expect(readdirSync(join(w.hub, BUNDLE_STORE_REL)).sort()).toEqual(bundlesBefore);

      // Again: the same body, the same hash, nothing rewritten.
      const bytes = readFileSync(w.setPath);
      const again = await run(w.args(), w.options);
      expect(again.code).toBe(0);
      expect(again.stdout.equals(out.stdout)).toBe(true);
      expect(readFileSync(w.setPath).equals(bytes)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "a body bound to one text refuses another, printing nothing",
    async () => {
      const w = world();
      expect((await run(w.args("12"), w.options)).code).toBe(0);
      const bytes = readFileSync(w.setPath);
      const other = await run(w.args("13"), w.options);
      expect(other.code).toBe(1);
      expect(other.stdout.length).toBe(0);
      expect(other.stderr).toEqual(["launcher-apply-plan body: refused (body-bound)"]);
      expect(readFileSync(w.setPath).equals(bytes)).toBe(true);
      // A hash recorded by anything else is just as binding.
      const foreign = world();
      bindChangeSetBody(foreign.hub, foreign.set.changeSetDigest, `sha256:${"e".repeat(64)}`);
      const refused = await run(foreign.args(), foreign.options);
      expect(refused.code).toBe(1);
      expect(refused.stdout.length).toBe(0);
      expect(refused.stderr).toEqual(["launcher-apply-plan body: refused (body-bound)"]);
    },
    TIMEOUT,
  );

  it(
    "supersedes needs another stored set",
    async () => {
      const w = world();
      const before = state(w);
      const bytes = readFileSync(w.setPath);
      // No other set of this repository is stored: nothing is founded to supersede.
      const alone = await run(w.args("12", "--supersedes", "5"), w.options);
      expect(alone.code).toBe(1);
      expect(alone.stdout.length).toBe(0);
      expect(alone.stderr).toEqual(["launcher-apply-plan body: refused (supersedes-unfounded)"]);
      expect(state(w)).toBe(before);
      expect(readFileSync(w.setPath).equals(bytes)).toBe(true);

      // A set of another repository, or this very set, does not found it either.
      const foreignRepo = mutateSet(w.set, (draft) => {
        draft.repository.id = "example-owner/docs";
      });
      for (const held of [[foreignRepo], [w.set], [w.stored()]]) {
        const refused = await run(w.args("12", "--supersedes", "5"), { ...w.options, set: w.set, heldChangeSets: held });
        expect(refused.stderr, JSON.stringify(refused.stderr)).toEqual(["launcher-apply-plan body: refused (supersedes-unfounded)"]);
        expect(refused.code).toBe(1);
        expect(refused.stdout.length).toBe(0);
      }
      expect(readFileSync(w.setPath).equals(bytes)).toBe(true);

      // Another stored set of this repository founds it: the numbers are written ascending.
      const older = mutateSet(w.set, (draft) => {
        draft.repository.baseCommit = "d".repeat(40);
      });
      const options = { ...w.options, set: w.set, heldChangeSets: [older] };
      const ok = await run(w.args("12", "--supersedes", "9", "--supersedes", "3"), options);
      expect(ok.code).toBe(0);
      const body = expectedBody(w, 12, [9, 3]);
      expect(body).toContain("\n## Supersedes\n\n- #3\n- #9\n\n## Task record\n");
      expect(ok.stdout.toString("utf8")).toBe(body);
      expect(w.stored().pullRequest.bodySha256).toBe(sha256(ok.stdout));
    },
    TIMEOUT,
  );

  it(
    "a supersedes list that repeats a number, names the task record or holds zero is refused by the renderer's token",
    async () => {
      const w = world();
      const older = mutateSet(w.set, (draft) => {
        draft.repository.baseCommit = "d".repeat(40);
      });
      const options = { ...w.options, set: w.set, heldChangeSets: [older] };
      for (const more of [["--supersedes", "3", "--supersedes", "3"], ["--supersedes", "12"], ["--supersedes", "0"]]) {
        const before = state(w);
        const out = await run(w.args("12", ...more), options);
        expect(out.code, more.join(" ")).toBe(1);
        expect(out.stdout.length).toBe(0);
        expect(out.stderr).toEqual(["launcher-apply-plan body: refused (supersedes-invalid)"]);
        expect(state(w)).toBe(before);
      }
    },
    TIMEOUT,
  );

  it(
    "the set the body is made from is the stored one: a set that is not stored renders nothing and stores nothing",
    async () => {
      const w = world({ storeSet: false });
      const before = state(w);
      const out = await run(w.args(), { ...w.options, set: w.set });
      expect(out.code).toBe(2);
      expect(out.stdout.length).toBe(0);
      expect(out.stderr).toEqual(["launcher-apply-plan body: indeterminate (change-set-absent)"]);
      expect(state(w)).toBe(before);
    },
    TIMEOUT,
  );

  it(
    "a stored set that is a symbolic link is not written through, and nothing is printed",
    async () => {
      const w = world();
      const outside = join(w.hub, "outside.json");
      const real = readFileSync(w.setPath);
      renameSync(w.setPath, outside);
      symlinkSync(outside, w.setPath);
      const out = await run(w.args(), w.options);
      expect(out.code).toBe(2);
      expect(out.stdout.length).toBe(0);
      expect(out.stderr).toEqual(["launcher-apply-plan body: indeterminate (store-failed)"]);
      expect(readFileSync(outside).equals(real)).toBe(true);
      expect(lstatSync(w.setPath).isSymbolicLink()).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "a refusal of the preconditions keeps its token and prints one line",
    async () => {
      const w = world({ hub: { readiness: false } });
      const out = await run(w.args(), w.options);
      expect(out.code).toBe(2);
      expect(out.stdout.length).toBe(0);
      expect(out.stderr).toEqual(["launcher-apply-plan body: indeterminate (authorization-unverified)"]);
      expect(w.stored().pullRequest.bodySha256).toBeUndefined();
    },
    TIMEOUT,
  );

  it("takes no option that could carry a binding: only the repository, the task record and the pull requests it replaces", async () => {
    const w = world();
    for (const argv of [
      [...w.args(), "--binding", "approved"],
      [...w.args(), "--subject", `sha256:${"f".repeat(64)}`],
      [...w.args(), "--repo", SITE],
      [...w.args("12"), "--task-record", "13"],
    ]) {
      const out = await run(argv, w.options);
      expect(out.code).toBe(2);
      expect(out.stdout.length).toBe(0);
    }
    expect(w.stored().pullRequest.bodySha256).toBeUndefined();
  });
});
