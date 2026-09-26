import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// A build-time tool from this repository, not shipped code; an untyped .mjs
// file that vitest transpiles without typechecking.
import { checkImportPurity } from "../../../scripts/lib/import-purity.mjs";
import { bundleDigest, changeSetDigest, changeSetDigestSubject } from "./change-set-digest.js";
import { contentDigest, validateApplyBundle, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { ChangeSetItem, RepositoryChangeSet } from "./change-set-contract.js";
import { readInstalledLedger, renderInstalledLedger, serializeInstalledLedger } from "./ledger-contract.js";
import type { InstalledLedger } from "./ledger-contract.js";
import { PUBLIC_PROBLEM_PLACEHOLDER, planApplyBundle, projectEngagementBrief, serializeComposedSkillsManifest, serializeEngagementBrief } from "./plan-bundle.js";
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
  consumerCi: true,
  symlinkedSkillRoots: [],
  repositoryProfile: null,
  linkedAgentsPaths: [],
  files: [{ path: "package-lock.json", sha256: sha("site lock") }],
  manifestEntries: [{ placement: "devDependencies", name: STARTER.name, value: STARTER.version }],
  lockedPackages: [{ name: STARTER.name, version: STARTER.version, integrity: STARTER.integrity }],
  ledger: null,
  skillsManifest: null,
};

const DOCS: RepositoryObservation = {
  id: "example-owner/docs",
  nodeId: "R_exampleDocs1",
  visibility: "public",
  defaultBranch: "trunk",
  baseCommit: "b".repeat(40),
  phase: "apply",
  packageManager: "pnpm",
  lockfile: "none",
  releaseAgeSurfaces: [{ surface: "pnpm-workspace", path: "pnpm-workspace.yaml" }],
  consumerCi: false,
  symlinkedSkillRoots: [],
  repositoryProfile: null,
  linkedAgentsPaths: [],
  files: [],
  manifestEntries: [],
  lockedPackages: [],
  ledger: null,
  skillsManifest: null,
};

const INPUTS: PlanApplyBundleInputs = {
  plan: PLAN,
  hubBrief: HUB_BRIEF,
  repositories: [SITE, DOCS],
  skills: [
    { role: "advisor", content: "# Advisor\n" },
    { role: "strategist", content: "# Strategist\n" },
    { role: "writer", content: "# Writer\n" },
  ],
  producer: { name: "@example/launcher", version: "0.4.0" },
  engine: { name: "@example/advisor", version: "0.8.0", integrity: STARTER.integrity },
  integrator: { name: "@example/integrator", version: "0.6.0", integrity: PLAN.packages![1]!.integrity },
  planCommitted: true,
  authorization: { planDigest: planDigest(PLAN), expiresAt: "2026-10-01T00:00:00Z" },
  computedAt: "2026-09-24T12:00:00Z",
  heldChangeSets: [],
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

  it("claims no repository state and records no binding: no entry carries either", () => {
    const { bundle } = run();
    for (const entry of bundle.repositories) {
      expect(Object.keys(entry)).not.toContain("state");
      expect(Object.keys(entry)).not.toContain("binding");
    }
    // Both repositories have an uninstalled package, so both change a lockfile the planner does not regenerate.
    for (const entry of bundle.repositories) {
      expect(entry).toMatchObject({ verdict: "indeterminate", phase: "apply", checks: [{ check: "V6", verdict: "indeterminate", rule: "lockfile-not-run" }, { check: "V8", verdict: "satisfied" }] });
    }
  });

  it("skips a setup-phase repository as setup-template-unbuilt, outside the bundle digest, because a setup set must carry the templates it does not compute", () => {
    const { bundle, changeSets } = run(withRepository({ phase: "setup" }, DOCS.id));
    expect(changeSets.map((set) => set.repository.id)).toEqual([SITE.id]);
    expect(bundle.repositories[1]).toEqual({ id: DOCS.id, verdict: "indeterminate", reason: "setup-template-unbuilt", checks: [] });
    expect(bundle.bundleDigest).toBe(bundleDigest(planDigest(PLAN), [{ id: SITE.id, changeSetDigest: changeSets[0]!.changeSetDigest }]));
    expect(validateApplyBundle(bundle)).toEqual({ valid: true });
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
    expect(setFor(after.changeSets, DOCS.id).items.find((item) => item.act === "compose-skills")).toEqual({ id: "skills", act: "compose-skills", roles: ["advisor", "strategist", "writer"] });
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

  it("refuses, as unowned-existing under V8, a pin the base has at another integrity, and a file the base already has", () => {
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
      checks: [{ check: "V6", verdict: "indeterminate", rule: "lockfile-not-run" }, { check: "V8", verdict: "indeterminate", rule: "unowned-existing" }],
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
    expect(docs.deferred).toEqual([]);
    expect(docs.keys).toEqual([
      { file: "package.json", pointer: "/devDependencies/@example~1starter", before: null, after: "0.9.2", item: "example-owner/docs:@example/starter" },
      { file: "package.json", pointer: "/devDependencies/@example~1writer", before: null, after: "0.7.0", item: "example-owner/docs:@example/writer" },
    ]);
    expect(docs.pathAllowList).toEqual([".agents/skills/clossys-*/**", ".claude/skills/clossys-*", ".cursor/skills/clossys-*", "clossys/**", "package.json", "pnpm-lock.yaml"]);
  });

  it("writes only brief, skills and the ledger for a plan with no package acts", () => {
    const plan = clone(PLAN) as unknown as Record<string, unknown>;
    delete plan.packages;
    delete plan.resolution;
    const { bundle, changeSets } = run({ ...INPUTS, plan: plan as unknown as AdvisorPlan, authorization: null });
    for (const set of changeSets) {
      expect(set.items.map((item) => item.act)).toEqual(["write-record", "write-ledger", "compose-skills"]);
      expect(set.keys).toEqual([]);
      expect(set.pathAllowList).toEqual([".agents/skills/clossys-*/**", ".claude/skills/clossys-*", ".cursor/skills/clossys-*", "clossys/**"]);
    }
    expect(bundle.snapshot).toBeNull();
    expect(bundle.authorization).toBeNull();
    // No package acts, so no authorization is needed, and with no lockfile change the layout check is all V6 has to do.
    expect(bundle.repositories[0]).toMatchObject({ verdict: "satisfied", checks: [{ check: "V6", verdict: "satisfied" }, { check: "V8", verdict: "satisfied" }] });
    for (const entry of bundle.repositories) expect(entry.checks.map((check) => check.rule)).not.toContain("authorization-absent");
  });

  it("refuses, before computing anything, a staffed role that is not a lowercase id token, and a planItem that is not derived", () => {
    for (const role of ["a/b", "Writer", "ship the site"]) {
      const plan = clone(PLAN) as unknown as { mandate: { roles: string[] }; staffing: { roles: string[] }[] };
      plan.mandate.roles = ["strategist", "writer", role];
      plan.staffing[1]!.roles = ["writer", role];
      const brief = clone(HUB_BRIEF) as unknown as { roles: unknown[] };
      brief.roles.push({ ...HUB_BRIEF.roles[1]!, role });
      const inputs = { ...INPUTS, plan: plan as unknown as AdvisorPlan, hubBrief: brief as unknown as EngagementBrief, skills: [...INPUTS.skills, { role, content: "x" }] };
      expect(() => run(inputs), role).toThrow(/^staffing\[1\]\.roles\[1\] is not a lowercase id token \(role-not-an-id\)$/);
    }
    for (const planItem of ["example-owner/private-sibling:@example/writer", "Ship the writer first", "example-owner/site:@example/editor", "Example-Owner/site:@example/writer"]) {
      const plan = clone(PLAN) as unknown as { packages: { planItem: string; name: string }[] };
      const index = plan.packages.findIndex((act) => act.name === "@example/writer" && act.planItem.startsWith("example-owner/site:"));
      plan.packages[index]!.planItem = planItem;
      try {
        run({ ...INPUTS, plan: plan as unknown as AdvisorPlan });
        expect.unreachable();
      } catch (error) {
        expect(String(error), planItem).toBe(`TypeError: packages[${index}].planItem is not the repository id, a colon and the package name (plan-item-not-derived)`);
      }
    }
  });

  it("carries the hub's Integrator pin and whether the base runs CI of its own", () => {
    const { changeSets } = run();
    for (const set of changeSets) expect(set.integrator).toEqual(INPUTS.integrator);
    expect(setFor(changeSets, SITE.id).observed.consumerCi).toBe(true);
    expect(setFor(changeSets, DOCS.id).observed.consumerCi).toBe(false);
    const bumped = run({ ...INPUTS, integrator: { ...INPUTS.integrator, version: "0.6.1" } });
    for (const id of [SITE.id, DOCS.id]) expect(setFor(bumped.changeSets, id).changeSetDigest).not.toBe(setFor(changeSets, id).changeSetDigest);
  });

  it("writes each role's discovery links, as links to its skill, and the composed-skill manifest", () => {
    const site = setFor(run().changeSets, SITE.id);
    for (const role of ["advisor", "strategist", "writer"]) {
      for (const root of [".claude/skills", ".cursor/skills"]) {
        expect(site.files.find((file) => file.path === `${root}/clossys-${role}`)).toEqual({
          path: `${root}/clossys-${role}`,
          mode: "120000",
          before: null,
          after: contentDigest(`../../.agents/skills/clossys-${role}`),
          item: "skills",
        });
      }
    }
    const manifest = serializeComposedSkillsManifest(
      [
        { role: "writer", sha256: sha("# Writer\n") },
        { role: "strategist", sha256: sha("# Strategist\n") },
        { role: "advisor", sha256: sha("# Advisor\n") },
      ],
      "0.4.0",
    );
    expect(site.files.find((file) => file.path === "clossys/.state/skills.json")).toEqual({ path: "clossys/.state/skills.json", mode: "100644", before: null, after: sha(manifest), item: "skills" });
  });

  it("writes the composed-skill manifest's exact bytes: sorted by name, no time, and only skills the set writes", () => {
    expect(serializeComposedSkillsManifest([{ role: "writer", sha256: sha("w") }, { role: "strategist", sha256: sha("s") }], "0.4.0")).toBe(
      `{\n  "schemaVersion": 1,\n  "skills": [\n    {\n      "name": "strategist",\n      "source": "catalogue",\n      "sha256": "${sha("s").slice(7)}",\n      "version": "0.4.0"\n    },\n    {\n      "name": "writer",\n      "source": "catalogue",\n      "sha256": "${sha("w").slice(7)}",\n      "version": "0.4.0"\n    }\n  ]\n}\n`,
    );
    const refused = setFor(run(withRepository({ files: [...SITE.files, { path: ".agents/skills/clossys-writer/SKILL.md", sha256: sha("theirs") }] })).changeSets, SITE.id);
    const manifest = serializeComposedSkillsManifest([{ role: "advisor", sha256: sha("# Advisor\n") }, { role: "strategist", sha256: sha("# Strategist\n") }], "0.4.0");
    expect(refused.files.find((file) => file.path === "clossys/.state/skills.json")!.after).toBe(sha(manifest));
  });

  it("writes no discovery link for a role whose skill is refused, so no link exposes a skill the flow does not own", () => {
    const site = setFor(run(withRepository({ files: [...SITE.files, { path: ".agents/skills/clossys-writer/SKILL.md", sha256: sha("theirs") }] })).changeSets, SITE.id);
    expect(site.refused).toContainEqual({ path: ".agents/skills/clossys-writer/SKILL.md", reason: "unowned-existing", item: "skills" });
    const paths = [...site.files.map((file) => file.path), ...site.refused.map((refusal) => ("path" in refusal ? refusal.path : refusal.pointer))];
    expect(paths.filter((path) => path.endsWith("/clossys-writer"))).toEqual([]);
    expect(paths).toContain(".claude/skills/clossys-strategist");
    expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
    const linked = setFor(run(withRepository({ linkedAgentsPaths: [".agents"] })).changeSets, SITE.id);
    expect(linked.files.map((file) => file.path).filter((path) => path.includes("/clossys-"))).toEqual([]);
  });

  it("writes no discovery link under a root the base has as a symbolic link, and refuses one where the base has a directory", () => {
    const linked = setFor(run(withRepository({ symlinkedSkillRoots: [".claude/skills"] })).changeSets, SITE.id);
    expect(linked.observed.symlinkedSkillRoots).toEqual([".claude/skills"]);
    expect(linked.files.map((file) => file.path).filter((path) => path.startsWith(".claude/"))).toEqual([]);
    expect(linked.pathAllowList).not.toContain(".claude/skills/clossys-*");
    expect(linked.files.map((file) => file.path).filter((path) => path.startsWith(".cursor/"))).toEqual([
      ".cursor/skills/clossys-advisor",
      ".cursor/skills/clossys-strategist",
      ".cursor/skills/clossys-writer",
    ]);
    expect(validateRepositoryChangeSet(linked)).toEqual({ valid: true });

    const copied = setFor(run(withRepository({ files: [...SITE.files, { path: ".claude/skills/clossys-writer/SKILL.md", sha256: sha("a copy") }] })).changeSets, SITE.id);
    expect(copied.refused).toContainEqual({ path: ".claude/skills/clossys-writer", reason: "unowned-existing", item: "skills" });
    expect(validateRepositoryChangeSet(copied)).toEqual({ valid: true });
  });

  it("records the observed repository profile, and adds no act when it declares every root name or has no root vocabulary", () => {
    for (const rootVocabulary of ["none", "checked"] as const) {
      const profile = { path: "governance/repository-profile.json", rootVocabulary, undeclaredRoots: [], prohibitedRoots: [] };
      const { bundle, changeSets } = run(withRepository({ repositoryProfile: profile }));
      const site = setFor(changeSets, SITE.id);
      expect(site.observed.repositoryProfile).toEqual(profile);
      expect(site.items.map((item) => item.act)).not.toContain("declare-root-entry");
      // An uninstalled package still changes the lockfile, which this check does not regenerate.
      expect(bundle.repositories[0]).toMatchObject({ verdict: "indeterminate", checks: [{ check: "V6", verdict: "indeterminate", rule: "lockfile-not-run" }, { check: "V8", verdict: "satisfied" }] });
    }
  });

  it("skips a repository whose profile needs root entries added, because the edited profile's bytes are not computed yet", () => {
    const profile = { path: "governance/repository-profile.json", rootVocabulary: "checked" as const, undeclaredRoots: ["clossys"], prohibitedRoots: [] };
    const { bundle, changeSets } = run(withRepository({ repositoryProfile: profile }));
    expect(changeSets.map((set) => set.repository.id)).toEqual([DOCS.id]);
    expect(bundle.repositories[0]).toEqual({ id: SITE.id, verdict: "indeterminate", reason: "root-entry-edit-unbuilt", checks: [] });
    expect(validateApplyBundle(bundle)).toEqual({ valid: true });
  });

  it("refuses the declaration of an unparseable profile, or of one that prohibits a root name the set introduces", () => {
    for (const [profile, reason] of [
      [{ path: "governance/repository-profile.json", rootVocabulary: "unparseable" as const, undeclaredRoots: [], prohibitedRoots: [] }, "root-vocabulary-unknown"],
      [{ path: "governance/repository-profile.json", rootVocabulary: "checked" as const, undeclaredRoots: [".cursor"], prohibitedRoots: [".claude"] }, "root-entry-prohibited"],
    ] as const) {
      const { bundle, changeSets } = run(withRepository({ repositoryProfile: profile }));
      const site = setFor(changeSets, SITE.id);
      expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
      expect(site.items.find((item) => item.act === "declare-root-entry")).toEqual({
        id: "root-entries",
        act: "declare-root-entry",
        path: "governance/repository-profile.json",
        entries: profile.rootVocabulary === "unparseable" ? [] : [{ name: ".cursor", classification: "extension", disposition: "allowed" }],
      });
      expect(site.refused).toContainEqual({ path: "governance/repository-profile.json", reason, item: "root-entries" });
      expect(bundle.repositories[0]).toMatchObject({ verdict: "indeterminate" });
    }
  });

  it("never writes a skill through a symbolic link: each one under it is refused as skills-root-is-link", () => {
    const { bundle, changeSets } = run(withRepository({ linkedAgentsPaths: [".agents/skills/clossys-writer"] }));
    const site = setFor(changeSets, SITE.id);
    expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
    expect(site.refused).toContainEqual({ path: ".agents/skills/clossys-writer/SKILL.md", reason: "skills-root-is-link", item: "skills" });
    expect(site.files.map((file) => file.path)).toContain(".agents/skills/clossys-strategist/SKILL.md");
    expect(site.files.find((file) => file.path === "clossys/.state/skills.json")!.after).toBe(
      sha(serializeComposedSkillsManifest([{ role: "advisor", sha256: sha("# Advisor\n") }, { role: "strategist", sha256: sha("# Strategist\n") }], "0.4.0")),
    );
    expect(bundle.repositories[0]).toMatchObject({
      verdict: "indeterminate",
      checks: [
        { check: "V6", verdict: "indeterminate", rule: "lockfile-not-run" },
        { check: "V6", verdict: "indeterminate", rule: "skills-root-is-link" },
        { check: "V8", verdict: "satisfied" },
      ],
    });
    const whole = setFor(run(withRepository({ linkedAgentsPaths: [".agents"] })).changeSets, SITE.id);
    expect(whole.refused.filter((refusal) => refusal.reason === "skills-root-is-link")).toHaveLength(3);
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

describe("the Advisor voice (D33)", () => {
  it("composes advisor first, then the staffed roles, and writes its skill, both discovery links and its manifest entry; the brief's staffedHere leaves it out", () => {
    const { changeSets } = run();
    for (const set of changeSets) {
      const staffed = PLAN.staffing!.find((entry) => entry.repository === set.repository.id)!.roles;
      expect(set.items.find((item) => item.act === "compose-skills")).toEqual({ id: "skills", act: "compose-skills", roles: ["advisor", ...staffed] });
      const paths = set.files.map((file) => file.path);
      for (const path of [".agents/skills/clossys-advisor/SKILL.md", ".claude/skills/clossys-advisor", ".cursor/skills/clossys-advisor"]) expect(paths, path).toContain(path);
      expect(set.files.find((file) => file.path === ".agents/skills/clossys-advisor/SKILL.md")).toMatchObject({ before: null, after: sha("# Advisor\n"), item: "skills" });
      const manifest = serializeComposedSkillsManifest(
        ["advisor", ...staffed].map((role) => ({ role, sha256: sha(INPUTS.skills.find((skill) => skill.role === role)!.content) })),
        "0.4.0",
      );
      expect(manifest).toContain('"name": "advisor"');
      expect(set.files.find((file) => file.path === "clossys/.state/skills.json")!.after).toBe(sha(manifest));
      const brief = serializeEngagementBrief(projectEngagementBrief(HUB_BRIEF, staffed, set.repository.visibility));
      expect(set.files.find((file) => file.path === "clossys/brief.json")!.after).toBe(sha(brief));
    }
  });

  it("refuses inputs with no Advisor content, naming no value", () => {
    expect(() => run({ ...INPUTS, skills: INPUTS.skills.filter((skill) => skill.role !== "advisor") })).toThrow(/^the Advisor voice has no composed skill content in skills$/);
    // Even when every repository is skipped: the hub carries every voice whatever any one repository staffs.
    expect(() => run({ ...INPUTS, repositories: [], skills: INPUTS.skills.filter((skill) => skill.role !== "advisor") })).toThrow(TypeError);
  });
});

/*
 * The installed-state ledger: trust, the compare-and-swap table over it, and
 * the checks it drives. Run 2 observes run 1's set as merged: every whole file
 * at its after, its keys and lockfile invariants installed, and the ledger
 * RENDER gives it.
 */
const LEDGER = "clossys/.state/installed.json";
const TEMPLATE_IDS = ["caller-workflow", "ci-template", "path-scope-job", "starter-request"];
const DIGEST_CORPUS = JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as { changeSets: { name: string; changeSet: RepositoryChangeSet }[] };
const LEDGER_CORPUS = JSON.parse(read("docs/contracts/installed-ledger.fixture.json")) as { ledgers: { name: string; ledger: InstalledLedger }[] };
const corpusSet = (name: string) => clone(DIGEST_CORPUS.changeSets.find((entry) => entry.name === name)!.changeSet);
const corpusLedger = (name: string) => clone(LEDGER_CORPUS.ledgers.find((entry) => entry.name === name)!.ledger);
const planPackages = (plan: AdvisorPlan, id: string) =>
  (plan.packages ?? []).filter((act) => act.repository === id).map(({ planItem, act, name, version, integrity, placement }) => ({ planItem, act, name, version, integrity, placement }));
type PackageItem = Extract<ChangeSetItem, { planItem: string }>;

/** The observation of the repository once `set` has merged over `observation`, bound as approved by its own bundle. */
function merged(observation: RepositoryObservation, set: RepositoryChangeSet, previous: InstalledLedger | null = null, plan: AdvisorPlan = PLAN, commit = "d"): RepositoryObservation {
  const ledger = renderInstalledLedger(previous, set, { kind: "approved", subjectDigest: set.bundle }, planPackages(plan, set.repository.id));
  const files = new Map(observation.files.map((file) => [file.path, file.sha256]));
  let manifestEntries = [...observation.manifestEntries];
  let lockedPackages = [...observation.lockedPackages];
  for (const file of set.files) {
    if (!("derived" in file)) {
      if (file.after !== null) files.set(file.path, file.after);
    } else if (file.path !== LEDGER) {
      files.set(file.path, sha(`${file.path} at ${set.changeSetDigest}`));
      for (const invariant of file.invariants) {
        if (!("name" in invariant)) continue;
        lockedPackages = [...lockedPackages.filter((locked) => locked.name !== invariant.name), { name: invariant.name, version: invariant.version, integrity: invariant.integrity }];
      }
    }
  }
  for (const key of set.keys) {
    const item = set.items.find((entry) => entry.id === key.item) as PackageItem;
    manifestEntries = [...manifestEntries.filter((entry) => !(entry.placement === item.placement && entry.name === item.package.name)), { placement: item.placement, name: item.package.name, value: key.after! }];
  }
  files.set(LEDGER, sha(ledger));
  return { ...observation, baseCommit: commit.repeat(40), files: [...files].map(([path, sha256]) => ({ path, sha256 })), manifestEntries, lockedPackages, ledger };
}

/** SITE observed over a ledger the corpus holds: every files row's bytes at its after, and the ledger's own bytes. */
function overCorpusLedger(ledger: InstalledLedger, patch: Partial<RepositoryObservation> = {}): RepositoryObservation {
  const text = serializeInstalledLedger(ledger);
  return {
    ...SITE,
    baseCommit: "e".repeat(40),
    files: [...SITE.files, ...ledger.files.map((row) => ({ path: row.path, sha256: row.after })), { path: LEDGER, sha256: sha(text) }],
    ledger: text,
    ...patch,
  };
}

const withSite = (site: RepositoryObservation, heldChangeSets: readonly RepositoryChangeSet[], patch: Partial<PlanApplyBundleInputs> = {}): PlanApplyBundleInputs => ({
  ...INPUTS,
  repositories: [site, DOCS],
  heldChangeSets,
  ...patch,
});
const siteEntry = (result: ReturnType<typeof run>) => result.bundle.repositories.find((entry) => entry.id === SITE.id)!;
const wholeFiles = (set: RepositoryChangeSet) => set.files.filter((file) => !("derived" in file));

describe("the installed-state ledger", () => {
  const first = setFor(run().changeSets, SITE.id);
  const second = merged(SITE, first);

  it("keeps every whole file of a merged first run on the second run: no key, no refusal, V8 satisfied, the next generation", () => {
    const result = run(withSite(second, [first]));
    const site = setFor(result.changeSets, SITE.id);
    expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
    expect(wholeFiles(site).map((file) => file.path)).toEqual(wholeFiles(first).map((file) => file.path));
    for (const file of wholeFiles(site)) expect(file, file.path).toMatchObject({ before: (file as { after: string }).after });
    expect(wholeFiles(site).every((file) => "after" in file && file.after === (wholeFiles(first).find((entry) => entry.path === file.path) as { after: string }).after)).toBe(true);
    expect(site.keys).toEqual([]);
    expect(site.refused).toEqual([]);
    expect(site.items.filter((item) => "planItem" in item).every((item) => (item as PackageItem).satisfiedInBase)).toBe(true);
    expect(site.ledger).toEqual({ generation: 1 });
    expect(site.files.find((file) => file.path === LEDGER)).toMatchObject({ derived: true, invariants: [{ ledgerGeneration: 2 }], before: sha(second.ledger!) });
    expect(siteEntry(result)).toMatchObject({ verdict: "satisfied", checks: [{ check: "V6", verdict: "satisfied" }, { check: "V8", verdict: "satisfied" }] });
  });

  it("takes the generation from the trusted ledger, across two merged generations", () => {
    const secondSet = setFor(run(withSite(second, [first])).changeSets, SITE.id);
    const third = merged(second, secondSet, readInstalledLedger(second.ledger!), PLAN, "f");
    const site = setFor(run(withSite(third, [first, secondSet])).changeSets, SITE.id);
    expect(site.ledger).toEqual({ generation: 2 });
    expect(site.files.find((file) => file.path === LEDGER)).toMatchObject({ invariants: [{ ledgerGeneration: 3 }] });
    // Without a ledger the set is computed over generation 0.
    expect(setFor(run().changeSets, SITE.id).ledger).toEqual({ generation: 0 });
  });

  it("updates an owned file whose desired bytes changed, from the bytes the flow last wrote", () => {
    const skills = INPUTS.skills.map((skill) => (skill.role === "writer" ? { role: "writer", content: "# Writer, revised\n" } : skill));
    const site = setFor(run(withSite(second, [first], { skills })).changeSets, SITE.id);
    expect(site.files.find((file) => file.path === ".agents/skills/clossys-writer/SKILL.md")).toEqual({
      path: ".agents/skills/clossys-writer/SKILL.md",
      mode: "100644",
      before: sha("# Writer\n"),
      after: sha("# Writer, revised\n"),
      item: "skills",
    });
    const manifest = site.files.find((file) => file.path === "clossys/.state/skills.json") as { before: string; after: string };
    expect(manifest.before).not.toBe(manifest.after);
    expect(site.files.find((file) => file.path === ".claude/skills/clossys-writer")).toMatchObject({ before: contentDigest("../../.agents/skills/clossys-writer") });
    expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
  });

  it("updates an owned key whose desired version changed, with its lockfile invariant", () => {
    const older = clone(PLAN) as unknown as { packages: { planItem: string; version: string }[] };
    older.packages.find((act) => act.planItem === "example-owner/site:@example/writer")!.version = "0.6.0";
    const olderPlan = older as unknown as AdvisorPlan;
    const firstOlder = setFor(run({ ...INPUTS, plan: olderPlan, authorization: { ...INPUTS.authorization!, planDigest: planDigest(olderPlan) } }).changeSets, SITE.id);
    const site = setFor(run(withSite(merged(SITE, firstOlder, null, olderPlan), [firstOlder])).changeSets, SITE.id);
    expect(site.keys).toEqual([{ file: "package.json", pointer: "/devDependencies/@example~1writer", before: "0.6.0", after: "0.7.0", item: "example-owner/site:@example/writer" }]);
    expect(site.files.find((file) => file.path === "package-lock.json")).toMatchObject({ derived: true, invariants: [{ name: "@example/writer", version: "0.7.0" }] });
    expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
  });

  it("refuses a client-edited file and a deleted one, and still computes every other path", () => {
    const edited = { ...second, files: second.files.map((file) => (file.path === "clossys/brief.json" ? { ...file, sha256: sha("the client's brief") } : file)) };
    const deleted = { ...second, files: second.files.filter((file) => file.path !== ".cursor/skills/clossys-writer") };
    for (const [observation, path, reason, item] of [
      [edited, "clossys/brief.json", "client-edited", "brief"],
      [deleted, ".cursor/skills/clossys-writer", "deleted", "skills"],
    ] as const) {
      const result = run(withSite(observation, [first]));
      const site = setFor(result.changeSets, SITE.id);
      expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
      expect(site.refused).toEqual([{ path, reason, item }]);
      expect(site.files.map((file) => file.path)).not.toContain(path);
      expect(wholeFiles(site)).toHaveLength(wholeFiles(first).length - 1);
      for (const file of wholeFiles(site)) expect(file, file.path).toMatchObject({ before: (file as { after: string }).after });
      expect(siteEntry(result)).toMatchObject({ verdict: "indeterminate", checks: [{ check: "V6", verdict: "satisfied" }, { check: "V8", verdict: "indeterminate", rule: reason }] });
    }
  });

  it("refuses a client-edited key and a deleted one", () => {
    const writer = (value: string | null) => ({
      ...second,
      manifestEntries: second.manifestEntries.flatMap((entry) => (entry.name !== "@example/writer" ? [entry] : value === null ? [] : [{ ...entry, value }])),
    });
    for (const [observation, reason] of [
      [writer("^0.7.0"), "client-edited"],
      [writer(null), "deleted"],
    ] as const) {
      const result = run(withSite(observation, [first]));
      const site = setFor(result.changeSets, SITE.id);
      expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
      expect(site.refused).toEqual([{ file: "package.json", pointer: "/devDependencies/@example~1writer", reason, item: "example-owner/site:@example/writer" }]);
      expect(site.keys).toEqual([]);
      expect(siteEntry(result).checks).toContainEqual({ check: "V8", verdict: "indeterminate", rule: reason });
    }
  });

  it("skips, as violated integrity-mismatch and outside the bundle digest, an owned key at the desired version the lockfile resolves at another integrity", () => {
    for (const lockedPackages of [
      second.lockedPackages.map((locked) => (locked.name === "@example/writer" ? { ...locked, integrity: STARTER.integrity } : locked)),
      second.lockedPackages.filter((locked) => locked.name !== "@example/writer"),
    ]) {
      const { bundle, changeSets } = run(withSite({ ...second, lockedPackages }, [first]));
      expect(changeSets.map((set) => set.repository.id)).toEqual([DOCS.id]);
      expect(bundle.repositories[0]).toEqual({ id: SITE.id, verdict: "violated", reason: "integrity-mismatch", checks: [] });
      expect(bundle.bundleDigest).toBe(bundleDigest(planDigest(PLAN), [{ id: DOCS.id, changeSetDigest: changeSets[0]!.changeSetDigest }]));
      expect(validateApplyBundle(bundle)).toEqual({ valid: true });
    }
  });

  it("reports a trusted row the desired state no longer names as removal-unbuilt, and leaves it unnamed", () => {
    const fewer = clone(PLAN) as unknown as { staffing: { repository: string; roles: string[] }[] };
    fewer.staffing[0]!.roles = ["strategist"];
    const fewerPlan = fewer as unknown as AdvisorPlan;
    const result = run(withSite(second, [first], { plan: fewerPlan, authorization: { ...INPUTS.authorization!, planDigest: planDigest(fewerPlan) } }));
    const site = setFor(result.changeSets, SITE.id);
    expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
    const touched = [...site.files.map((file) => file.path), ...site.refused.flatMap((refusal) => ("path" in refusal ? [refusal.path] : []))];
    expect(touched.filter((path) => path.includes("clossys-writer"))).toEqual([]);
    expect(siteEntry(result)).toMatchObject({ verdict: "indeterminate", checks: [{ check: "V6", verdict: "satisfied" }, { check: "V8", verdict: "indeterminate", rule: "removal-unbuilt" }] });
    // Every row the plan still names is kept, so nothing else is reported.
    expect(siteEntry(run(withSite(second, [first]))).checks).toContainEqual({ check: "V8", verdict: "satisfied" });
  });

  it("skips a repository whose ledger is not trusted, with the rule as its reason, outside the bundle digest", () => {
    const setup = corpusSet("setup-site");
    const generation1 = corpusLedger("setup-generation-1");
    const forged = clone(generation1) as unknown as { files: { path: string; after: string }[] };
    forged.files.find((row) => row.path === "clossys/brief.json")!.after = sha("a brief the flow never wrote");
    // A ledger with no package rows, so its repository id can differ without breaking L10.
    const plain = clone(PLAN) as unknown as Record<string, unknown>;
    delete plain.packages;
    delete plain.resolution;
    const plainInputs = { ...INPUTS, plan: plain as unknown as AdvisorPlan, authorization: null };
    const plainSet = setFor(run(plainInputs).changeSets, SITE.id);
    const renamed = readInstalledLedger(renderInstalledLedger(null, plainSet, { kind: "approved", subjectDigest: plainSet.bundle }, [])) as unknown as { repository: { id: string } };
    renamed.repository.id = "example-owner/site-renamed";
    for (const [ledger, held, reason, inputs] of [
      ["not a ledger", [], "ledger-unreadable", INPUTS],
      [serializeInstalledLedger(generation1).replace("R_exampleSite1", "R_exampleOther1"), [setup], "identity", INPUTS],
      [serializeInstalledLedger(renamed as unknown as InstalledLedger), [plainSet], "renamed", plainInputs],
      [serializeInstalledLedger(generation1), [], "ledger-chain", INPUTS],
      [serializeInstalledLedger(forged as unknown as InstalledLedger), [setup], "ledger-foreign-row", INPUTS],
    ] as const) {
      const { bundle, changeSets } = run({ ...inputs, repositories: [{ ...SITE, ledger }, DOCS], heldChangeSets: held });
      expect(changeSets.map((set) => set.repository.id), reason).toEqual([DOCS.id]);
      expect(bundle.repositories[0], reason).toEqual({ id: SITE.id, verdict: "indeterminate", reason, checks: [] });
      expect(bundle.bundleDigest, reason).toBe(bundleDigest(planDigest(inputs.plan), [{ id: DOCS.id, changeSetDigest: changeSets[0]!.changeSetDigest }]));
      expect(validateApplyBundle(bundle), reason).toEqual({ valid: true });
    }
    // The same corpus ledger, with the set that wrote it held, is trusted.
    expect(setFor(run(withSite(overCorpusLedger(generation1), [setup])).changeSets, SITE.id).ledger).toEqual({ generation: 1 });
  });
});

describe("setup templates in an apply set", () => {
  const setup = corpusSet("setup-site");
  const generation1 = corpusLedger("setup-generation-1");
  const templateFiles = (set: RepositoryChangeSet) => set.files.filter((file) => TEMPLATE_IDS.includes(file.item));

  it("keeps each template the trusted ledger records, exactly as the corpus apply-after-setup set does", () => {
    const result = run(withSite(overCorpusLedger(generation1), [setup]));
    const site = setFor(result.changeSets, SITE.id);
    const corpus = corpusSet("apply-after-setup");
    expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
    expect(site.items.filter((item) => TEMPLATE_IDS.includes(item.id))).toEqual(corpus.items.filter((item) => TEMPLATE_IDS.includes(item.id)));
    expect(templateFiles(site)).toEqual(templateFiles(corpus));
    expect(site.pathAllowList).toEqual(corpus.pathAllowList);
    expect(site.refused).toEqual([]);
    expect(siteEntry(result).checks).toContainEqual({ check: "V8", verdict: "satisfied" });
  });

  it("refuses a client-edited template and a deleted one, and keeps the rest", () => {
    const observed = overCorpusLedger(generation1);
    const files = observed.files
      .filter((file) => file.path !== ".starter/request.json")
      .map((file) => (file.path === ".github/workflows/clossys-ci.yml" ? { ...file, sha256: sha("the client's CI") } : file));
    const result = run(withSite({ ...observed, files }, [setup]));
    const site = setFor(result.changeSets, SITE.id);
    expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
    expect(site.refused).toEqual([
      { path: ".github/workflows/clossys-ci.yml", reason: "client-edited", item: "ci-template" },
      { path: ".starter/request.json", reason: "deleted", item: "starter-request" },
    ]);
    expect(templateFiles(site).map((file) => file.path)).toEqual([
      ".github/scripts/clossys-collect-adoption-snapshot.mjs",
      ".github/workflows/clossys-adoption-decision.yml",
      ".github/workflows/clossys-adoption-evidence.yml",
      ".github/workflows/clossys-path-scope.yml",
    ]);
    expect(siteEntry(result).checks.filter((check) => check.check === "V8")).toEqual([
      { check: "V8", verdict: "indeterminate", rule: "client-edited" },
      { check: "V8", verdict: "indeterminate", rule: "deleted" },
    ]);
  });

  it("adds no template item when the ledger records none", () => {
    const site = setFor(run().changeSets, SITE.id);
    expect(site.items.filter((item) => TEMPLATE_IDS.includes(item.id))).toEqual([]);
    expect(site.pathAllowList.filter((pattern) => pattern.startsWith(".github") || pattern.startsWith(".starter"))).toEqual([]);
  });

  it("skips as template-rows-partial a repository whose trusted ledger records only some of a template act's files", () => {
    // A valid setup set may refuse one of a template act's paths (code rule C9 names it by a path refusal); RENDER then records
    // the act's other files only. So a trusted ledger can hold a partial template, and the apply planner cannot keep it as that act.
    const partial = clone(setup) as unknown as { files: { path: string }[]; refused: unknown[]; branch: string; pullRequest: { title: string }; changeSetDigest: string };
    partial.files = partial.files.filter((file) => file.path !== ".github/workflows/clossys-adoption-decision.yml");
    partial.refused = [{ path: ".github/workflows/clossys-adoption-decision.yml", reason: "unowned-existing", item: "caller-workflow" }];
    const digest = changeSetDigest(partial as unknown as RepositoryChangeSet);
    partial.changeSetDigest = digest;
    partial.branch = `clossys/apply-${digest.slice(7, 19)}`;
    partial.pullRequest = { title: `Clossys: apply plan ${digest.slice(7, 19)}` };
    const held = partial as unknown as RepositoryChangeSet;
    expect(validateRepositoryChangeSet(held)).toEqual({ valid: true });
    const setupPackages = setup.items.flatMap((item) => ("planItem" in item ? [{ planItem: item.planItem, act: item.act, ...item.package, placement: item.placement }] : []));
    const deferred = setup.deferred.map((deferral) => {
      const act = PLAN.packages!.find((entry) => entry.planItem === deferral.planItem)!;
      return { planItem: act.planItem, act: act.act, name: act.name, version: act.version, integrity: act.integrity, placement: act.placement };
    });
    const ledger = readInstalledLedger(renderInstalledLedger(null, held, { kind: "approved", subjectDigest: held.bundle }, [...setupPackages, ...deferred]))!;
    expect(ledger.files.map((row) => row.path).filter((path) => path.includes("adoption"))).toEqual([
      ".github/scripts/clossys-collect-adoption-snapshot.mjs",
      ".github/workflows/clossys-adoption-evidence.yml",
    ]);
    const { bundle, changeSets } = run(withSite(overCorpusLedger(ledger), [held]));
    expect(changeSets.map((set) => set.repository.id)).toEqual([DOCS.id]);
    expect(bundle.repositories[0]).toEqual({ id: SITE.id, verdict: "indeterminate", reason: "template-rows-partial", checks: [] });
    expect(validateApplyBundle(bundle)).toEqual({ valid: true });
  });

  it("adds no exempt-release-age or declare-root-entry item to carry the ledger's entries rows, and reports no removal for the edited profile", () => {
    const profile = { path: "governance/repository-profile.json", rootVocabulary: "checked" as const, undeclaredRoots: [], prohibitedRoots: [] };
    const observed = overCorpusLedger(corpusLedger("setup-with-root-entries"), { repositoryProfile: profile });
    const result = run(withSite(observed, [corpusSet("setup-site-root-entries")]));
    const site = setFor(result.changeSets, SITE.id);
    expect(validateRepositoryChangeSet(site)).toEqual({ valid: true });
    expect(site.items.map((item) => item.act)).not.toContain("exempt-release-age");
    expect(site.items.map((item) => item.act)).not.toContain("declare-root-entry");
    expect(site.files.map((file) => file.path)).not.toContain("governance/repository-profile.json");
    expect(siteEntry(result).checks).toContainEqual({ check: "V8", verdict: "satisfied" });
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

  it("reaches exactly the planner, the contract, digest and ledger modules, and the generated contract data", () => {
    expect([...result.visited].sort()).toEqual(
      [
        "change-set-contract.ts",
        "change-set-digest.ts",
        "generated/contract-schema.generated.ts",
        "generated/package-scope.generated.ts",
        "generated/plan-contracts.generated.ts",
        "ledger-contract.ts",
        "ledger-trust.ts",
        "plan-bundle.ts",
        "plan-contract.ts",
        "plan-digest.ts",
        "plan-rules.ts",
      ]
        .map(at)
        .sort(),
    );
  });

  it("would catch a module that performs I/O", () => {
    expect(purity([at("apply-plan-cli.ts")]).findings.map((finding) => finding.rule)).toContain("builtin-not-allowed");
  });
});
