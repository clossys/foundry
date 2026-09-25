import { describe, expect, it } from "vitest";
// Controller's own source in this repository, read by this test only: the
// judge wouldViolateRootEntries() re-implements, since Launcher has no
// runtime dependency on Controller. Neither module performs I/O.
import { evaluateRepositoryRoot } from "../../controller/src/repository/evaluate-root.js";
import { isRepositoryRootEntryName, validateRepositoryProfile } from "../../controller/src/repository/validate.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import { MAX_ROOT_NAME_UNITS } from "./change-set-contract.js";
import { isRootEntryName, wouldViolateRootEntries } from "./root-entries.js";

/*
 * Issue #1178. wouldViolateRootEntries() against Controller's validator and
 * exact-root evaluator, over a generated corpus of profiles that differ only
 * in their root vocabulary: valid and invalid names, every classification
 * and disposition, repeats, unknown fields, holes, schema versions 1 to 3,
 * and a list past Controller's 10,000-entry limit. Where Controller finds
 * the profile invalid, Launcher must be indeterminate; otherwise both must
 * name the same undeclared and prohibited root names.
 */
type Verdict =
  | { readonly verdict: "satisfied"; readonly vocabulary: "none" | "checked" }
  | { readonly verdict: "violated"; readonly undeclared: readonly string[]; readonly prohibited: readonly string[] }
  | { readonly verdict: "indeterminate"; readonly reason: "root-vocabulary-unknown" };

const byUnits = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** Controller's answer, in wouldViolateRootEntries()'s terms. */
function controllerVerdict(profile: Record<string, unknown>, paths: readonly string[]): Verdict {
  if (validateRepositoryProfile(profile).length > 0) return { verdict: "indeterminate", reason: "root-vocabulary-unknown" };
  const rootEntries = profile.rootEntries as { name: string; disposition: string }[] | undefined;
  if (profile.schemaVersion !== 3 || rootEntries === undefined || rootEntries.length === 0) return { verdict: "satisfied", vocabulary: "none" };
  const observed = [...new Set(paths.map((path) => path.split("/")[0]!))].sort(byUnits);
  const evaluation = evaluateRepositoryRoot({ rootEntries, observedEntries: observed });
  if (evaluation.status === "invalid") return { verdict: "indeterminate", reason: "root-vocabulary-unknown" };
  const undeclared = evaluation.findings.filter((finding) => finding.rule === "root-entry-unknown").map((finding) => observed[Number(/\[(\d+)\]/.exec(finding.path)![1])]!);
  const prohibited = evaluation.findings.filter((finding) => finding.rule === "root-entry-prohibited").map((finding) => rootEntries[Number(/\[(\d+)\]/.exec(finding.path)![1])]!.name);
  if (undeclared.length === 0 && prohibited.length === 0) return { verdict: "satisfied", vocabulary: "checked" };
  return { verdict: "violated", undeclared: [...undeclared].sort(byUnits), prohibited: [...prohibited].sort(byUnits) };
}

/** A small deterministic generator, so a failure names a reproducible case. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const NAMES = [
  "clossys", ".agents", ".claude", ".github", ".starter", "src", "package.json", "AGENTS.md",
  "a b", "x\u2028y", "\u00e9t\u00e9", "\u{1d4b3}", "a".repeat(255), "\u{1d4b3}".repeat(127), "\u{1d4b3}".repeat(128), "a".repeat(256),
  "", ".", "..", "a/b", "a\\b", " a", "a ", "\u2028a", "a\u2028", "a\u0007", "a\u007f", "\ufeffa",
];
const CLASSIFICATIONS = ["canonical", "extension", "exception", "compatibility-alias", "legacy-artifact", "vendored"];
const DISPOSITIONS = ["required", "allowed", "prohibited", "maybe"];
const PATH_POOL = ["clossys/brief.json", ".agents/skills/clossys-writer/SKILL.md", ".claude/skills/clossys-writer", ".github/workflows/clossys-ci.yml", ".starter/request.json", "src/index.ts", "package.json", "AGENTS.md", "\u00e9t\u00e9/x"];
const base = (schemaVersion: number, rootEntries?: unknown): Record<string, unknown> => ({
  schemaVersion,
  defaultBranch: "main",
  commands: [],
  protectedPaths: [],
  ...(schemaVersion >= 2 ? { requirements: [] } : {}),
  ...(rootEntries === undefined ? {} : { rootEntries }),
});

function corpus(): { profile: Record<string, unknown>; paths: string[] }[] {
  const next = random(1178);
  const pick = <T>(values: readonly T[]) => values[Math.floor(next() * values.length)]!;
  const cases: { profile: Record<string, unknown>; paths: string[] }[] = [];
  const paths = () => PATH_POOL.filter(() => next() < 0.5);
  for (let index = 0; index < 400; index += 1) {
    const size = Math.floor(next() * 6);
    const entries: Record<string, unknown>[] = [];
    for (let at = 0; at < size; at += 1) {
      // Mostly well-formed entries, so the evaluator is reached as often as the validator refuses.
      const wild = next() < 0.15;
      const entry: Record<string, unknown> = {
        name: wild ? pick(NAMES) : pick(NAMES.slice(0, 16)),
        classification: wild && next() < 0.3 ? "vendored" : pick(CLASSIFICATIONS.slice(0, 5)),
        disposition: wild && next() < 0.3 ? "maybe" : pick(DISPOSITIONS.slice(0, 3)),
      };
      if (wild && next() < 0.1) entry.note = "x";
      if (wild && next() < 0.1) delete entry.disposition;
      entries.push(entry);
    }
    cases.push({ profile: base(3, entries), paths: paths() });
  }
  for (let index = 0; index < 60; index += 1) {
    // A vocabulary that declares every root the paths introduce, allowed or required, with some extra entries.
    const chosen = paths();
    const roots = [...new Set(chosen.map((path) => path.split("/")[0]!))];
    const entries = roots.map((name) => ({ name, classification: pick(CLASSIFICATIONS.slice(0, 5)), disposition: next() < 0.5 ? "allowed" : "required" }));
    if (next() < 0.5) entries.push({ name: "docs", classification: "canonical", disposition: pick(DISPOSITIONS.slice(0, 3)) });
    cases.push({ profile: base(3, entries), paths: chosen });
  }
  const hole: unknown[] = [{ name: "clossys", classification: "extension", disposition: "allowed" }];
  hole[2] = { name: "src", classification: "canonical", disposition: "required" };
  const many = Array.from({ length: 10_001 }, (_, index) => ({ name: `entry-${index}`, classification: "canonical", disposition: "allowed" }));
  const limit = Array.from({ length: 10_000 }, (_, index) => ({ name: `entry-${index}`, classification: "canonical", disposition: "allowed" }));
  cases.push(
    { profile: base(3, hole), paths: PATH_POOL },
    { profile: base(3, many), paths: PATH_POOL },
    { profile: base(3, limit), paths: PATH_POOL },
    { profile: base(3, []), paths: PATH_POOL },
    { profile: base(3, "clossys"), paths: PATH_POOL },
    { profile: base(3), paths: PATH_POOL },
    { profile: base(1), paths: PATH_POOL },
    { profile: base(2), paths: PATH_POOL },
    { profile: base(2, []), paths: PATH_POOL },
    { profile: base(1, [{ name: "clossys", classification: "extension", disposition: "allowed" }]), paths: PATH_POOL },
    { profile: { ...base(3, []), schemaVersion: 4 }, paths: PATH_POOL },
  );
  return cases;
}

describe("wouldViolateRootEntries agrees with Controller", () => {
  const cases = corpus();

  it("on every generated profile: indeterminate exactly where Controller finds the root vocabulary invalid, and the same names otherwise", () => {
    const tally = { indeterminate: 0, none: 0, checked: 0, violated: 0 };
    cases.forEach(({ profile, paths }, index) => {
      const expected = controllerVerdict(profile, paths);
      expect(wouldViolateRootEntries(profile, paths), `case ${index}`).toEqual(expected);
      tally[expected.verdict === "satisfied" ? expected.vocabulary : expected.verdict] += 1;
    });
    // The corpus reaches every outcome, so agreement is not agreement on one branch only.
    for (const [outcome, count] of Object.entries(tally)) expect(count, outcome).toBeGreaterThan(10);
  });

  it("refuses a list past 10,000 entries as Controller does, and accepts one of exactly 10,000", () => {
    const over = cases.find(({ profile }) => Array.isArray(profile.rootEntries) && (profile.rootEntries as unknown[]).length === 10_001)!;
    const at = cases.find(({ profile }) => Array.isArray(profile.rootEntries) && (profile.rootEntries as unknown[]).length === 10_000)!;
    expect(wouldViolateRootEntries(over.profile, over.paths)).toEqual({ verdict: "indeterminate", reason: "root-vocabulary-unknown" });
    expect(wouldViolateRootEntries(at.profile, at.paths).verdict).toBe("violated");
  });

  it("uses Controller's rule for one name, and the contracts' pattern and code-unit bound agree with it", () => {
    const pattern = new RegExp(((PLAN_CONTRACTS["repository-change-set.json"] as { definitions: Record<string, { pattern: string }> }).definitions.rootEntryName!).pattern, "u");
    for (const name of NAMES) {
      const controller = isRepositoryRootEntryName(name);
      expect(isRootEntryName(name), JSON.stringify(name)).toBe(controller);
      expect(pattern.test(name) && name.length <= MAX_ROOT_NAME_UNITS, JSON.stringify(name)).toBe(controller);
    }
  });
});
