import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertImplementedContract } from "./generated/contract-schema.generated.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import { changeSetDigest } from "./change-set-digest.js";
import {
  contentDigest, isPathPattern, isSafeRelativePath, lockfilePath, matchesPathPattern, repositoryChangeSetViolations, validateRepositoryChangeSet,
} from "./change-set-contract.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";

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
const SETUP_SITE = corpus.changeSets.find((entry) => entry.name === "setup-site")!.changeSet;
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

const byPath = (a: Loose, b: Loose) => ((a.path ?? a.file) < (b.path ?? b.file) ? -1 : (a.path ?? a.file) > (b.path ?? b.file) ? 1 : 0);
const byId = (a: Loose, b: Loose) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const SAMPLE = contentDigest("placeholder bytes");

/** SETUP_SITE as a pnpm repository: the lockfile moves, and the release-age exemption item and its file are added. */
function pnpmSetup(): Loose {
  const set = loose(SETUP_SITE);
  set.observed.packageManager = "pnpm";
  set.observed.lockfile = "pnpm-lock.yaml";
  fileAt(set, "package-lock.json").path = "pnpm-lock.yaml";
  set.files.sort(byPath);
  set.pathAllowList = [...set.pathAllowList.filter((pattern: string) => pattern !== "package-lock.json"), "pnpm-lock.yaml", "pnpm-workspace.yaml"].sort();
  set.items.push({ id: "release-age", act: "exempt-release-age", scope: PACKAGE_SCOPE.scope, surface: "pnpm-workspace", path: "pnpm-workspace.yaml" });
  set.items.sort(byId);
  set.files.push({ path: "pnpm-workspace.yaml", mode: "100644", before: null, after: SAMPLE, item: "release-age" });
  set.files.sort(byPath);
  return reseal(set);
}

describe("packed change-set, bundle and ledger contracts", () => {
  it("are the docs/contracts files, unchanged, packed after the plan, brief, inventory and registry snapshot contracts", () => {
    expect(Object.keys(PLAN_CONTRACTS)).toEqual([
      "advisor-plan.json",
      "engagement-brief.json",
      "engagement-context.json",
      "repository-inventory.json",
      "registry-snapshot.json",
      "repository-change-set.json",
      "apply-bundle.json",
      "installed-ledger.json",
    ]);
    for (const name of ["repository-change-set.json", "apply-bundle.json", "installed-ledger.json"]) expect(PLAN_CONTRACTS[name], name).toEqual(JSON.parse(read(`docs/contracts/${name}`)));
  });

  it("use only keywords the checker implements, in every subschema, with no new keyword", () => {
    for (const name of ["repository-change-set.json", "apply-bundle.json", "installed-ledger.json"]) expect(() => assertImplementedContract(PLAN_CONTRACTS[name]!), name).not.toThrow();
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
      { id: "age", act: "exempt-release-age", scope: "@example", surface: "pnpm-workspace", path: "pnpm-workspace.yaml" },
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
    expect(validateRepositoryChangeSet(key)).toEqual({ valid: false, reason: `changeSet has a field the contract does not declare (key ${Object.keys(key).length} of this object), and unknown fields are refused` });
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

describe("change-set code rules C1-C16", () => {
  it("refuse each invalid corpus set for exactly the rules it names", () => {
    const all = (JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as { changeSets: { name: string; valid: boolean; rules?: string[]; changeSet: unknown }[] }).changeSets;
    for (const entry of all.filter((candidate) => !candidate.valid)) expect(ruleIds(entry.changeSet), entry.name).toEqual([...entry.rules!].sort());
    const kinds = new Set(all.filter((entry) => entry.name.startsWith("kind-")).map((entry) => entry.name));
    expect(kinds.size).toBe(14);
  });

  it("accept the corpus sets", () => {
    expect(repositoryChangeSetViolations(SET)).toEqual([]);
    expect(repositoryChangeSetViolations(SETUP)).toEqual([]);
    expect(repositoryChangeSetViolations(SETUP_SITE)).toEqual([]);
    expect(repositoryChangeSetViolations(pnpmSetup())).toEqual([]);
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
      set.items.push({ id: "age", act: "exempt-release-age", scope: "@example", surface: "yarnrc", path: ".yarnrc.yml" });
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

    it("refuses symlinkedSkillRoots and linkedAgentsPaths out of order or repeated", () => {
      expect(swapped((set) => (set.observed.symlinkedSkillRoots = [".cursor/skills", ".claude/skills"]))).toContain("C8");
      expect(swapped((set) => (set.observed.symlinkedSkillRoots = [".claude/skills", ".claude/skills"]))).toContain("C8");
      expect(swapped((set) => (set.observed.linkedAgentsPaths = [".agents/skills", ".agents"]))).toContain("C8");
      expect(swapped((set) => (set.observed.linkedAgentsPaths = [".agents", ".agents"]))).toContain("C8");
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

  describe("C9: discovery links, the skills manifest, the pointer files and the setup templates", () => {
    const linkAt = (set: Loose) => fileIndex(set, ".claude/skills/clossys-writer");
    it("refuses a discovery link that is not mode 120000, a regular file that is, and a link to another target", () => {
      const regular = loose(SET);
      fileAt(regular, ".claude/skills/clossys-writer").mode = "100644";
      expect(rulesOf(reseal(regular))).toEqual([`C9 files[${linkAt(regular)}].mode`]);
      const link = loose(SET);
      fileAt(link, "clossys/brief.json").mode = "120000";
      expect(rulesOf(reseal(link))).toEqual([`C9 files[${fileIndex(link, "clossys/brief.json")}].mode`]);
      const target = loose(SET);
      fileAt(target, ".claude/skills/clossys-writer").after = contentDigest("../../.agents/skills/clossys-strategist");
      expect(rulesOf(reseal(target))).toEqual([`C9 files[${linkAt(target)}].after`]);
      const removed = loose(SET);
      fileAt(removed, ".claude/skills/clossys-writer").after = null;
      expect(rulesOf(reseal(removed))).toEqual([`C15 files[${linkAt(removed)}].after`]);
    });

    it("refuses a missing discovery link, a link under a root observed as a symbolic link, and a missing manifest", () => {
      const missing = loose(SET);
      missing.files = missing.files.filter((file: Loose) => file.path !== ".cursor/skills/clossys-writer");
      expect(rulesOf(reseal(missing))).toEqual([`C9 items[${itemIndex(missing, "skills")}]`]);
      const underLink = loose(SET);
      underLink.observed.symlinkedSkillRoots = [".claude/skills"];
      expect(rulesOf(reseal(underLink))).toEqual([`C9 items[${itemIndex(underLink, "skills")}]`]);
      const manifest = loose(SET);
      manifest.files = manifest.files.filter((file: Loose) => file.path !== "clossys/.state/skills.json");
      expect(rulesOf(reseal(manifest))).toEqual([`C9 items[${itemIndex(manifest, "skills")}]`]);
      const refusedLink = loose(SET);
      refusedLink.files = refusedLink.files.filter((file: Loose) => file.path !== ".claude/skills/clossys-writer");
      refusedLink.refused.push({ path: ".claude/skills/clossys-writer", reason: "unowned-existing", item: "skills" });
      expect(repositoryChangeSetViolations(reseal(refusedLink))).toEqual([]);
    });

    it("binds no discovery link to a role whose skill is refused, and refuses one that is written", () => {
      const refusedSkill = loose(SET);
      refusedSkill.files = refusedSkill.files.filter((file: Loose) => file.path !== ".agents/skills/clossys-writer/SKILL.md");
      refusedSkill.refused.push({ path: ".agents/skills/clossys-writer/SKILL.md", reason: "unowned-existing", item: "skills" });
      expect(rulesOf(reseal(refusedSkill))).toEqual([`C9 items[${itemIndex(refusedSkill, "skills")}]`]);
      refusedSkill.files = refusedSkill.files.filter((file: Loose) => !file.path.endsWith("/clossys-writer"));
      expect(repositoryChangeSetViolations(reseal(refusedSkill))).toEqual([]);
    });

    it("limits owned workflows to clossys-* names, and owns no .npmrc", () => {
      for (const pattern of [".github/workflows/*", ".npmrc"]) {
        const set = loose(SETUP_SITE);
        set.pathAllowList = [...set.pathAllowList, pattern].sort();
        expect(ruleIds(reseal(set)), pattern).toEqual(["schema"]);
      }
    });

    it("binds each write-record source to its one file", () => {
      const pointer = loose(SET);
      pointer.items.push({ id: "agents", act: "write-record", source: "agents-pointer" }, { id: "claude", act: "write-record", source: "claude-loader" });
      pointer.items.sort(byId);
      pointer.files.push({ path: "AGENTS.md", mode: "100644", before: null, after: SAMPLE, item: "agents" }, { path: "CLAUDE.md", mode: "100644", before: null, after: SAMPLE, item: "claude" });
      pointer.files.sort(byPath);
      pointer.pathAllowList = [...pointer.pathAllowList, "AGENTS.md", "CLAUDE.md"].sort();
      expect(repositoryChangeSetViolations(reseal(pointer))).toEqual([]);
      const swappedFiles = loose(pointer);
      fileAt(swappedFiles, "AGENTS.md").item = "claude";
      fileAt(swappedFiles, "CLAUDE.md").item = "agents";
      expect(ruleIds(reseal(swappedFiles))).toEqual(["C9"]);
    });

    it("binds each setup template act to exactly its files", () => {
      for (const [id, path] of [
        ["caller-workflow", ".github/workflows/clossys-adoption-decision.yml"],
        ["starter-request", ".starter/request.json"],
        ["ci-template", ".github/workflows/clossys-ci.yml"],
        ["path-scope-job", ".github/workflows/clossys-path-scope.yml"],
      ] as const) {
        const missing = loose(SETUP_SITE);
        missing.files = missing.files.filter((file: Loose) => file.path !== path);
        expect(rulesOf(reseal(missing)), id).toEqual([`C9 items[${itemIndex(missing, id)}]`]);
        const extra = loose(SETUP_SITE);
        extra.files.push({ path: ".github/workflows/clossys-extra.yml", mode: "100644", before: null, after: SAMPLE, item: id });
        extra.files.sort(byPath);
        expect(rulesOf(reseal(extra)), id).toEqual([`C9 items[${itemIndex(extra, id)}]`]);
      }
      const refusedTemplate = loose(SETUP_SITE);
      refusedTemplate.files = refusedTemplate.files.filter((file: Loose) => file.path !== ".github/workflows/clossys-ci.yml");
      refusedTemplate.refused.push({ path: ".github/workflows/clossys-ci.yml", reason: "unowned-existing", item: "ci-template" });
      expect(repositoryChangeSetViolations(reseal(refusedTemplate))).toEqual([]);
    });

    it("lets an exempt-release-age item write at most its own file, or nothing when the base already lists the entry", () => {
      const none = pnpmSetup();
      none.files = none.files.filter((file: Loose) => file.path !== "pnpm-workspace.yaml");
      expect(repositoryChangeSetViolations(reseal(none))).toEqual([]);
      const elsewhere = pnpmSetup();
      fileAt(elsewhere, "pnpm-workspace.yaml").item = "brief";
      expect(ruleIds(reseal(elsewhere))).toEqual(["C9"]);
      const two = pnpmSetup();
      two.files.push({ path: ".yarnrc.yml", mode: "100644", before: null, after: SAMPLE, item: "release-age" });
      two.files.sort(byPath);
      two.pathAllowList = [...two.pathAllowList, ".yarnrc.yml"].sort();
      expect(rulesOf(reseal(two))).toEqual([`C9 items[${itemIndex(two, "release-age")}]`]);
    });

    it("refuses a key naming an item that is not a package item", () => {
      const set = loose(SETUP_SITE);
      set.keys[0].item = "ci-template";
      expect(rulesOf(reseal(set))).toContain("C9 keys[0].item");
    });
  });

  it("C9: refuse a pin-starter placed in dependencies, a refusal naming the ledger item, and C8 a repeated refusal", () => {
    const placement = loose(SET);
    itemAt(placement, STARTER).placement = "dependencies";
    expect(rulesOf(reseal(placement))).toContain(`C9 items[${itemIndex(placement, STARTER)}].placement`);
    const ledger = loose(SET);
    ledger.refused.push({ path: "clossys/.state/installed.json", reason: "unowned-existing", item: "ledger" });
    expect(rulesOf(reseal(ledger))).toContain(`C9 items[${itemIndex(ledger, "ledger")}]`);
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

  describe("C11: a setup set is complete", () => {
    it("refuses a setup set missing any template act or the Starter pin", () => {
      for (const act of ["add-caller-workflow", "write-starter-request", "add-ci-template", "add-path-scope-job", "pin-starter"]) {
        const set = loose(SETUP_SITE);
        const item = set.items.find((entry: Loose) => entry.act === act);
        set.items = set.items.filter((entry: Loose) => entry !== item);
        set.files = set.files.filter((file: Loose) => file.item !== item.id);
        set.keys = set.keys.filter((key: Loose) => key.item !== item.id);
        expect(ruleIds(reseal(set)), act).toEqual(["C11"]);
      }
    });

    it("requires the release-age exemption for pnpm and yarn, and refuses it for npm", () => {
      const pnpm = pnpmSetup();
      pnpm.items = pnpm.items.filter((item: Loose) => item.act !== "exempt-release-age");
      pnpm.files = pnpm.files.filter((file: Loose) => file.path !== "pnpm-workspace.yaml");
      expect(ruleIds(reseal(pnpm))).toEqual(["C11"]);
      const npm = loose(SETUP_SITE);
      npm.items.push({ id: "release-age", act: "exempt-release-age", scope: PACKAGE_SCOPE.scope, surface: "pnpm-workspace", path: "pnpm-workspace.yaml" });
      npm.items.sort(byId);
      npm.pathAllowList = [...npm.pathAllowList, "pnpm-workspace.yaml"].sort();
      expect(ruleIds(reseal(npm))).toEqual(["C11", "C12"]);
    });

    it("does not apply to an apply set, which may hold the templates as no-ops or not at all", () => {
      expect(repositoryChangeSetViolations(SET)).toEqual([]);
      expect(SET.items.some((item) => item.act === "add-ci-template")).toBe(false);
    });
  });

  describe("C12: the release-age exemption's surface, path and scope", () => {
    it("refuses a path that is not its surface's file, a surface its package manager does not read, and another scope", () => {
      const moved = pnpmSetup();
      Object.assign(itemAt(moved, "release-age"), { surface: "yarnrc", path: ".yarnrc.yml" });
      fileAt(moved, "pnpm-workspace.yaml").path = ".yarnrc.yml";
      moved.files.sort(byPath);
      moved.pathAllowList = [...moved.pathAllowList, ".yarnrc.yml"].sort();
      expect(rulesOf(reseal(moved))).toEqual([`C12 items[${itemIndex(moved, "release-age")}].surface`]);
      const mismatch = pnpmSetup();
      itemAt(mismatch, "release-age").path = ".yarnrc.yml";
      fileAt(mismatch, "pnpm-workspace.yaml").path = ".yarnrc.yml";
      mismatch.files.sort(byPath);
      mismatch.pathAllowList = [...mismatch.pathAllowList, ".yarnrc.yml"].sort();
      expect(rulesOf(reseal(mismatch))).toEqual([`C12 items[${itemIndex(mismatch, "release-age")}].path`]);
      const scope = pnpmSetup();
      itemAt(scope, "release-age").scope = "@example";
      expect(rulesOf(reseal(scope))).toEqual([`C12 items[${itemIndex(scope, "release-age")}].scope`]);
    });

    it("refuses .npmrc as a surface: npm has no exemption key", () => {
      const set = pnpmSetup();
      Object.assign(itemAt(set, "release-age"), { surface: "npmrc", path: ".npmrc" });
      expect(ruleIds(reseal(set))).toEqual(["schema"]);
    });
  });

  describe("C13: a Controller profile's root vocabulary", () => {
    const ROOTS = corpus.changeSets.find((entry) => entry.name === "setup-site-root-entries")!.changeSet;
    const rootItem = (set: Loose) => itemIndex(set, "root-entries");
    it("accepts the corpus cases: entries added, refused as unparseable or prohibited, or not needed", () => {
      for (const name of ["setup-site-root-entries", "apply-profile-no-vocabulary", "apply-profile-declares-all", "apply-profile-unparseable", "apply-profile-prohibits"]) {
        expect(repositoryChangeSetViolations(corpus.changeSets.find((entry) => entry.name === name)!.changeSet), name).toEqual([]);
      }
    });

    it("requires the item when the profile needs entries, and refuses it when it does not", () => {
      const missing = loose(ROOTS);
      missing.items = missing.items.filter((item: Loose) => item.act !== "declare-root-entry");
      missing.files = missing.files.filter((file: Loose) => file.item !== "root-entries");
      expect(rulesOf(reseal(missing))).toEqual(["C13 items"]);
      const unneeded = loose(ROOTS);
      unneeded.observed.repositoryProfile.undeclaredRoots = [];
      expect(rulesOf(reseal(unneeded))).toEqual([`C13 items[${rootItem(unneeded)}]`]);
      const absent = loose(ROOTS);
      absent.observed.repositoryProfile = null;
      expect(rulesOf(reseal(absent))).toEqual([`C13 items[${rootItem(absent)}]`]);
    });

    it("binds the item to the observed profile's path and exactly its undeclared names, in order", () => {
      const path = loose(ROOTS);
      itemAt(path, "root-entries").path = "other/repository-profile.json";
      fileAt(path, "governance/repository-profile.json").path = "other/repository-profile.json";
      path.files.sort(byPath);
      expect(rulesOf(reseal(path))).toEqual([`C13 items[${rootItem(path)}].path`]);
      const fewer = loose(ROOTS);
      itemAt(fewer, "root-entries").entries.pop();
      expect(rulesOf(reseal(fewer))).toEqual([`C13 items[${rootItem(fewer)}].entries`]);
      const reordered = loose(ROOTS);
      itemAt(reordered, "root-entries").entries.reverse();
      expect(rulesOf(reseal(reordered))).toEqual([`C13 items[${rootItem(reordered)}].entries`]);
      const other = loose(ROOTS);
      itemAt(other, "root-entries").entries[0].disposition = "required";
      expect(ruleIds(reseal(other))).toEqual(["schema"]);
    });

    it("requires a profile the base has, and the refusal reason the observation calls for", () => {
      const created = loose(ROOTS);
      fileAt(created, "governance/repository-profile.json").before = null;
      expect(rulesOf(reseal(created))).toEqual([`C15 files[${fileIndex(created, "governance/repository-profile.json")}].before`]);
      const missing = loose(ROOTS);
      missing.files = missing.files.filter((file: Loose) => file.path !== "governance/repository-profile.json");
      missing.refused.push({ path: "governance/repository-profile.json", reason: "unowned-existing", item: "root-entries" });
      expect(rulesOf(reseal(missing))).toEqual([`C13 items[${rootItem(missing)}]`]);
      const written = loose(corpus.changeSets.find((entry) => entry.name === "apply-profile-unparseable")!.changeSet);
      written.refused[0].reason = "unowned-existing";
      expect(rulesOf(reseal(written))).toEqual([`C13 items[${rootItem(written)}]`]);
      const prohibited = loose(corpus.changeSets.find((entry) => entry.name === "apply-profile-prohibits")!.changeSet);
      prohibited.refused[0].reason = "root-vocabulary-unknown";
      expect(rulesOf(reseal(prohibited))).toEqual([`C13 items[${rootItem(prohibited)}]`]);
    });

    it("refuses observed names under a vocabulary that is not checked, in both lists, or naming no path the set touches", () => {
      const unchecked = loose(ROOTS);
      unchecked.observed.repositoryProfile.rootVocabulary = "none";
      expect(ruleIds(reseal(unchecked))).toEqual(["C13"]);
      const both = loose(ROOTS);
      both.observed.repositoryProfile.prohibitedRoots = ["clossys"];
      expect(rulesOf(reseal(both))).toContain("C13 observed.repositoryProfile");
      const foreign = loose(ROOTS);
      foreign.observed.repositoryProfile.undeclaredRoots = [...foreign.observed.repositoryProfile.undeclaredRoots, "src"];
      itemAt(foreign, "root-entries").entries.push({ name: "src", classification: "extension", disposition: "allowed" });
      expect(repositoryChangeSetViolations(reseal(foreign)).map((violation) => violation.message)).toContain(
        "changeSet.observed.repositoryProfile.undeclaredRoots[6] is not the first segment of any path the set creates (rule C13)",
      );
    });

    it("refuses a profile at an unknown file name, and names out of order", () => {
      const name = loose(ROOTS);
      name.observed.repositoryProfile.path = "governance/profile.json";
      expect(ruleIds(reseal(name))).toContain("schema");
      const order = loose(ROOTS);
      order.observed.repositoryProfile.undeclaredRoots.reverse();
      expect(ruleIds(reseal(order))).toContain("C8");
    });
  });

  describe("C14: never write through a symbolic link to the skills", () => {
    const LINKED = corpus.changeSets.find((entry) => entry.name === "apply-agents-skills-link")!.changeSet;
    it("accepts every skill refused as skills-root-is-link, and refuses a skill written through the link", () => {
      expect(repositoryChangeSetViolations(LINKED)).toEqual([]);
      const through = corpus.changeSets.find((entry) => entry.name === "apply-skill-through-link")!.changeSet;
      expect(ruleIds(through)).toEqual(["C14"]);
    });

    it("refuses another reason under a link, the link reason elsewhere, and a skill directory of no staffed role", () => {
      const reason = loose(LINKED);
      reason.refused[0].reason = "unowned-existing";
      expect(rulesOf(reseal(reason))).toEqual(["C14 refused[0].reason"]);
      const elsewhere = loose(SET);
      elsewhere.files = elsewhere.files.filter((file: Loose) => file.path !== "clossys/brief.json");
      elsewhere.refused.push({ path: "clossys/brief.json", reason: "skills-root-is-link", item: "brief" });
      expect(rulesOf(reseal(elsewhere))).toEqual(["C14 refused[0].reason"]);
      const stranger = loose(SET);
      stranger.observed.linkedAgentsPaths = [".agents/skills/clossys-designer"];
      expect(rulesOf(reseal(stranger))).toEqual(["C14 observed.linkedAgentsPaths[0]"]);
      const outside = loose(SET);
      outside.observed.linkedAgentsPaths = [".claude"];
      expect(ruleIds(reseal(outside))).toEqual(["schema"]);
    });

    it("treats a link at .agents as covering every skill", () => {
      const set = loose(LINKED);
      set.observed.linkedAgentsPaths = [".agents"];
      expect(repositoryChangeSetViolations(reseal(set))).toEqual([]);
    });
  });

  describe("each remaining rule check, on a set that breaks only it", () => {
    it("C4: refuses a ledger item named by no file, or by two", () => {
      const none = loose(SET);
      none.files = none.files.filter((file: Loose) => file.path !== "clossys/.state/installed.json");
      expect(rulesOf(reseal(none))).toEqual([`C4 items[${itemIndex(none, "ledger")}]`]);
    });

    it("C7: refuses a second derived lockfile", () => {
      const set = loose(SET);
      set.files.push({ ...fileAt(set, "package-lock.json") });
      set.files.sort(byPath);
      expect(rulesOf(reseal(set))).toContain(`C7 files[${fileIndex(set, "package-lock.json") + 1}]`);
    });

    it("C9: refuses a repeated role, a declaration named twice, a package item named by a whole file or a path refusal", () => {
      const roles = loose(SET);
      itemAt(roles, "skills").roles.push("writer");
      expect(rulesOf(reseal(roles))).toEqual([`C9 items[${itemIndex(roles, "skills")}].roles[2]`]);
      const declared = loose(corpus.changeSets.find((entry) => entry.name === "setup-site-root-entries")!.changeSet);
      declared.files.push({ path: "governance/repository-declaration.json", mode: "100644", before: SAMPLE, after: SET.planDigest, item: "root-entries" });
      declared.files.sort(byPath);
      declared.pathAllowList = [...declared.pathAllowList, "**/repository-declaration.json"].sort();
      expect(rulesOf(reseal(declared))).toEqual([`C9 items[${itemIndex(declared, "root-entries")}]`]);
      const whole = loose(SET);
      whole.files.push({ path: "clossys/extra.json", mode: "100644", before: null, after: SAMPLE, item: STARTER });
      whole.files.sort(byPath);
      const messages = (value: unknown) => repositoryChangeSetViolations(value).map((violation) => violation.message);
      expect(messages(reseal(whole))).toContain(`changeSet.items[${itemIndex(whole, STARTER)}] is named by a whole file (rule C9)`);
      const refusal = loose(SET);
      refusal.refused.push({ path: "clossys/extra.json", reason: "unowned-existing", item: STARTER });
      expect(messages(reseal(refusal))).toContain(`changeSet.items[${itemIndex(refusal, STARTER)}] is named by a path refusal (rule C9)`);
    });

    it("C9: refuses a key refusal for another package than its item's, and a refusal naming the ledger item", () => {
      const other = loose(SET);
      itemAt(other, WRITER).satisfiedInBase = false;
      other.keys = other.keys.filter((key: Loose) => key.item !== WRITER);
      const lock = fileAt(other, "package-lock.json");
      lock.invariants = lock.invariants.filter((invariant: Loose) => invariant.item !== WRITER);
      other.refused.push({ file: "package.json", pointer: "/devDependencies/@example~1strategist", reason: "unowned-existing", item: WRITER });
      expect(repositoryChangeSetViolations(reseal(other)).map((violation) => violation.message)).toContain(`changeSet.items[${itemIndex(other, WRITER)}] is named by a key refusal for another package (rule C9)`);
      const own = loose(other);
      own.refused[0].pointer = "/dependencies/@example~1writer";
      expect(repositoryChangeSetViolations(reseal(own))).toEqual([]);
      const ledger = corpus.changeSets.find((entry) => entry.name === "apply-ledger-refused")!.changeSet;
      expect(rulesOf(ledger)).toEqual([`C9 items[${itemIndex(ledger as unknown as Loose, "ledger")}]`]);
    });

    it("C13: refuses a root name no owned pattern can introduce, and counts neither a key's file nor an edited file", () => {
      const ROOTS = corpus.changeSets.find((entry) => entry.name === "setup-site-root-entries")!.changeSet;
      const messages = (value: unknown) => repositoryChangeSetViolations(value).map((violation) => violation.message);
      const foreign = loose(ROOTS);
      foreign.observed.repositoryProfile.undeclaredRoots = [...foreign.observed.repositoryProfile.undeclaredRoots, "src"];
      itemAt(foreign, "root-entries").entries.push({ name: "src", classification: "extension", disposition: "allowed" });
      expect(messages(reseal(foreign))).toEqual(expect.arrayContaining([
        "changeSet.observed.repositoryProfile.undeclaredRoots[6] is not a root name an owned pattern can introduce (rule C13)",
        `changeSet.items[${itemIndex(foreign, "root-entries")}].entries[6].name is not a root name an owned pattern can introduce (rule C13)`,
      ]));
      const keyFile = loose(ROOTS);
      keyFile.observed.repositoryProfile.undeclaredRoots = [...keyFile.observed.repositoryProfile.undeclaredRoots, "package.json"].sort();
      itemAt(keyFile, "root-entries").entries = keyFile.observed.repositoryProfile.undeclaredRoots.map((name: string) => ({ name, classification: "extension", disposition: "allowed" }));
      const at = keyFile.observed.repositoryProfile.undeclaredRoots.indexOf("package.json");
      expect(rulesOf(reseal(keyFile))).toEqual([`C13 observed.repositoryProfile.undeclaredRoots[${at}]`]);
      const edited = loose(ROOTS);
      fileAt(edited, ".starter/request.json").before = SAMPLE;
      expect(rulesOf(reseal(edited))).toEqual([`C13 observed.repositoryProfile.undeclaredRoots[${edited.observed.repositoryProfile.undeclaredRoots.indexOf(".starter")}]`]);
    });

    it("C9: refuses a key refusal, or a lockfile invariant, naming an item that is not a package item", () => {
      const key = loose(SET);
      key.refused.push({ file: "package.json", pointer: "/devDependencies/@example~1zz", reason: "unowned-existing", item: "brief" });
      expect(rulesOf(reseal(key))).toContain(`C9 refused[${key.refused.length - 1}].item`);
      const invariant = loose(SET);
      const lock = fileAt(invariant, "package-lock.json");
      lock.invariants[1].item = "brief";
      expect(rulesOf(reseal(invariant))).toContain(`C9 files[${fileIndex(invariant, "package-lock.json")}].invariants[1].item`);
    });

    it("C13: refuses a second declare-root-entry item, and names listed under a vocabulary that is not checked", () => {
      const ROOTS = corpus.changeSets.find((entry) => entry.name === "setup-site-root-entries")!.changeSet;
      const second = loose(ROOTS);
      second.items.push({ id: "root-entries-2", act: "declare-root-entry", path: "governance/repository-profile.json", entries: [] });
      second.items.sort(byId);
      second.refused.push({ path: "governance/repository-profile.json", reason: "unowned-existing", item: "root-entries-2" });
      expect(rulesOf(reseal(second))).toContain(`C13 items[${itemIndex(second, "root-entries-2")}]`);
      const unchecked = loose(ROOTS);
      unchecked.observed.repositoryProfile.rootVocabulary = "none";
      expect(rulesOf(reseal(unchecked))).toEqual([`C13 items[${itemIndex(unchecked, "root-entries")}]`, "C13 observed.repositoryProfile"]);
    });

    it("C14: refuses skills-root-is-link on a key refusal", () => {
      const set = loose(SET);
      set.refused.push({ file: "package.json", pointer: "/devDependencies/@example~1zz", reason: "skills-root-is-link", item: STARTER });
      itemAt(set, STARTER).satisfiedInBase = true;
      expect(rulesOf(reseal(set))).toContain(`C14 refused[${set.refused.length - 1}].reason`);
    });
  });

  describe("the members the apply flow added", () => {
    it("require the Integrator pin, consumerCi and symlinkedSkillRoots, and refuse mode 100755 and a derived link", () => {
      const mutations: ((set: Loose) => void)[] = [
        (set) => delete set.integrator,
        (set) => delete set.observed.consumerCi,
        (set) => delete set.observed.symlinkedSkillRoots,
        (set) => delete set.observed.repositoryProfile,
        (set) => delete set.observed.linkedAgentsPaths,
        (set) => (set.observed.symlinkedSkillRoots = [".agents/skills"]),
        (set) => (fileAt(set, "clossys/brief.json").mode = "100755"),
        (set) => (fileAt(set, "package-lock.json").mode = "120000"),
      ];
      mutations.forEach((mutate, index) => {
        const set = loose(SET);
        mutate(set);
        expect(ruleIds(reseal(set)), String(index)).toEqual(["schema"]);
      });
    });

    it("accept the new refusal reasons", () => {
      for (const reason of ["deleted", "release-age-surface-conflict", "release-age-surface-unparseable"]) {
        const set = pnpmSetup();
        set.files = set.files.filter((file: Loose) => file.path !== "pnpm-workspace.yaml");
        set.refused.push({ path: "pnpm-workspace.yaml", reason, item: "release-age" });
        expect(repositoryChangeSetViolations(reseal(set)), reason).toEqual([]);
      }
    });
  });

  it("never echo a value in a reason", () => {
    const set = loose(SET);
    fileAt(set, "clossys/brief.json").item = "a-secret-value";
    const validation = validateRepositoryChangeSet(reseal(set));
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.reason).not.toContain("a-secret-value");
  });
});
