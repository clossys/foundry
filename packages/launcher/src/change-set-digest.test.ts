import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHANGE_SET_DIGEST_EXCLUDED_FIELDS, DERIVED_FILE_DIGEST_FIELDS, bundleDigest, changeSetDigest, changeSetDigestSubject } from "./change-set-digest.js";
import type { BundleDigestEntry } from "./change-set-digest.js";
import { validateRepositoryChangeSet } from "./change-set-contract.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import { PLAN_DIGEST_EXCLUDED_FIELDS, canonicalDigest, canonicalJson, planDigest } from "./plan-digest.js";
import type { AdvisorPlan, EngagementBrief } from "./plan-contract.js";
import { projectEngagementBrief, serializeEngagementBrief } from "./plan-bundle.js";
import type { RepositoryVisibility } from "./change-set-contract.js";

/*
 * Issue #1178. The change-set and bundle digests, checked against the shared
 * corpus docs/contracts/apply-change-set-digest.fixture.json, whose values were
 * computed independently of this package. Reading repository files here is
 * test-only.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");

interface Corpus {
  hubBrief: EngagementBrief;
  briefs: { name: string; staffedHere: string[]; visibility: RepositoryVisibility; bytes: string; sha256: string }[];
  canonicalDigest: { name: string; value: unknown; digest: string }[];
  changeSets: { name: string; valid: boolean; sameDigestAs?: string; differsFrom?: string; changeSet: RepositoryChangeSet; subject: string; digest: string }[];
  bundles: { name: string; planDigest: string; repositories: BundleDigestEntry[]; canonical: string; digest: string }[];
}
const CORPUS = JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as Corpus;
const byName = (name: string) => CORPUS.changeSets.find((entry) => entry.name === name)!;
const BASE = byName("apply-with-packages");
const clone = <T>(value: T): T => structuredClone(value);
type Mutable = Record<string, unknown> & { files: Record<string, unknown>[]; pullRequest: Record<string, unknown> };
const mutable = (set: RepositoryChangeSet): Mutable => clone(set) as unknown as Mutable;
const fileAt = (set: Mutable, path: string) => set.files.find((file) => file.path === path)!;
const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

describe("the shared digest step", () => {
  it("gives every corpus value its expected digest", () => {
    for (const entry of CORPUS.canonicalDigest) expect(canonicalDigest(entry.value), entry.name).toBe(entry.digest);
  });

  it("leaves the plan digest byte-identical: planDigest is canonicalDigest of the plan without asOf and decisions", () => {
    const plans = (JSON.parse(read("docs/contracts/advisor-plan-digest.fixture.json")) as { plans: { name: string; plan: AdvisorPlan; digest: string }[] }).plans;
    for (const entry of plans) {
      const subject = Object.fromEntries(Object.entries(entry.plan).filter(([key]) => !PLAN_DIGEST_EXCLUDED_FIELDS.includes(key)));
      expect(canonicalDigest(subject), entry.name).toBe(entry.digest);
      expect(planDigest(entry.plan), entry.name).toBe(entry.digest);
    }
  });
});

describe("changeSetDigest (docs/contracts/apply-change-set-digest.md)", () => {
  it("excludes exactly changeSetDigest, branch, bundle, pullRequest, inverse and tooling, and keeps five members of a derived file", () => {
    expect(CHANGE_SET_DIGEST_EXCLUDED_FIELDS).toEqual(["changeSetDigest", "branch", "bundle", "pullRequest", "inverse", "tooling"]);
    expect(DERIVED_FILE_DIGEST_FIELDS).toEqual(["path", "mode", "derived", "item", "invariants"]);
  });

  it("computes every corpus change set's subject and digest", () => {
    for (const entry of CORPUS.changeSets) {
      expect(canonicalJson(changeSetDigestSubject(entry.changeSet)), entry.name).toBe(entry.subject);
      expect(changeSetDigest(entry.changeSet), entry.name).toBe(entry.digest);
    }
  });

  it("holds every sameDigestAs and differsFrom relation the corpus states", () => {
    for (const entry of CORPUS.changeSets) {
      if (entry.sameDigestAs !== undefined) expect(changeSetDigest(entry.changeSet), entry.name).toBe(changeSetDigest(byName(entry.sameDigestAs).changeSet));
      if (entry.differsFrom !== undefined) expect(changeSetDigest(entry.changeSet), entry.name).not.toBe(changeSetDigest(byName(entry.differsFrom).changeSet));
    }
  });

  it("agrees with the corpus on which change sets pass the contract and its code rules", () => {
    for (const entry of CORPUS.changeSets) expect(validateRepositoryChangeSet(entry.changeSet).valid, entry.name).toBe(entry.valid);
  });

  // One case per row of the page's exclusion table: the member changes, or appears, or disappears, and the digest does not move.
  const exclusions: [string, (set: Mutable) => void][] = [
    ["changeSetDigest", (set) => { set.changeSetDigest = sha("anything"); }],
    ["changeSetDigest, removed", (set) => { delete set.changeSetDigest; }],
    ["branch", (set) => { set.branch = "clossys/apply-ffffffffffff"; }],
    ["bundle", (set) => { set.bundle = sha("another bundle"); }],
    ["pullRequest title", (set) => { set.pullRequest = { title: "Clossys: apply plan ffffffffffff" }; }],
    ["pullRequest bodySha256", (set) => { set.pullRequest = { ...set.pullRequest, bodySha256: sha("a body") }; }],
    ["inverse", (set) => { set.inverse = sha("the inverse set"); }],
    ["tooling", (set) => { set.tooling = [{ tool: "npm", version: "11.6.1" }]; }],
    ["the ledger file's before", (set) => { fileAt(set, "clossys/.state/installed.json").before = sha("an older ledger"); }],
    ["the ledger file's after", (set) => { fileAt(set, "clossys/.state/installed.json").after = sha("the ledger this set writes"); }],
    ["the lockfile's before", (set) => { fileAt(set, "package-lock.json").before = null; }],
    ["the lockfile's after", (set) => { fileAt(set, "package-lock.json").after = sha("a regenerated lockfile"); }],
  ];
  for (const [name, mutate] of exclusions) {
    it(`does not move when ${name} changes`, () => {
      const set = mutable(BASE.changeSet);
      mutate(set);
      expect(changeSetDigest(set)).toBe(BASE.digest);
    });
  }

  it("reduces a derived file to its five members, and covers a whole file's before and after", () => {
    const subject = changeSetDigestSubject(BASE.changeSet) as { files: Record<string, unknown>[] };
    for (const file of subject.files.filter((entry) => entry.derived === true)) expect(Object.keys(file).sort()).toEqual([...DERIVED_FILE_DIGEST_FIELDS].sort());
    const whole = subject.files.find((file) => file.path === "clossys/brief.json")!;
    expect(Object.keys(whole).sort()).toEqual(["after", "before", "item", "mode", "path"]);

    const moved = mutable(BASE.changeSet);
    fileAt(moved, "clossys/brief.json").before = sha("a brief already there");
    expect(changeSetDigest(moved)).not.toBe(BASE.digest);

    const invariant = mutable(BASE.changeSet);
    (fileAt(invariant, "package-lock.json").invariants as Record<string, unknown>[])[0]!.version = "1.4.1";
    expect(changeSetDigest(invariant)).not.toBe(BASE.digest);

    const notDerived = mutable(BASE.changeSet);
    delete fileAt(notDerived, "package-lock.json").derived;
    expect(changeSetDigest(notDerived)).not.toBe(BASE.digest);
  });

  it("is not circular: recomputing the ledger, the body, the bundle and the branch from the digest leaves it unchanged", () => {
    const set = mutable(BASE.changeSet);
    const digest = changeSetDigest(set);
    const short = digest.slice(7, 19);
    set.branch = `clossys/apply-${short}`;
    set.pullRequest = { title: `Clossys: apply plan ${short}`, bodySha256: sha(`<!-- clossys-change-set: ${digest} -->`) };
    fileAt(set, "clossys/.state/installed.json").after = sha(JSON.stringify({ generation: 1, changeSets: [digest] }));
    set.bundle = bundleDigest(set.planDigest as string, [{ id: "example-owner/site", changeSetDigest: digest }]);
    set.inverse = sha(`revert ${digest}`);
    set.changeSetDigest = digest;
    expect(changeSetDigest(set)).toBe(digest);
    expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
  });

  it("moves when a covered member changes: base, producer, visibility, node id, staffing, package bytes, ledger generation", () => {
    for (const name of ["apply-base-moved", "apply-producer-bumped", "apply-visibility-public", "apply-node-id-changed", "apply-staffing-changed", "apply-package-bytes", "apply-ledger-generation"]) {
      expect(changeSetDigest(byName(name).changeSet), name).not.toBe(BASE.digest);
    }
  });

  it("covers the members the apply flow added: the Integrator pin, what was observed about CI and skill roots, and each discovery link's bytes and mode", () => {
    for (const name of ["apply-integrator-bumped", "apply-no-consumer-ci", "apply-claude-skills-symlinked", "apply-link-target-other", "apply-link-regular-file"]) {
      expect(byName(name).differsFrom, name).toBe("apply-with-packages");
      expect(changeSetDigest(byName(name).changeSet), name).not.toBe(BASE.digest);
    }
    const link = BASE.changeSet.files.find((file) => file.path === ".claude/skills/clossys-writer")!;
    expect(link).toMatchObject({ mode: "120000", after: sha("../../.agents/skills/clossys-writer") });
    const subject = changeSetDigestSubject(BASE.changeSet) as { integrator: unknown; observed: Record<string, unknown> };
    expect(subject.integrator).toEqual(BASE.changeSet.integrator);
    expect(Object.keys(subject.observed).sort()).toEqual(["consumerCi", "linkedAgentsPaths", "lockfile", "packageManager", "releaseAgeSurfaces", "repositoryProfile", "symlinkedSkillRoots"]);
  });

  it("covers the repository profile the base declares, the root entries a set declares, and skill directories behind a symbolic link", () => {
    for (const name of ["apply-profile-no-vocabulary", "apply-profile-declares-all", "apply-profile-unparseable", "apply-profile-prohibits", "apply-agents-skills-link"]) {
      expect(changeSetDigest(byName(name).changeSet), name).not.toBe(BASE.digest);
    }
    expect(byName("setup-site-root-entries").digest).not.toBe(byName("setup-site").digest);
    const none = changeSetDigest(byName("apply-profile-no-vocabulary").changeSet);
    expect(changeSetDigest(byName("apply-profile-declares-all").changeSet)).not.toBe(none);
  });

  it("refuses to digest what is not a change set", () => {
    expect(() => changeSetDigest(null)).toThrow(/must be an object/);
    expect(() => changeSetDigest({ files: [1] })).toThrow(/array of objects/);
  });
});

describe("bundleDigest (docs/contracts/apply-change-set-digest.md)", () => {
  it("computes every corpus bundle's canonical form and digest", () => {
    for (const entry of CORPUS.bundles) {
      const sorted = [...entry.repositories].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      expect(canonicalJson({ planDigest: entry.planDigest, repositories: sorted }), entry.name).toBe(entry.canonical);
      expect(bundleDigest(entry.planDigest, entry.repositories), entry.name).toBe(entry.digest);
    }
  });

  it("sorts repositories by id, and covers the plan digest and each repository", () => {
    const digest = (name: string) => CORPUS.bundles.find((entry) => entry.name === name)!.digest;
    expect(digest("three-repositories-reordered")).toBe(digest("three-repositories"));
    expect(digest("one-repository-skipped")).not.toBe(digest("three-repositories"));
    expect(digest("another-plan")).not.toBe(digest("three-repositories"));
  });

  it("reads only id and changeSetDigest from each entry", () => {
    const entry = CORPUS.bundles[0]!;
    const padded = entry.repositories.map((repository) => ({ ...repository, verdict: "violated", checks: [{ check: "V3" }] }));
    expect(bundleDigest(entry.planDigest, padded)).toBe(entry.digest);
  });
});

describe("brief bytes (the brief contract's PER-REPOSITORY PROJECTION)", () => {
  it("are the corpus's independently computed bytes, non-ASCII text and escapes included, whatever the hub brief's member order", () => {
    expect(Object.keys(CORPUS.hubBrief)[0]).not.toBe("schemaVersion");
    expect(CORPUS.hubBrief.problem).toContain("doesn\u2019t");
    for (const entry of CORPUS.briefs) {
      const bytes = serializeEngagementBrief(projectEngagementBrief(CORPUS.hubBrief, entry.staffedHere, entry.visibility));
      expect(bytes, entry.name).toBe(entry.bytes);
      expect(sha(bytes), entry.name).toBe(entry.sha256);
    }
    const privateBytes = CORPUS.briefs.find((entry) => entry.name === "private-non-ascii")!.bytes;
    expect(privateBytes).toContain("doesn\u2019t");
    expect(privateBytes).toContain("\\u0007");
    expect(privateBytes).not.toContain("\\u2019");
  });
});
