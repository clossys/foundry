import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertImplementedContract } from "./generated/contract-schema.generated.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import { bundleDigest } from "./change-set-digest.js";
import {
  applyBundleViolations, isSafeRelativePath, matchesPathPattern, repositoryChangeSetViolations, validateApplyBundle, validateRepositoryChangeSet,
} from "./change-set-contract.js";
import type { ApplyBundle, RepositoryChangeSet } from "./change-set-contract.js";

/*
 * Issue #1178. The shape of the repository change-set and apply-bundle
 * contracts, packed into this package, and their code rules. Reading
 * repository files here is test-only.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");
const corpus = JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as { changeSets: { name: string; changeSet: RepositoryChangeSet }[] };
const SET = corpus.changeSets.find((entry) => entry.name === "apply-with-packages")!.changeSet;
const SETUP = corpus.changeSets.find((entry) => entry.name === "setup-public")!.changeSet;
type Loose = Record<string, any>;
const loose = (value: unknown): Loose => structuredClone(value) as Loose;
const rulesOf = (value: unknown) => repositoryChangeSetViolations(value).map((violation) => `${violation.rule} ${violation.path}`);

const PLAN_DIGEST = SET.planDigest;
const BUNDLE: ApplyBundle = {
  schemaVersion: 1,
  kind: "clossys.apply-bundle",
  mode: "report",
  plan: { path: "clossys/advisor/plan.json", digest: PLAN_DIGEST, committed: true },
  snapshot: null,
  engine: SET.engine,
  authorization: null,
  computedAt: "2026-09-24T12:00:00Z",
  repositories: [
    { id: "example-owner/site", verdict: "satisfied", phase: "apply", changeSet: SET.changeSetDigest, checks: [{ check: "V6", verdict: "satisfied" }] },
    { id: "example-owner/docs", verdict: "indeterminate", reason: "not-in-inventory", checks: [] },
  ],
  bundleDigest: bundleDigest(PLAN_DIGEST, [{ id: "example-owner/site", changeSetDigest: SET.changeSetDigest }]),
};

describe("packed change-set and bundle contracts", () => {
  it("are the docs/contracts files, unchanged, packed after the plan and brief contracts", () => {
    expect(Object.keys(PLAN_CONTRACTS)).toEqual(["advisor-plan.json", "engagement-brief.json", "engagement-context.json", "repository-change-set.json", "apply-bundle.json"]);
    for (const name of ["repository-change-set.json", "apply-bundle.json"]) expect(PLAN_CONTRACTS[name], name).toEqual(JSON.parse(read(`docs/contracts/${name}`)));
  });

  it("use only keywords the checker implements, in every subschema, with no new keyword", () => {
    for (const name of ["repository-change-set.json", "apply-bundle.json"]) expect(() => assertImplementedContract(PLAN_CONTRACTS[name]!), name).not.toThrow();
  });

  it("declare every item act the apply flow will use, including those nothing computes yet", () => {
    const definitions = PLAN_CONTRACTS["repository-change-set.json"]!.definitions as Record<string, { properties: { act: { const?: string; enum?: string[] } } }>;
    const acts = ["writeRecordItem", "composeSkillsItem", "packageItem", "exemptReleaseAgeItem", "plainItem"].flatMap((name) => {
      const act = definitions[name]!.properties.act;
      return act.const !== undefined ? [act.const] : act.enum!;
    });
    expect(acts.sort()).toEqual(
      ["add-caller-workflow", "add-ci-template", "add-path-scope-job", "compose-skills", "exempt-release-age", "install", "pin-starter", "write-ledger", "write-record", "write-starter-request"].sort(),
    );
  });

  it("accept an item of every act", () => {
    const set = loose(SET);
    set.items.push(
      { id: "workflow", act: "add-caller-workflow" },
      { id: "request", act: "write-starter-request" },
      { id: "ci", act: "add-ci-template" },
      { id: "scope", act: "add-path-scope-job" },
      { id: "age", act: "exempt-release-age", scope: "@example", surface: "npmrc", path: ".npmrc" },
    );
    expect(repositoryChangeSetViolations(set).filter((violation) => violation.rule === "schema")).toEqual([]);
  });

  it("refuse an unknown act, an unknown key and a derived file claiming derived: false", () => {
    const act = loose(SET);
    act.items[0] = { id: "brief", act: "delete-everything" };
    expect(validateRepositoryChangeSet(act).valid).toBe(false);
    const key = loose(SET);
    key.state = "planned";
    expect(validateRepositoryChangeSet(key)).toEqual({ valid: false, reason: "changeSet.state is not a field the contract declares, and unknown fields are refused" });
    const derived = loose(SET);
    derived.files[3].derived = false;
    expect(validateRepositoryChangeSet(derived).valid).toBe(false);
  });

  it("refuse a path with a .. segment, an empty segment or a leading slash", () => {
    for (const path of ["../outside", "clossys/../x", "clossys//x", "/etc/x", "clossys/.", "a\\b"]) {
      expect(isSafeRelativePath(path), path).toBe(false);
      const set = loose(SET);
      set.files[0].path = path;
      expect(repositoryChangeSetViolations(set).some((violation) => violation.rule === "schema" && violation.path.startsWith("files[0]")), path).toBe(true);
    }
    expect(isSafeRelativePath(".agents/skills/clossys-writer/SKILL.md")).toBe(true);
  });
});

describe("path patterns", () => {
  it("match * within one segment and ** across whole segments", () => {
    expect(matchesPathPattern("clossys/brief.json", "clossys/**")).toBe(true);
    expect(matchesPathPattern("clossys/.state/installed.json", "clossys/**")).toBe(true);
    expect(matchesPathPattern(".agents/skills/clossys-writer/SKILL.md", ".agents/skills/clossys-*/**")).toBe(true);
    expect(matchesPathPattern(".agents/skills/writer/SKILL.md", ".agents/skills/clossys-*/**")).toBe(false);
    expect(matchesPathPattern("package.json", "package.json")).toBe(true);
    expect(matchesPathPattern("apps/package.json", "package.json")).toBe(false);
    expect(matchesPathPattern("clossys", "clossys/**")).toBe(true);
    expect(matchesPathPattern("clossys/../AGENTS.md", "clossys/**")).toBe(false);
  });
});

describe("change-set code rules C1-C6", () => {
  it("accept the corpus sets", () => {
    expect(repositoryChangeSetViolations(SET)).toEqual([]);
    expect(repositoryChangeSetViolations(SETUP)).toEqual([]);
  });

  it("C1: refuse two items with one id", () => {
    const set = loose(SET);
    set.items[1].id = "brief";
    expect(rulesOf(set)).toContain("C1 items[1].id");
  });

  it("C2: refuse a file, key, refusal or invariant naming no item", () => {
    const set = loose(SET);
    set.files[0].item = "missing";
    set.keys[0].item = "missing";
    set.files[3].invariants[0].item = "missing";
    set.refused.push({ path: "clossys/brief.json", reason: "unowned-existing", item: "missing" });
    expect(rulesOf(set)).toEqual(expect.arrayContaining(["C2 files[0].item", "C2 keys[0].item", "C2 files[3].invariants[0].item", "C2 refused[0].item"]));
  });

  it("C3: refuse a repeated path, a repeated pointer and a path outside pathAllowList", () => {
    const set = loose(SET);
    set.files[2].path = set.files[1].path;
    set.keys[1].pointer = set.keys[0].pointer;
    set.files[0].path = "AGENTS.md";
    expect(rulesOf(set)).toEqual(expect.arrayContaining(["C3 files[2].path", "C3 keys[1].pointer", "C3 files[0].path"]));
  });

  it("C4: refuse a ledger generation that does not follow, a missing ledger item, and a ledger file elsewhere", () => {
    const generation = loose(SET);
    generation.ledger.generation = 1;
    expect(rulesOf(generation)).toContain("C4 files[4]");
    const negative = loose(SET);
    negative.ledger.generation = -1;
    negative.files[4].invariants = [{ ledgerGeneration: 0 }];
    expect(rulesOf(negative)).toContain("C4 ledger.generation");
    const missing = loose(SET);
    missing.items = missing.items.filter((item: Loose) => item.act !== "write-ledger");
    expect(rulesOf(missing)).toContain("C4 items");
    const elsewhere = loose(SET);
    elsewhere.files[4].path = "clossys/.state/other.json";
    expect(rulesOf(elsewhere)).toContain("C4 files[4]");
  });

  it("C5: refuse a recorded digest, branch or title that is not this set's", () => {
    const set = loose(SET);
    set.changeSetDigest = SETUP.changeSetDigest;
    set.branch = SETUP.branch;
    set.pullRequest = { title: SETUP.pullRequest.title };
    expect(rulesOf(set)).toEqual(expect.arrayContaining(["C5 changeSetDigest", "C5 branch", "C5 pullRequest.title"]));
  });

  it("C6: refuse a plan item that is both an item and deferred", () => {
    const set = loose(SET);
    set.deferred.push({ planItem: set.items[3].planItem, reason: "after-setup" });
    expect(rulesOf(set)).toContain("C6 deferred[0].planItem");
  });

  it("never echo a value in a reason", () => {
    const set = loose(SET);
    set.items[1].id = "brief";
    set.files[0].item = "a-secret-value";
    const validation = validateRepositoryChangeSet(set);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.reason).not.toContain("a-secret-value");
  });
});

describe("apply-bundle contract", () => {
  it("accepts a report-mode bundle with a computed and a skipped repository", () => {
    expect(validateApplyBundle(BUNDLE)).toEqual({ valid: true });
  });

  it("has no repository state: a state field, a planned mode or a skipped verdict of satisfied is refused", () => {
    const state = loose(BUNDLE);
    state.repositories[0].state = "planned";
    expect(validateApplyBundle(state).valid).toBe(false);
    const mode = loose(BUNDLE);
    mode.mode = "planned";
    expect(validateApplyBundle(mode).valid).toBe(false);
    const skipped = loose(BUNDLE);
    skipped.repositories[1].verdict = "satisfied";
    expect(validateApplyBundle(skipped).valid).toBe(false);
  });

  it("A1: refuses two entries for one repository, compared case-insensitively", () => {
    const bundle = loose(BUNDLE);
    bundle.repositories[1].id = "Example-Owner/Site";
    expect(applyBundleViolations(bundle).map((violation) => `${violation.rule} ${violation.path}`)).toEqual(["A1 repositories[1].id"]);
  });

  it("A2: refuses a bundle digest that is not over the plan digest and the computed repositories", () => {
    const bundle = loose(BUNDLE);
    bundle.bundleDigest = bundleDigest(PLAN_DIGEST, []);
    expect(applyBundleViolations(bundle).map((violation) => violation.rule)).toEqual(["A2"]);
    const skippedCounted = loose(BUNDLE);
    skippedCounted.bundleDigest = bundleDigest(PLAN_DIGEST, [{ id: "example-owner/site", changeSetDigest: SET.changeSetDigest }, { id: "example-owner/docs", changeSetDigest: SETUP.changeSetDigest }]);
    expect(applyBundleViolations(skippedCounted).map((violation) => violation.rule)).toEqual(["A2"]);
  });
});
