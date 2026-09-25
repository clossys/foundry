import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// A build-time tool from this repository, not shipped code; an untyped .mjs
// file that vitest transpiles without typechecking.
import { checkImportPurity } from "../../../scripts/lib/import-purity.mjs";
import { bundleDigest, changeSetDigest, changeSetDigestSubject } from "./change-set-digest.js";
import { validateApplyBundle, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import { PUBLIC_PROBLEM_PLACEHOLDER, planApplyBundle, projectEngagementBrief, serializeEngagementBrief } from "./plan-bundle.js";
import type { PlanApplyBundleInputs, RepositoryObservation } from "./plan-bundle.js";
import type { AdvisorPlan, EngagementBrief } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";

/*
 * Issue #1178. The pure apply planner: one change set per staffed
 * repository, computed from observations only. Reading repository files here
 * is test-only.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");
const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const clone = <T>(value: T): T => structuredClone(value);

const PLAN = (JSON.parse(read("docs/contracts/advisor-plan-digest.fixture.json")) as { plans: { name: string; plan: AdvisorPlan }[] }).plans.find(
  (entry) => entry.name === "staffed-with-packages",
)!.plan;
const STARTER = PLAN.packages!.find((act) => act.planItem === "example-owner/site:@example/starter")!;

const HUB_BRIEF: EngagementBrief = {
  schemaVersion: 1,
  problem: "Our site doesn't explain what we do.",
  roles: [
    { role: "strategist", why: "Sets the direction.", goal: { metric: "direction-clarity", direction: "increase" }, inputsFrom: [], outputsTo: ["writer"] },
    { role: "writer", why: "Writes the pages.", goal: { metric: "pages-published", direction: "increase" }, inputsFrom: ["strategist"], outputsTo: [] },
  ],
  sequence: ["strategist", "writer"],
  deliverables: ["A direction.", "The pages."],
};

const SITE: RepositoryObservation = {
  id: "example-owner/site",
  nodeId: "R_exampleSite1",
  visibility: "private",
  defaultBranch: "main",
  baseCommit: "a".repeat(40),
  phase: "apply",
  packageManager: "npm",
  lockfile: "package-lock.json",
  releaseAgeSurfaces: [],
  files: [{ path: "package-lock.json", sha256: sha("site lock") }],
  manifestEntries: [{ placement: "devDependencies", name: STARTER.name, value: STARTER.version }],
  lockedPackages: [{ name: STARTER.name, version: STARTER.version, integrity: STARTER.integrity }],
  ledgerGeneration: 0,
};

const DOCS: RepositoryObservation = {
  id: "example-owner/docs",
  nodeId: "R_exampleDocs1",
  visibility: "public",
  defaultBranch: "trunk",
  baseCommit: "b".repeat(40),
  phase: "setup",
  packageManager: "pnpm",
  lockfile: "none",
  releaseAgeSurfaces: [{ surface: "pnpm-workspace", path: "pnpm-workspace.yaml" }],
  files: [],
  manifestEntries: [],
  lockedPackages: [],
  ledgerGeneration: 0,
};

const INPUTS: PlanApplyBundleInputs = {
  plan: PLAN,
  hubBrief: HUB_BRIEF,
  repositories: [SITE, DOCS],
  skills: [
    { role: "strategist", content: "# Strategist\n" },
    { role: "writer", content: "# Writer\n" },
  ],
  producer: { name: "@example/launcher", version: "0.4.0" },
  engine: { name: "@example/advisor", version: "0.8.0", integrity: STARTER.integrity },
  planCommitted: true,
  authorization: { planDigest: planDigest(PLAN), expiresAt: "2026-10-01T00:00:00Z" },
  computedAt: "2026-09-24T12:00:00Z",
};

const run = (inputs: PlanApplyBundleInputs = INPUTS) => planApplyBundle(inputs);
const setFor = (sets: readonly RepositoryChangeSet[], id: string) => sets.find((set) => set.repository.id === id)!;
const withRepository = (patch: Partial<RepositoryObservation>, id = SITE.id): PlanApplyBundleInputs => ({
  ...INPUTS,
  repositories: INPUTS.repositories.map((entry) => (entry.id === id ? { ...(entry as RepositoryObservation), ...patch } : entry)),
});

describe("planApplyBundle", () => {
  it("gives a two-repository staffing two change sets, each valid, and a bundle whose digest covers both", () => {
    const { bundle, changeSets } = run();
    expect(changeSets.map((set) => set.repository.id)).toEqual(["example-owner/site", "example-owner/docs"]);
    for (const set of changeSets) {
      expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
      expect(set.changeSetDigest).toBe(changeSetDigest(set));
      expect(set.bundle).toBe(bundle.bundleDigest);
      expect(set.planDigest).toBe(planDigest(PLAN));
    }
    expect(validateApplyBundle(bundle)).toEqual({ valid: true });
    expect(bundle.mode).toBe("report");
    expect(bundle.bundleDigest).toBe(bundleDigest(planDigest(PLAN), changeSets.map((set) => ({ id: set.repository.id, changeSetDigest: set.changeSetDigest }))));
    expect(bundle.repositories.map((entry) => ("changeSet" in entry ? entry.changeSet : null))).toEqual(changeSets.map((set) => set.changeSetDigest));
    expect(bundle.snapshot).toEqual({ path: "clossys/.state/apply/registry-snapshot.json", digest: PLAN.resolution!.snapshotDigest });
  });

  it("claims no repository state: no entry carries one, and a setup set is reported indeterminate, not planned", () => {
    const { bundle } = run();
    for (const entry of bundle.repositories) expect(Object.keys(entry)).not.toContain("state");
    expect(bundle.repositories[0]).toMatchObject({ verdict: "indeterminate", phase: "apply", checks: [{ check: "V6", verdict: "indeterminate", rule: "lockfile-not-run" }] });
    expect(bundle.repositories[1]).toMatchObject({
      verdict: "indeterminate",
      phase: "setup",
      checks: [{ check: "V6", verdict: "indeterminate", rule: "lockfile-not-run" }, { check: "V6", verdict: "indeterminate", rule: "setup-template-unbuilt" }],
    });
  });

  it("skips a repository with a skip reason or no observation, and leaves it out of the bundle digest", () => {
    for (const [inputs, reason] of [
      [{ ...INPUTS, repositories: [SITE, { id: DOCS.id, skipped: "not-in-inventory" }] }, "not-in-inventory"],
      [{ ...INPUTS, repositories: [SITE] }, "not-observed"],
    ] as const) {
      const { bundle, changeSets } = run(inputs);
      expect(changeSets.map((set) => set.repository.id)).toEqual([SITE.id]);
      expect(bundle.repositories[1]).toEqual({ id: DOCS.id, verdict: "indeterminate", reason, checks: [] });
      expect(bundle.bundleDigest).toBe(bundleDigest(planDigest(PLAN), [{ id: SITE.id, changeSetDigest: changeSets[0]!.changeSetDigest }]));
      expect(validateApplyBundle(bundle)).toEqual({ valid: true });
    }
  });

  it("is deterministic: the same inputs, even with the hub brief's members reordered, give the same bytes", () => {
    const first = JSON.stringify(run());
    const reordered = Object.fromEntries(Object.entries(clone(HUB_BRIEF)).reverse()) as unknown as EngagementBrief;
    const second = JSON.stringify(run({ ...clone(INPUTS), hubBrief: reordered }));
    expect(second).toBe(first);
  });

  it("gives a new digest when the base moves, only for that repository's set", () => {
    const before = run();
    const after = run(withRepository({ baseCommit: "c".repeat(40) }));
    expect(setFor(after.changeSets, SITE.id).changeSetDigest).not.toBe(setFor(before.changeSets, SITE.id).changeSetDigest);
    expect(setFor(after.changeSets, DOCS.id).changeSetDigest).toBe(setFor(before.changeSets, DOCS.id).changeSetDigest);
    expect(after.bundle.bundleDigest).not.toBe(before.bundle.bundleDigest);
  });

  it("gives every set a new digest when the producer version changes", () => {
    const before = run();
    const after = run({ ...INPUTS, producer: { ...INPUTS.producer, version: "0.4.1" } });
    for (const id of [SITE.id, DOCS.id]) expect(setFor(after.changeSets, id).changeSetDigest).not.toBe(setFor(before.changeSets, id).changeSetDigest);
  });

  it("changes only that repository's change when its staffing changes; the other set moves only through the covered plan digest", () => {
    const plan = clone(PLAN) as unknown as { staffing: { repository: string; roles: string[] }[] };
    plan.staffing[1]!.roles = ["strategist", "writer"];
    const before = run();
    const after = run({ ...INPUTS, plan: plan as unknown as AdvisorPlan });
    const content = (set: RepositoryChangeSet) => {
      const { planDigest: _plan, ...rest } = changeSetDigestSubject(set);
      return rest;
    };
    expect(content(setFor(after.changeSets, SITE.id))).toEqual(content(setFor(before.changeSets, SITE.id)));
    expect(content(setFor(after.changeSets, DOCS.id))).not.toEqual(content(setFor(before.changeSets, DOCS.id)));
    expect(setFor(after.changeSets, DOCS.id).items.find((item) => item.act === "compose-skills")).toEqual({ id: "skills", act: "compose-skills", roles: ["strategist", "writer"] });
  });

  it("keeps a package act the base already satisfies as a no-op item: no key, no lockfile invariant", () => {
    const site = setFor(run().changeSets, SITE.id);
    const starter = site.items.find((item) => "planItem" in item && item.planItem === STARTER.planItem);
    expect(starter).toMatchObject({ act: "pin-starter", satisfiedInBase: true });
    expect(site.keys.map((key) => key.item)).not.toContain(STARTER.planItem);
    const lock = site.files.find((file) => file.path === "package-lock.json");
    expect(lock).toMatchObject({ derived: true, before: sha("site lock") });
    expect(lock !== undefined && "invariants" in lock ? lock.invariants.map((invariant) => ("item" in invariant ? invariant.item : null)) : []).toEqual([
      "example-owner/site:@example/strategist",
      "example-owner/site:@example/writer",
    ]);
  });

  it("refuses, as unowned-existing, a pin the base has at another integrity, and a file the base already has", () => {
    const { bundle, changeSets } = run(
      withRepository({ lockedPackages: [{ name: STARTER.name, version: STARTER.version, integrity: PLAN.packages![1]!.integrity }], files: [...SITE.files, { path: "clossys/brief.json", sha256: sha("a brief") }] }),
    );
    const site = setFor(changeSets, SITE.id);
    expect(site.items.find((item) => "planItem" in item && item.planItem === STARTER.planItem)).toMatchObject({ satisfiedInBase: false });
    expect(site.refused).toEqual([
      { path: "clossys/brief.json", reason: "unowned-existing", item: "brief" },
      { file: "package.json", pointer: "/devDependencies/@example~1starter", reason: "unowned-existing", item: STARTER.planItem },
    ]);
    expect(site.files.map((file) => file.path)).not.toContain("clossys/brief.json");
    expect(bundle.repositories[0]).toMatchObject({
      verdict: "indeterminate",
      checks: [{ check: "V6", verdict: "indeterminate", rule: "lockfile-not-run" }, { check: "V6", verdict: "indeterminate", rule: "unowned-existing" }],
    });
  });

  it("gives a public repository the placeholder instead of the problem, and a private one the problem", () => {
    const { changeSets } = run();
    const expected = (visibility: "private" | "public", roles: string[]) => sha(serializeEngagementBrief(projectEngagementBrief(HUB_BRIEF, roles, visibility)));
    const briefAfter = (set: RepositoryChangeSet) => set.files.find((file) => file.path === "clossys/brief.json")!.after;
    expect(briefAfter(setFor(changeSets, DOCS.id))).toBe(expected("public", ["writer"]));
    expect(briefAfter(setFor(changeSets, SITE.id))).toBe(expected("private", ["strategist", "writer"]));

    const publicBytes = serializeEngagementBrief(projectEngagementBrief(HUB_BRIEF, ["writer"], "public"));
    expect(publicBytes).toContain(JSON.stringify(PUBLIC_PROBLEM_PLACEHOLDER));
    expect(publicBytes).not.toContain(HUB_BRIEF.problem);
    expect(serializeEngagementBrief(projectEngagementBrief(HUB_BRIEF, ["writer"], "internal"))).not.toContain(HUB_BRIEF.problem);
    expect(serializeEngagementBrief(projectEngagementBrief(HUB_BRIEF, ["writer"], "private"))).toContain(HUB_BRIEF.problem);

    const flipped = run(withRepository({ visibility: "public" }));
    expect(briefAfter(setFor(flipped.changeSets, SITE.id))).toBe(expected("public", ["strategist", "writer"]));
    expect(setFor(flipped.changeSets, SITE.id).changeSetDigest).not.toBe(setFor(changeSets, SITE.id).changeSetDigest);
  });

  it("records the independently computed brief bytes' digest for the corpus hub brief", () => {
    const corpus = JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as { hubBrief: EngagementBrief; briefs: { name: string; sha256: string }[] };
    const { changeSets } = run({ ...INPUTS, hubBrief: corpus.hubBrief });
    const briefAfter = (set: RepositoryChangeSet) => set.files.find((file) => file.path === "clossys/brief.json")!.after;
    expect(briefAfter(setFor(changeSets, SITE.id))).toBe(corpus.briefs.find((entry) => entry.name === "private-non-ascii")!.sha256);
    expect(briefAfter(setFor(changeSets, DOCS.id))).toBe(corpus.briefs.find((entry) => entry.name === "public-placeholder")!.sha256);
  });

  it("writes the projected brief's members in one fixed order: the brief contract's", () => {
    const projected = projectEngagementBrief(HUB_BRIEF, ["writer"], "private");
    expect(Object.keys(projected)).toEqual(["schemaVersion", "problem", "roles", "sequence", "deliverables", "staffedHere"]);
    expect(Object.keys(projected.roles[0]!)).toEqual(["role", "why", "goal", "inputsFrom", "outputsTo"]);
    const withContext = projectEngagementBrief({ ...HUB_BRIEF, context: { schemaVersion: 1, fields: [{ state: "unknown", id: "business" } as never] } }, ["writer"], "private");
    expect(Object.keys(withContext)).toEqual(["schemaVersion", "problem", "roles", "sequence", "deliverables", "staffedHere", "context"]);
    expect(Object.keys(withContext.context!.fields[0]!)).toEqual(["id", "state"]);
  });

  it("carries every act the plan authorizes for a repository, as an item or deferred, and nothing else", () => {
    const { changeSets } = run();
    for (const set of changeSets) {
      const authorized = PLAN.packages!.filter((act) => act.repository === set.repository.id).map((act) => act.planItem).sort();
      const carried = [...set.items.flatMap((item) => ("planItem" in item ? [item.planItem] : [])), ...set.deferred.map((deferral) => deferral.planItem)].sort();
      expect(carried, set.repository.id).toEqual(authorized);
      for (const item of set.items) {
        if (!("planItem" in item)) continue;
        const act = PLAN.packages!.find((entry) => entry.planItem === item.planItem)!;
        expect(item, item.planItem).toMatchObject({ act: act.act, package: { name: act.name, version: act.version, integrity: act.integrity }, placement: act.placement });
      }
    }
    const docs = setFor(changeSets, DOCS.id);
    expect(docs.deferred).toEqual([{ planItem: "example-owner/docs:@example/writer", reason: "after-setup" }]);
    expect(docs.keys).toEqual([{ file: "package.json", pointer: "/devDependencies/@example~1starter", before: null, after: "0.9.2", item: "example-owner/docs:@example/starter" }]);
    expect(docs.pathAllowList).toEqual([".agents/skills/clossys-*/**", "clossys/**", "package.json", "pnpm-lock.yaml"]);
  });

  it("writes only brief, skills and the ledger for a plan with no package acts", () => {
    const plan = clone(PLAN) as unknown as Record<string, unknown>;
    delete plan.packages;
    delete plan.resolution;
    const { bundle, changeSets } = run({ ...INPUTS, plan: plan as unknown as AdvisorPlan, authorization: null });
    for (const set of changeSets) {
      expect(set.items.map((item) => item.act)).toEqual(["write-record", "write-ledger", "compose-skills"]);
      expect(set.keys).toEqual([]);
      expect(set.pathAllowList).toEqual([".agents/skills/clossys-*/**", "clossys/**"]);
    }
    expect(bundle.snapshot).toBeNull();
    expect(bundle.authorization).toBeNull();
    // No package acts, so no authorization is needed, and with no lockfile change the layout check is all V6 has to do.
    expect(bundle.repositories[0]).toMatchObject({ verdict: "satisfied", checks: [{ check: "V6", verdict: "satisfied" }] });
    for (const entry of bundle.repositories) expect(entry.checks.map((check) => check.rule)).not.toContain("authorization-absent");
  });

  it("refuses a role that is not one path segment as an unsafe path, and reports V6 violated", () => {
    const plan = clone(PLAN) as unknown as { mandate: { roles: string[] }; staffing: { roles: string[] }[] };
    plan.mandate.roles = ["strategist", "writer", "a/b"];
    plan.staffing[1]!.roles = ["writer", "a/b"];
    const brief = clone(HUB_BRIEF) as unknown as { roles: unknown[] };
    brief.roles.push({ ...HUB_BRIEF.roles[1]!, role: "a/b" });
    const { bundle, changeSets } = run({ ...INPUTS, plan: plan as unknown as AdvisorPlan, hubBrief: brief as unknown as EngagementBrief, skills: [...INPUTS.skills, { role: "a/b", content: "x" }] });
    expect(setFor(changeSets, DOCS.id).refused).toEqual([{ path: ".agents/skills/clossys-a/b/SKILL.md", reason: "unsafe-path", item: "skills" }]);
    expect(bundle.repositories[1]).toMatchObject({ verdict: "violated" });
  });

  it("starts the ledger from the observed generation", () => {
    const site = setFor(run(withRepository({ ledgerGeneration: 3 })).changeSets, SITE.id);
    expect(site.ledger).toEqual({ generation: 3 });
    expect(site.files.find((file) => file.path === "clossys/.state/installed.json")).toMatchObject({ derived: true, item: "ledger", invariants: [{ ledgerGeneration: 4 }] });
  });

  it("refuses inputs it cannot plan from, naming positions and never values", () => {
    expect(() => run({ ...INPUTS, hubBrief: { ...HUB_BRIEF, staffedHere: ["writer"] } })).toThrow(/must not have staffedHere/);
    expect(() => run({ ...INPUTS, repositories: [SITE, { ...DOCS, id: "example-owner/other" }] })).toThrow(/repositories\[1\] is not a repository the plan staffs/);
    expect(() => run({ ...INPUTS, repositories: [SITE, SITE] })).toThrow(/repositories\[1\] repeats/);
    expect(() => run({ ...INPUTS, skills: [INPUTS.skills[0]!] })).toThrow(/no composed skill content/);
    const unstaffed = clone(PLAN) as unknown as Record<string, unknown>;
    for (const key of ["staffing", "packages", "resolution"]) delete unstaffed[key];
    expect(() => run({ ...INPUTS, plan: unstaffed as unknown as AdvisorPlan })).toThrow(/no staffing/);
    try {
      run({ ...INPUTS, repositories: [{ ...SITE, baseCommit: "not a commit" }] });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/changeSet\.repository\.baseCommit/);
      expect(String(error)).not.toContain("not a commit");
    }
  });

  it("names the failing set's staffing position, not its position among computed sets, when an earlier staffed repository is skipped or unobserved", () => {
    // staffing is [SITE, DOCS] (positions 0 and 1). SITE is left unobserved here, so only DOCS
    // reaches computeChangeSet -- and DOCS's invalid baseCommit is what fails contract validation.
    // The computed-set array therefore holds one entry at its own index 0, which must not be
    // reported as the failing position: DOCS is staffing position 1.
    try {
      run({ ...INPUTS, repositories: [{ ...DOCS, baseCommit: "not a commit" }] });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/staffed repository 1 does not validate/);
      expect(String(error)).toMatch(/changeSet\.repository\.baseCommit/);
      expect(String(error)).not.toContain(DOCS.id);
      expect(String(error)).not.toContain("not a commit");
    }
  });
});

describe("canonical output", () => {
  const rich: RepositoryObservation = {
    ...SITE,
    releaseAgeSurfaces: [
      { surface: "pnpm-workspace", path: "pnpm-workspace.yaml" },
      { surface: "npmrc", path: "packages/a/.npmrc" },
      { surface: "npmrc", path: ".npmrc" },
    ],
    files: [
      { path: "package-lock.json", sha256: sha("site lock") },
      { path: ".agents/skills/clossys-writer/SKILL.md", sha256: sha("a writer skill") },
      { path: "clossys/brief.json", sha256: sha("a brief") },
      { path: ".agents/skills/clossys-strategist/SKILL.md", sha256: sha("a strategist skill") },
    ],
    manifestEntries: [
      { placement: "dependencies", name: "@example/writer", value: "^0.6.0" },
      { placement: "devDependencies", name: STARTER.name, value: STARTER.version },
      { placement: "devDependencies", name: "@example/writer", value: "0.6.0" },
    ],
    lockedPackages: [
      { name: "@example/writer", version: "0.6.0", integrity: STARTER.integrity },
      { name: STARTER.name, version: STARTER.version, integrity: STARTER.integrity },
    ],
  };
  const permutations = <T>(values: readonly T[]): T[][] => [[...values], [...values].reverse(), [...values.slice(1), ...values.slice(0, 1)]];

  it("gives the same bytes for every order of every observation array, and of repositories and skills", () => {
    const base = JSON.stringify(run({ ...INPUTS, repositories: [rich, DOCS] }));
    for (const field of ["releaseAgeSurfaces", "files", "manifestEntries", "lockedPackages"] as const) {
      for (const order of permutations(rich[field] as readonly unknown[])) {
        const observation = { ...rich, [field]: order } as RepositoryObservation;
        expect(JSON.stringify(run({ ...INPUTS, repositories: [observation, DOCS] })), field).toBe(base);
      }
    }
    expect(JSON.stringify(run({ ...INPUTS, repositories: [DOCS, rich] }))).toBe(base);
    expect(JSON.stringify(run({ ...INPUTS, repositories: [rich, DOCS], skills: [...INPUTS.skills].reverse() }))).toBe(base);
  });

  it("sorts release-age surfaces and refusals, and writes every array in the contract's canonical order", () => {
    const site = setFor(run({ ...INPUTS, repositories: [rich, DOCS] }).changeSets, SITE.id);
    expect(site.observed.releaseAgeSurfaces).toEqual([
      { surface: "npmrc", path: ".npmrc" },
      { surface: "npmrc", path: "packages/a/.npmrc" },
      { surface: "pnpm-workspace", path: "pnpm-workspace.yaml" },
    ]);
    expect(site.refused.map((refusal) => ("path" in refusal ? refusal.path : refusal.pointer))).toEqual([
      ".agents/skills/clossys-strategist/SKILL.md",
      ".agents/skills/clossys-writer/SKILL.md",
      "clossys/brief.json",
      "/dependencies/@example~1writer",
      "/devDependencies/@example~1writer",
    ]);
    expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
  });

  it("treats a base file that differs only in letter case as already there", () => {
    const site = setFor(run(withRepository({ files: [...SITE.files, { path: "Clossys/Brief.json", sha256: sha("a brief") }] })).changeSets, SITE.id);
    expect(site.refused).toContainEqual({ path: "clossys/brief.json", reason: "unowned-existing", item: "brief" });
  });
});

describe("no authorization for a plan with package acts", () => {
  it("is reported as a violated V3 check on every computed repository, so none is satisfied", () => {
    const { bundle } = run({ ...INPUTS, authorization: null });
    expect(bundle.snapshot).not.toBeNull();
    for (const entry of bundle.repositories) {
      expect(entry.verdict).toBe("violated");
      expect(entry.checks).toContainEqual({ check: "V3", verdict: "violated", rule: "authorization-absent" });
    }
    expect(validateApplyBundle(bundle)).toEqual({ valid: true });
    for (const entry of run().bundle.repositories) expect(entry.checks.map((check) => check.rule)).not.toContain("authorization-absent");
  });
});

describe("authorization for another plan", () => {
  it("is reported as a violated V3 check on every computed repository, not passed through", () => {
    const { bundle } = run({ ...INPUTS, authorization: { planDigest: sha("another plan"), expiresAt: "2026-10-01T00:00:00Z" } });
    for (const entry of bundle.repositories) {
      expect(entry.verdict).toBe("violated");
      expect(entry.checks).toContainEqual({ check: "V3", verdict: "violated", rule: "authorization-plan-mismatch" });
    }
    expect(validateApplyBundle(bundle)).toEqual({ valid: true });
    for (const entry of run().bundle.repositories) expect(entry.checks.map((check) => check.rule)).not.toContain("authorization-plan-mismatch");
  });
});

/*
 * The planner's purity, by the shared check in scripts/lib/import-purity.mjs
 * (a build-time tool of this repository, not shipped code). Two checks, both
 * on syntax trees read with the TypeScript compiler API: (a) the import graph
 * of plan-bundle.ts -- every module it reaches, transitively -- imports no
 * builtin but node:crypto (for hashing) and no package, and uses no dynamic
 * import(); (b) none of those modules writes one of a listed set of globals
 * directly (fetch, process, globalThis, the timers, Date.now, Math.random and
 * the others the helper lists). (a) is the guarantee that the planner reads no
 * file, network or process. (b) is not a proof: JavaScript can reach a global
 * indirectly, in forms the check does not see, so that the planner reads no
 * clock and no randomness rests on (a) plus review of its code.
 */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const at = (file: string) => `packages/launcher/src/${file}`;
interface PurityResult {
  findings: { file: string; line: number; rule: string; message: string }[];
  visited: string[];
}
const purity = (entries: string[]): PurityResult => checkImportPurity({ entries, allowedBuiltins: ["node:crypto"], root: repoRoot }) as PurityResult;

describe("the planner is pure", () => {
  const result = purity([at("plan-bundle.ts")]);

  it("imports no builtin but node:crypto and no package, and writes none of the listed globals directly, across its whole import graph", () => {
    expect(result.findings).toEqual([]);
  });

  it("reaches exactly the planner, the contract and digest modules, and the generated contract data", () => {
    expect([...result.visited].sort()).toEqual(
      ["change-set-contract.ts", "change-set-digest.ts", "generated/contract-schema.generated.ts", "generated/plan-contracts.generated.ts", "plan-bundle.ts", "plan-contract.ts", "plan-digest.ts", "plan-rules.ts"]
        .map(at)
        .sort(),
    );
  });

  it("would catch a module that performs I/O", () => {
    expect(purity([at("apply-plan-cli.ts")]).findings.map((finding) => finding.rule)).toContain("builtin-not-allowed");
  });
});
