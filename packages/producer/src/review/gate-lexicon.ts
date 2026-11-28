/**
 * The gate lexicon `clossys review plan` classifies a diff with: data only, no logic. Reviewer owns the rule this
 * states (R-REVIEW-BUDGET, packages/reviewer/skill/SKILL.md); ./plan.ts reads it.
 *
 * A touched file is a gate surface when its path matches `gatePaths`, or when one of its changed lines matches a
 * `gateLines` entry for its path. A file matching `contractSurfaces` is never a gate surface: a diff whose only gate
 * surface is a public contract, digest, export list or README is non-gate (a surface with `lines` counts only when
 * every changed line matches, so an index.ts that only re-exports is an export list and one with logic is not). The
 * diff changes pass/fail logic when a changed code line (comments aside) of a gate surface matching `passFail.paths`,
 * and none of `passFail.ignore`, matches one of `passFail.terms`; a new or deleted file there counts whole.
 *
 * Globs: `**` any run of path segments (or none), `*` any run of characters within one segment.
 */
export interface GateLexicon {
  readonly schema: "clossys.gate-lexicon/1";
  readonly gatePaths: readonly string[];
  readonly gateLines: readonly { readonly path: string; readonly pattern: string }[];
  /** `lines`, when given: the file is a contract surface only when every changed non-blank line matches it. */
  readonly contractSurfaces: readonly { readonly kind: "public contract" | "digest" | "export list" | "README"; readonly path: string; readonly lines?: string }[];
  readonly passFail: { readonly paths: readonly string[]; readonly ignore: readonly string[]; readonly terms: readonly string[] };
}

export const GATE_LEXICON: GateLexicon = {
  schema: "clossys.gate-lexicon/1",
  gatePaths: [
    "scripts/check-*",
    "scripts/test-gates.mjs",
    "scripts/run-check-steps.mjs",
    "scripts/run-gate-suites.mjs",
    "scripts/pre-push-ratchet*",
    "scripts/lib/**",
    "scripts/rules/**",
    ".github/workflows/**",
    ".github/scripts/**",
    "packages/*/scripts/check-*",
    "packages/producer/src/constitution/**",
    "packages/producer/src/review/**",
    "packages/producer/src/cli/check.ts",
    "packages/producer/src/cli/fast.ts",
    "packages/producer/src/cli/review.ts",
    "packages/producer/src/cli/review-plan.ts",
    "packages/controller/src/review/**",
    "packages/*/src/owned-rules.ts",
    "**/*allowlist*",
    "**/*baseline*",
    "**/*exemptions*",
    "**/retired-leaves.ts",
  ],
  gateLines: [
    { path: "package.json", pattern: "^\\s*\"(check|test|gate|verify|preflight)[:\"]" },
    { path: "packages/*/package.json", pattern: "^\\s*\"(check|test|typecheck)[:\"]" },
  ],
  contractSurfaces: [
    { kind: "README", path: "**/README.md" },
    { kind: "public contract", path: "docs/contracts/**" },
    { kind: "public contract", path: "packages/*/contracts/**" },
    { kind: "public contract", path: "**/*.schema.json" },
    { kind: "digest", path: "**/*digest*" },
    { kind: "digest", path: "**/*.sha256" },
    { kind: "export list", path: "packages/*/src/index.ts" },
    { kind: "export list", path: "**/index.ts", lines: "^\\s*export\\s+(type\\s+)?(\\*|\\{[^}]*\\}?|[A-Za-z_$][\\w$]*,?)(\\s+from\\s+[\"'][^\"']+[\"'];?)?\\s*$|^\\s*[A-Za-z_$][\\w$]*,?\\s*$|^\\s*\\}\\s+from\\s+[\"'][^\"']+[\"'];?\\s*$" },
    { kind: "export list", path: "**/exports.json" },
  ],
  passFail: {
    paths: [
      "scripts/check-*.mjs",
      "scripts/test-gates.mjs",
      "scripts/run-check-steps.mjs",
      "scripts/run-gate-suites.mjs",
      "scripts/lib/**",
      "scripts/rules/registry.json",
      ".github/workflows/**",
      "packages/*/scripts/check-*",
      "packages/producer/src/constitution/**",
      "packages/producer/src/review/**",
      "packages/producer/src/cli/check.ts",
      "packages/producer/src/cli/fast.ts",
      "packages/producer/src/cli/review.ts",
      "packages/producer/src/cli/review-plan.ts",
      "packages/controller/src/review/**",
      "packages/*/src/owned-rules.ts",
      "package.json",
      "packages/*/package.json",
    ],
    ignore: ["**/*.test.*", "**/__fixtures__/**", "**/fixtures/**", "**/*.md"],
    terms: [
      "\\bexitCode\\b",
      "\\bprocess\\.exit\\b",
      "\\bverdict\\b",
      "[\"'`](PASS|FAIL|CLEAR|NOT CLEAR|CARRY|VOID)\\b",
      "\\bfindings?\\b",
      "\\bthrow\\b",
      "\\b(status|exit)\\s*[!=]==?",
      "\\breturn\\s+(true|false|null|\\[\\])\\b",
      "\"(enforced|building|warn|expect)\"",
      "^\\s*\"(check|test|gate|verify|preflight|typecheck)[:\"]",
      "\\b(run|if|needs|continue-on-error):",
    ],
  },
};
