/**
 * What `clossys review` runs on this repository: the install, the count probes, the generated fixtures, the e2e and
 * the leak scan. Tests pass their own config for small fixture repositories; docs/review.md is generated from these.
 */
export interface CountProbe {
  readonly id: string;
  /** What it counts, for the doc. */
  readonly counts: string;
  /** argv, run in the tree root. */
  readonly argv: readonly string[];
  /** Finding counts by rule id from the probe's stdout; throws when the output is not what the probe prints. */
  readonly parse: (stdout: string) => Record<string, number>;
}

export interface GeneratedFixture {
  readonly id: string;
  /** The committed copy (tree-relative). */
  readonly fixture: string;
  /** The generator script (tree-relative); a head without it skips the fixture with a note. */
  readonly generator: string;
  /** argv after `node <generator>`; {out} is the temp output folder. */
  readonly args: readonly string[];
  /** The generator's cwd (tree-relative). */
  readonly cwd: string;
  /** Path prefixes whose change triggers the regeneration. */
  readonly triggers: readonly string[];
}

export interface ReviewConfig {
  /** argv that installs dependencies in a fresh tree, or null when the tree needs none. */
  readonly install: readonly string[] | null;
  /** Package dirs whose build the count probes need in both trees. */
  readonly probePackages: readonly string[];
  readonly counts: readonly CountProbe[];
  readonly fixtures: readonly GeneratedFixture[];
  /** `clossys check --e2e` (tree-relative argv) when one of packages changed. */
  readonly e2e: { readonly packages: readonly string[]; readonly argv: readonly string[] } | null;
  /** The repository's own public-safety check: argv; its output is never stored or printed. */
  readonly leakScan: readonly string[] | null;
  /** Per-command timeout. */
  readonly timeoutMs: number;
}

/** The JSON document a `--json` verb prints, from the first line that opens one. */
export function jsonOf(stdout: string): Record<string, unknown> {
  const at = stdout.startsWith("{") ? 0 : stdout.indexOf("\n{") + 1;
  if (at < 0 || stdout[at] !== "{") throw new Error("no JSON document in the output");
  return JSON.parse(stdout.slice(at)) as Record<string, unknown>;
}

const byRule = (findings: unknown, key: string): Record<string, number> => {
  if (!Array.isArray(findings)) throw new Error("no findings array");
  const out: Record<string, number> = {};
  for (const finding of findings) { const id = String((finding as Record<string, unknown>)[key] ?? "unknown"); out[id] = (out[id] ?? 0) + 1; }
  return out;
};

const CLI = "packages/producer/dist/cli/index.js";
const FIXTURE_CONSUMER = "packages/producer/test-fixtures/consumer";

export const FOUNDRY_CONFIG: ReviewConfig = {
  install: ["npm", "ci", "--no-audit", "--no-fund", "--prefer-offline"],
  probePackages: ["packages/producer"],
  counts: [
    { id: "check", counts: `clossys check --json on ${FIXTURE_CONSUMER}: findings per rule`, argv: ["node", CLI, "check", "--json", "--root", FIXTURE_CONSUMER], parse: stdout => byRule(jsonOf(stdout).findings, "rule") },
    {
      id: "constitution", counts: `clossys check --constitution --json on ${FIXTURE_CONSUMER}: rows per registered rule`,
      argv: ["node", CLI, "check", "--constitution", "--json", "--root", FIXTURE_CONSUMER],
      parse: stdout => {
        const rules = (jsonOf(stdout) as { rules?: { id: string; rows: number }[] }).rules;
        if (!Array.isArray(rules)) throw new Error("no rules in the constitution report");
        return Object.fromEntries(rules.map(rule => [rule.id, rule.rows]));
      },
    },
    { id: "side-door", counts: "clossys check --side-door --json on the checkout: engine.side-door findings", argv: ["node", CLI, "check", "--side-door", "--json", "--root", "."], parse: stdout => {
      const findings = (jsonOf(stdout) as { findings?: unknown[] }).findings;
      if (!Array.isArray(findings)) throw new Error("no findings in the side-door report");
      return { "engine.side-door": findings.length };
    } },
    {
      id: "ia-orphans", counts: `ia.orphans over ${FIXTURE_CONSUMER}: orphan slot folders`,
      argv: ["node", "--input-type=module", "-e", `const m = await import("./packages/producer/dist/check/ia-orphans.js"); console.log(JSON.stringify({ n: m.iaOrphans.run(${JSON.stringify(FIXTURE_CONSUMER)}).findings.length }));`],
      parse: stdout => ({ "ia.orphans": (jsonOf(stdout) as { n: number }).n }),
    },
  ],
  fixtures: [{
    id: "producer-consumer", fixture: FIXTURE_CONSUMER, generator: "packages/producer/scripts/seed-pinned-world.mjs",
    args: ["--out", "{out}"], cwd: "packages/producer", triggers: ["packages/producer/", "packages/designer/", "packages/writer/", "packages/publisher/", "packages/director/"],
  }],
  e2e: { packages: ["packages/producer", "packages/designer", "packages/writer", "packages/publisher"], argv: ["node", CLI, "check", "--e2e", "--json"] },
  leakScan: ["npm", "run", "-s", "check:safety", "--", "--json"],
  // A cold publisher build (tsc plus its client-boundary scan) can take longer than ten minutes on a loaded machine.
  timeoutMs: 1_800_000,
};
