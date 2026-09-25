import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertImplementedContract } from "./generated/contract-schema.generated.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import { bundleDigest, changeSetDigest } from "./change-set-digest.js";
import {
  AUTHORIZATION_ABSENT, AUTHORIZATION_PLAN_MISMATCH, applyBundleViolations, isPathPattern, isSafeRelativePath, lockfilePath, matchesPathPattern, repositoryChangeSetViolations,
  validateApplyBundle, validateRepositoryChangeSet,
} from "./change-set-contract.js";
import type { ApplyBundle, RepositoryChangeSet } from "./change-set-contract.js";

/*
 * Issue #1178. The shape of the repository change-set and apply-bundle
 * contracts, packed into this package, and their code rules: each rule is
 * shown refusing a set that would otherwise validate, resealed so its digest,
 * branch and title are consistent and only the rule under test can fire.
 * Reading repository files here is test-only.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");
const corpus = JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as { changeSets: { name: string; changeSet: RepositoryChangeSet }[] };
const SET = corpus.changeSets.find((entry) => entry.name === "apply-with-packages")!.changeSet;
const SETUP = corpus.changeSets.find((entry) => entry.name === "setup-public")!.changeSet;
type Loose = Record<string, any>;
const loose = (value: unknown): Loose => structuredClone(value) as Loose;
const STRATEGIST = "example-owner/site:@example/strategist";
const WRITER = "example-owner/site:@example/writer";
const STARTER = "example-owner/site:@example/starter";

/** Recomputes the digest, branch and title, so a mutation is judged by every rule except C5. */
function reseal(set: Loose): Loose {
  const digest = changeSetDigest(set);
  set.changeSetDigest = digest;
  set.branch = `clossys/apply-${digest.slice(7, 19)}`;
  set.pullRequest = { title: `Clossys: apply plan ${digest.slice(7, 19)}` };
  return set;
}
const rulesOf = (value: unknown) => repositoryChangeSetViolations(value).map((violation) => `${violation.rule} ${violation.path}`);
const ruleIds = (value: unknown) => [...new Set(repositoryChangeSetViolations(value).map((violation) => violation.rule))].sort();
const fileIndex = (set: Loose, path: string) => (set.files as Loose[]).findIndex((file) => file.path === path);
const itemIndex = (set: Loose, id: string) => (set.items as Loose[]).findIndex((item) => item.id === id);
const fileAt = (set: Loose, path: string) => set.files[fileIndex(set, path)] as Loose;
const itemAt = (set: Loose, id: string) => set.items[itemIndex(set, id)] as Loose;

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

  it("accept an item of every act, and optional tooling", () => {
    const set = loose(SET);
    set.items.push(
      { id: "age", act: "exempt-release-age", scope: "@example", surface: "npmrc", path: ".npmrc" },
      { id: "ci", act: "add-ci-template" },
      { id: "request", act: "write-starter-request" },
      { id: "scope", act: "add-path-scope-job" },
      { id: "workflow", act: "add-caller-workflow" },
    );
    set.tooling = [{ tool: "npm", version: "11.6.1" }];
    expect(repositoryChangeSetViolations(set).filter((violation) => violation.rule === "schema")).toEqual([]);
  });

  it("refuse an unknown act, an unknown key and a derived file claiming derived: false", () => {
    const act = loose(SET);
    act.items[itemIndex(act, "brief")] = { id: "brief", act: "delete-everything" };
    expect(validateRepositoryChangeSet(act).valid).toBe(false);
    const key = loose(SET);
    key.state = "planned";
    expect(validateRepositoryChangeSet(key)).toEqual({ valid: false, reason: "changeSet.state is not a field the contract declares, and unknown fields are refused" });
    const derived = loose(SET);
    fileAt(derived, "package-lock.json").derived = false;
    expect(validateRepositoryChangeSet(derived).valid).toBe(false);
  });

  it("refuse a path with a .. segment, an empty segment or a leading slash", () => {
    for (const path of ["../outside", "clossys/../x", "clossys//x", "/etc/x", "clossys/.", "a\\b"]) {
      expect(isSafeRelativePath(path), path).toBe(false);
      const set = loose(SET);
      fileAt(set, "clossys/brief.json").path = path;
      expect(repositoryChangeSetViolations(set).some((violation) => violation.rule === "schema" && violation.path.startsWith("files[")), path).toBe(true);
    }
    expect(isSafeRelativePath(".agents/skills/clossys-writer/SKILL.md")).toBe(true);
  });

  it("limit pathAllowList to the owned patterns: no ** alone, no segment with ** inside it, nothing outside the list", () => {
    for (const pattern of ["**", "a**b", "clossys/x**", "**/package.json", "src/**", "clossys/**/x**"]) {
      const set = loose(SET);
      set.pathAllowList = [...set.pathAllowList, pattern].sort();
      expect(repositoryChangeSetViolations(set).some((violation) => violation.rule === "schema" && violation.path.startsWith("pathAllowList")), pattern).toBe(true);
    }
    expect(isPathPattern("**")).toBe(false);
    expect(isPathPattern("a**b")).toBe(false);
    expect(isPathPattern("clossys/**")).toBe(true);
  });
});

describe("path patterns", () => {
  it("match * within one segment and ** across whole segments, and nothing for a pattern the contract refuses", () => {
    expect(matchesPathPattern("clossys/brief.json", "clossys/**")).toBe(true);
    expect(matchesPathPattern("clossys/.state/installed.json", "clossys/**")).toBe(true);
    expect(matchesPathPattern(".agents/skills/clossys-writer/SKILL.md", ".agents/skills/clossys-*/**")).toBe(true);
    expect(matchesPathPattern(".agents/skills/writer/SKILL.md", ".agents/skills/clossys-*/**")).toBe(false);
    expect(matchesPathPattern("package.json", "package.json")).toBe(true);
    expect(matchesPathPattern("apps/package.json", "package.json")).toBe(false);
    expect(matchesPathPattern("clossys/../AGENTS.md", "clossys/**")).toBe(false);
    expect(matchesPathPattern("anything/at/all", "**")).toBe(false);
    expect(matchesPathPattern("ab", "a**b")).toBe(false);
  });

  it("find the lockfile path from what was observed", () => {
    expect(lockfilePath({ packageManager: "npm", lockfile: "package-lock.json" })).toBe("package-lock.json");
    expect(lockfilePath({ packageManager: "pnpm", lockfile: "none" })).toBe("pnpm-lock.yaml");
    expect(lockfilePath({ packageManager: "yarn", lockfile: "none" })).toBe("yarn.lock");
    expect(lockfilePath({ packageManager: "none", lockfile: "none" })).toBeNull();
  });
});

describe("change-set code rules C1-C10", () => {
  it("accept the corpus sets", () => {
    expect(repositoryChangeSetViolations(SET)).toEqual([]);
    expect(repositoryChangeSetViolations(SETUP)).toEqual([]);
  });

  it("C1: refuse two items with one id", () => {
    const set = loose(SET);
    set.items.push({ ...itemAt(set, "brief") });
    set.items.sort((a: Loose, b: Loose) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    expect(ruleIds(reseal(set))).toContain("C1");
  });

  it("C2: refuse a file, key, refusal or invariant naming no item", () => {
    const set = loose(SET);
    fileAt(set, "clossys/brief.json").item = "missing";
    set.keys[0].item = "missing";
    fileAt(set, "package-lock.json").invariants[0].item = "missing";
    set.refused.push({ path: "clossys/zz.json", reason: "unowned-existing", item: "missing" });
    const lock = fileIndex(set, "package-lock.json");
    const brief = fileIndex(set, "clossys/brief.json");
    expect(rulesOf(reseal(set))).toEqual(expect.arrayContaining([`C2 files[${brief}].item`, "C2 keys[0].item", `C2 files[${lock}].invariants[0].item`, "C2 refused[0].item"]));
  });

  describe("C3", () => {
    it("refuses a repeated path, also when it differs only in letter case, and a repeated pointer", () => {
      const set = loose(SET);
      set.files.push({ ...fileAt(set, "clossys/brief.json"), path: "clossys/Brief.json" });
      set.files.sort((a: Loose, b: Loose) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      set.keys[1].pointer = set.keys[0].pointer;
      const rules = rulesOf(reseal(set));
      expect(rules.some((rule) => rule.startsWith("C3 files["))).toBe(true);
      expect(rules).toContain("C3 keys[1].pointer");
    });

    it("refuses a path both written and refused, compared case-insensitively, and a pointer both written and refused", () => {
      const set = loose(SET);
      set.refused.push({ path: "CLOSSYS/brief.json", reason: "unowned-existing", item: "brief" });
      set.refused.push({ file: "package.json", pointer: set.keys[0].pointer, reason: "unowned-existing", item: set.keys[0].item });
      set.refused.sort((a: Loose, b: Loose) => ((a.path ?? a.file) < (b.path ?? b.file) ? -1 : 1));
      expect(rulesOf(reseal(set))).toEqual(expect.arrayContaining(["C3 refused[0].path", "C3 refused[1].pointer"]));
    });

    it("refuses a whole file, a key's file or an item path outside pathAllowList", () => {
      const set = loose(SET);
      set.pathAllowList = set.pathAllowList.filter((pattern: string) => pattern !== "package.json");
      set.items.push({ id: "age", act: "exempt-release-age", scope: "@example", surface: "npmrc", path: ".npmrc" });
      set.items.sort((a: Loose, b: Loose) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      set.files.push({ path: "AGENTS.md", mode: "100644", before: null, after: SET.planDigest, item: "brief" });
      set.files.sort((a: Loose, b: Loose) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const rules = rulesOf(reseal(set));
      expect(rules).toEqual(expect.arrayContaining(["C3 keys[0].file", "C3 keys[1].file", `C3 items[${itemIndex(set, "age")}].path`, `C3 files[${fileIndex(set, "AGENTS.md")}].path`]));
    });
  });

  it("C4: refuse a ledger generation that does not follow, a missing ledger item, and a ledger file elsewhere", () => {
    const ledger = () => fileIndex(SET as unknown as Loose, "clossys/.state/installed.json");
    const generation = loose(SET);
    generation.ledger.generation = 1;
    expect(rulesOf(reseal(generation))).toContain(`C4 files[${ledger()}]`);
    const negative = loose(SET);
    negative.ledger.generation = -1;
    fileAt(negative, "clossys/.state/installed.json").invariants = [{ ledgerGeneration: 0 }];
    expect(rulesOf(reseal(negative))).toContain("C4 ledger.generation");
    const missing = loose(SET);
    missing.items = missing.items.filter((item: Loose) => item.act !== "write-ledger");
    expect(rulesOf(reseal(missing))).toContain("C4 items");
  });

  it("C5: refuse a recorded digest, branch or title that is not this set's", () => {
    const set = loose(SET);
    set.changeSetDigest = SETUP.changeSetDigest;
    set.branch = SETUP.branch;
    set.pullRequest = { title: SETUP.pullRequest.title };
    expect(rulesOf(set)).toEqual(expect.arrayContaining(["C5 changeSetDigest", "C5 branch", "C5 pullRequest.title"]));
  });

  it("C6: refuse a plan item that is both an item and deferred", () => {
    const set = loose(SETUP);
    set.deferred.push({ planItem: "example-owner/docs:@example/starter", reason: "after-setup" });
    set.deferred.sort((a: Loose, b: Loose) => (a.planItem < b.planItem ? -1 : 1));
    expect(ruleIds(reseal(set))).toContain("C6");
  });

  describe("C7: only the ledger and the lockfile may be derived (the digest hole)", () => {
    // Each repro marks a file derived, which takes its bytes out of the digest, gives it a junk invariant, and reseals.
    const junk = { item: STRATEGIST, name: "@example/strategist", version: "1.4.0", integrity: SET.engine.integrity };
    it("refuses package.json marked derived", () => {
      const set = loose(SET);
      set.files.push({ path: "package.json", mode: "100644", derived: true, item: STRATEGIST, invariants: [junk] });
      set.files.sort((a: Loose, b: Loose) => (a.path < b.path ? -1 : 1));
      expect(repositoryChangeSetViolations(reseal(set)).some((violation) => violation.rule !== "C8")).toBe(true);
      expect(validateRepositoryChangeSet(set).valid).toBe(false);
    });

    it("refuses a brief or a SKILL.md marked derived with a junk invariant, and the digest would not have seen their bytes", () => {
      for (const path of ["clossys/brief.json", ".agents/skills/clossys-writer/SKILL.md"]) {
        const set = loose(SET);
        const file = fileAt(set, path);
        delete file.before;
        delete file.after;
        Object.assign(file, { derived: true, invariants: [junk] });
        const sealed = reseal(set);
        const moved = loose(sealed);
        fileAt(moved, path).after = SET.planDigest;
        expect(changeSetDigest(moved), path).toBe(sealed.changeSetDigest);
        expect(validateRepositoryChangeSet(sealed).valid, path).toBe(false);
        expect(ruleIds(sealed), path).toContain("schema");
      }
    });

    it("refuses a lockfile that is not the observed one, a second lockfile, a whole-file lockfile, and a package invariant in the ledger", () => {
      const other = loose(SET);
      fileAt(other, "package-lock.json").path = "yarn.lock";
      other.pathAllowList = [...other.pathAllowList, "yarn.lock"].sort();
      expect(ruleIds(reseal(other))).toContain("C7");
      const whole = loose(SET);
      const lock = fileAt(whole, "package-lock.json");
      delete lock.derived;
      delete lock.invariants;
      Object.assign(lock, { before: null, after: SET.planDigest });
      expect(ruleIds(reseal(whole))).toContain("C7");
      const ledger = loose(SET);
      fileAt(ledger, "clossys/.state/installed.json").invariants = [{ ledgerGeneration: 1 }, junk];
      expect(ruleIds(reseal(ledger))).toEqual(expect.arrayContaining(["C4", "C7"]));
      const ledgerInLock = loose(SET);
      fileAt(ledgerInLock, "package-lock.json").invariants.push({ ledgerGeneration: 1 });
      expect(ruleIds(reseal(ledgerInLock))).toContain("C7");
    });
  });

  describe("C8: canonical order", () => {
    const swapped = (mutate: (set: Loose) => void) => {
      const set = loose(SET);
      mutate(set);
      return ruleIds(reseal(set));
    };
    it("refuses items, files, keys, invariants and pathAllowList out of order", () => {
      expect(swapped((set) => set.items.reverse())).toContain("C8");
      expect(swapped((set) => set.files.reverse())).toContain("C8");
      expect(swapped((set) => set.keys.reverse())).toContain("C8");
      expect(swapped((set) => fileAt(set, "package-lock.json").invariants.reverse())).toContain("C8");
      expect(swapped((set) => set.pathAllowList.reverse())).toContain("C8");
      expect(swapped((set) => set.pathAllowList.push(set.pathAllowList.at(-1)))).toContain("C8");
    });

    it("refuses refused, deferred, releaseAgeSurfaces and tooling out of order", () => {
      const refused = loose(SETUP);
      refused.refused.push({ path: ".agents/skills/clossys-a/SKILL.md", reason: "unowned-existing", item: "skills" });
      expect(ruleIds(reseal(refused))).toContain("C8");
      const deferred = loose(SETUP);
      deferred.deferred.push({ planItem: "example-owner/docs:@example/a", reason: "after-setup" });
      expect(ruleIds(reseal(deferred))).toContain("C8");
      expect(swapped((set) => set.observed.releaseAgeSurfaces.push({ surface: "npmrc", path: ".a" }))).toContain("C8");
      expect(swapped((set) => (set.tooling = [{ tool: "npm", version: "1.0.0" }, { tool: "node", version: "1.0.0" }]))).toContain("C8");
    });
  });

  describe("C9: each item's writes match the item", () => {
    it("refuses an invariant whose package is not its item's", () => {
      for (const member of ["name", "version", "integrity"] as const) {
        const set = loose(SET);
        const invariant = fileAt(set, "package-lock.json").invariants.find((entry: Loose) => entry.item === WRITER);
        invariant[member] = member === "name" ? "@example/other" : member === "version" ? "9.9.9" : SET.engine.integrity;
        if (member === "name") fileAt(set, "package-lock.json").invariants.sort((a: Loose, b: Loose) => (a.name < b.name ? -1 : 1));
        expect(ruleIds(reseal(set)), member).toContain("C9");
      }
    });

    it("refuses a key whose value or pointer is not its item's, or that names a non-package item", () => {
      const value = loose(SET);
      value.keys[0].after = "9.9.9";
      expect(ruleIds(reseal(value))).toContain("C9");
      const pointer = loose(SET);
      pointer.keys[0].pointer = "/dependencies/@example~1strategist";
      expect(ruleIds(reseal(pointer))).toContain("C9");
      const nonPackage = loose(SET);
      nonPackage.keys[0].item = "brief";
      expect(rulesOf(reseal(nonPackage))).toContain("C9 keys[0].item");
    });

    it("refuses a satisfied item that writes, and an unsatisfied item that writes nothing and is not refused", () => {
      const satisfied = loose(SET);
      satisfied.keys.unshift({ file: "package.json", pointer: "/devDependencies/@example~1starter", before: null, after: "0.9.2", item: STARTER });
      expect(rulesOf(reseal(satisfied))).toContain(`C9 items[${itemIndex(satisfied, STARTER)}]`);
      const silent = loose(SET);
      itemAt(silent, STARTER).satisfiedInBase = false;
      expect(rulesOf(reseal(silent))).toContain(`C9 items[${itemIndex(silent, STARTER)}]`);
      const refusedOnly = loose(SET);
      itemAt(refusedOnly, STARTER).satisfiedInBase = false;
      refusedOnly.refused.push({ file: "package.json", pointer: "/devDependencies/@example~1starter", reason: "unowned-existing", item: STARTER });
      expect(repositoryChangeSetViolations(reseal(refusedOnly))).toEqual([]);
    });

    it("refuses a brief at another path, a missing skill, and a lockfile whose item is not its first invariant's", () => {
      const brief = loose(SET);
      itemAt(brief, "brief").id = "brief";
      fileAt(brief, "clossys/brief.json").path = "clossys/other.json";
      brief.files.sort((a: Loose, b: Loose) => (a.path < b.path ? -1 : 1));
      expect(rulesOf(reseal(brief))).toContain(`C9 items[${itemIndex(brief, "brief")}]`);
      const skill = loose(SET);
      skill.files = skill.files.filter((file: Loose) => file.path !== ".agents/skills/clossys-writer/SKILL.md");
      expect(rulesOf(reseal(skill))).toContain(`C9 items[${itemIndex(skill, "skills")}]`);
      const lock = loose(SET);
      fileAt(lock, "package-lock.json").item = WRITER;
      expect(rulesOf(reseal(lock))).toContain(`C9 files[${fileIndex(lock, "package-lock.json")}].item`);
    });
  });

  it("C9: refuse a pin-starter placed in dependencies, a refusal naming the ledger item, and C8 a repeated refusal", () => {
    const placement = loose(SET);
    itemAt(placement, STARTER).placement = "dependencies";
    expect(rulesOf(reseal(placement))).toContain(`C9 items[${itemIndex(placement, STARTER)}].placement`);
    const ledger = loose(SET);
    ledger.refused.push({ path: "clossys/.state/installed.json", reason: "unowned-existing", item: "ledger" });
    expect(rulesOf(reseal(ledger))).toContain("C9 refused[0].item");
    const repeated = loose(SETUP);
    repeated.refused.push({ ...repeated.refused[0] });
    expect(rulesOf(reseal(repeated))).toContain("C8 refused[1]");
  });

  it("C10: refuse a second pin-starter item", () => {
    const set = loose(SET);
    set.items.push({ ...itemAt(set, STARTER), id: "example-owner/site:@example/starter-2", planItem: "example-owner/site:@example/starter-2" });
    set.items.sort((a: Loose, b: Loose) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    expect(rulesOf(reseal(set))).toContain(`C10 items[${itemIndex(set, "example-owner/site:@example/starter-2")}]`);
  });

  it("C10: refuse an install in a setup set, and a deferral in an apply set", () => {
    const setup = loose(SET);
    setup.phase = "setup";
    expect(ruleIds(reseal(setup))).toContain("C10");
    const apply = loose(SETUP);
    apply.phase = "apply";
    expect(ruleIds(reseal(apply))).toContain("C10");
  });

  it("never echo a value in a reason", () => {
    const set = loose(SET);
    fileAt(set, "clossys/brief.json").item = "a-secret-value";
    const validation = validateRepositoryChangeSet(reseal(set));
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
  });

  it("A3: refuses a verdict that is not the worst of its checks", () => {
    const bundle = loose(BUNDLE);
    bundle.repositories[0].checks = [{ check: "V6", verdict: "indeterminate", rule: "unowned-existing" }];
    expect(applyBundleViolations(bundle).map((violation) => `${violation.rule} ${violation.path}`)).toEqual(["A3 repositories[0].verdict"]);
    const none = loose(BUNDLE);
    none.repositories[0] = { ...none.repositories[0], verdict: "violated", checks: [] };
    expect(applyBundleViolations(none).map((violation) => violation.rule)).toEqual(["A3"]);
  });

  it("A4: requires the authorization-absent check when the bundle records a snapshot and no authorization, and refuses it otherwise", () => {
    const absent = loose(BUNDLE);
    absent.snapshot = { path: "clossys/.state/apply/registry-snapshot.json", digest: PLAN_DIGEST };
    expect(applyBundleViolations(absent).map((violation) => `${violation.rule} ${violation.path}`)).toEqual(["A4 repositories[0].checks"]);
    absent.repositories[0].checks = [{ check: "V3", verdict: "violated", rule: AUTHORIZATION_ABSENT }, { check: "V6", verdict: "satisfied" }];
    absent.repositories[0].verdict = "violated";
    expect(applyBundleViolations(absent)).toEqual([]);
    const authorized = loose(absent);
    authorized.authorization = { planDigest: PLAN_DIGEST, expiresAt: "2026-10-01T00:00:00Z" };
    expect(applyBundleViolations(authorized).map((violation) => violation.rule)).toEqual(["A4"]);
    const staffingOnly = loose(absent);
    staffingOnly.snapshot = null;
    expect(applyBundleViolations(staffingOnly).map((violation) => violation.rule)).toEqual(["A4"]);
  });

  it("A4: requires the mismatch check when the authorization is for another plan, and refuses it otherwise", () => {
    const mismatched = loose(BUNDLE);
    mismatched.authorization = { planDigest: SET.changeSetDigest, expiresAt: "2026-10-01T00:00:00Z" };
    expect(applyBundleViolations(mismatched).map((violation) => violation.rule)).toEqual(["A4"]);
    mismatched.repositories[0].checks = [{ check: "V3", verdict: "violated", rule: AUTHORIZATION_PLAN_MISMATCH }, { check: "V6", verdict: "satisfied" }];
    mismatched.repositories[0].verdict = "violated";
    expect(applyBundleViolations(mismatched)).toEqual([]);
    const spurious = loose(mismatched);
    spurious.authorization = { planDigest: PLAN_DIGEST, expiresAt: "2026-10-01T00:00:00Z" };
    expect(applyBundleViolations(spurious).map((violation) => violation.rule)).toEqual(["A4"]);
  });
});
