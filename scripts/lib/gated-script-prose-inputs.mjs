// gated-script-prose-inputs -- the declared table
// scripts/check-workflow-references.test.mjs's N1 wiring test uses to
// decide whether a script ci.yml invokes reads a "prose-tier" path: a
// `.changesets/*.md` file, a root `*.md` file, or a `docs/**/*.md` file
// classify-change-tier.mjs's own classifyPath() would call 'prose' (never
// 'packed-prose' -- a `packages/*/README.md` or `skill/SKILL.md` reader is
// a different, already-covered concern; see the OTHER #1420 wiring test,
// "every heavy job depends on the classifier...").
//
// WHY A DECLARED TABLE, NOT STATIC ANALYSIS -- read this before adding an
// entry
// ------------------------------------------------------------------------
// Nothing here parses a script's source to find its own path reads: issue
// #1420's review rounds 1 and 2 both found that comment-based or path-
// pattern-based heuristics have real gaps (a mention with no backticks, a
// path built by string concatenation, a read buried three imports deep).
// This table is instead a REVIEWED CLAIM, one line per script, that a human
// (or an agent standing in for one) read that script's actual source and
// is asserting what it reads. The wiring test's own fail-closed shape is
// what keeps this claim honest over time: EVERY script the test discovers
// being invoked anywhere in ci.yml -- not just the ones already listed
// here -- must have an entry, or the test fails outright, by name, forcing
// a deliberate answer instead of a silent default in either direction.
//
// Key format: exactly how the test's own extractScriptIds() names a
// script -- "node:<path>" for a direct `node <path>` invocation (the path
// as ci.yml spells it, including a `packages/.../dist/*.js` compiled
// entry point), or "npm:<name>" for an `npm run <name>` invocation whose
// OWN resolved script body contains no further `node <path>` invocation
// (an opaque shell one-liner, or one this table deliberately does not
// resolve further -- see OPAQUE_NPM_SCRIPTS below). When an `npm run
// <name>` script's body DOES contain a `node <path>` invocation, the test
// keys on that resolved path instead -- so `npm:check:changelog-location`
// is never a key here; `node:scripts/check-changelog-location.mjs` is.
//
// A `true` entry is a positive claim: the wiring test requires that EVERY
// job invoking this key that also gates on `needs.classify` be joined by
// at least one job that does NOT (see the test's own header for exactly
// what "join" means here). A `false` entry is likewise a claim, not a
// default -- read each one's own reason.
export const GATED_SCRIPT_PROSE_INPUTS = {
  // ---- Genuinely prose-tier readers (issue #1420's own three categories:
  // .changesets/*.md, docs/**/*.md, a root *.md file) ----------------------
  "node:scripts/collect-changesets.mjs": {
    prose: true,
    reason: "reads every .changesets/*.md file directly (issue #1420 review round 2, N1)",
  },
  "node:scripts/check-changeset-style.mjs": {
    prose: true,
    reason: "reads every .changesets/*.md file via collect-changesets.mjs's loadChangesets (issue #1423)",
  },
  "node:scripts/check-conflict-markers.mjs": {
    prose: true,
    reason: "scans the ENTIRE git tree for committed conflict markers, so every prose-tier path (and every other path) is in scope (issue #1420 review round 2, N1)",
  },
  "node:scripts/check-changelog-location.mjs": {
    prose: true,
    reason: "reads docs/changelogs/<dir>.md for every package (issue #1420 review round 3, N1 reopened by #1429)",
  },
  "node:scripts/check-strategist-subject.mjs": {
    prose: true,
    reason:
      "scans docs/*.md excluding docs/contracts/**, docs/changelogs/**, and every OTHER root-style docs/*.md filename (see the script's own otherRootMarkdown list) -- in practice, docs/PUBLISHING.md and docs/RELEASING.md, both top-level docs/*.md files classify-change-tier.mjs's classifyPath() calls 'prose' (issue #1420 review round 3)",
  },
  "node:scripts/check-contamination-classes.mjs": {
    prose: true,
    reason: "reads docs/changelogs/<dir>.md as the companion changelog for the package it is scanning, and scans docs/PUBLISHING.md/docs/DECISIONS.md text for dangling citations",
  },
  "node:scripts/check-root-readme-parity.mjs": {
    prose: true,
    reason: "reads the repository root's own README.md",
  },

  // ---- docs/contracts/** and docs/LIFECYCLE.md readers: NOT prose --------
  // Both are explicitly EXCLUDED from classify-change-tier.mjs's prose
  // allowlist (issue #1420 review round 1, B2/N1's own sibling finding) --
  // classifyPath() calls every docs/contracts/** path and docs/LIFECYCLE.md
  // 'full', never 'prose'. A script that reads only these is correctly
  // false here: it cannot be starved by the 'prose' tier, because no path
  // it reads can ever classify as 'prose' in the first place.
  "node:scripts/check-package-evidence.mjs": {
    prose: false,
    reason: "reads docs/LIFECYCLE.md (excluded from prose) and docs/contracts/{package-evidence.json,role-loop-archetypes.json,package-lifecycle.json} (all under docs/contracts/**, excluded from prose)",
  },
  "node:scripts/check-role-loop-archetypes.mjs": { prose: false, reason: "reads docs/contracts/role-loop-archetypes.json only" },
  "node:scripts/check-role-assessment-surfaces.mjs": { prose: false, reason: "reads packages/*/package.json manifests only, no docs/ or .changesets/ read" },
  "node:scripts/check-package-framework.mjs": { prose: false, reason: "reads docs/contracts/{engagement-context,client-problems}.json only" },
  "node:scripts/check-capability-maps.mjs": { prose: false, reason: "reads packages/*/package.json manifests only" },
  "node:scripts/check-package-conformance.mjs": { prose: false, reason: "reads docs/contracts/{role-loop-archetypes,client-problems}.json only" },
  "node:scripts/check-loop-matrix.mjs": { prose: false, reason: "reads docs/contracts/role-loop-archetypes.json only" },
  "node:scripts/check-real-customer-evidence.mjs": { prose: false, reason: "reads docs/contracts/{real-customer-evidence-contract,lifecycle}.json only" },
  "node:scripts/check-permission-defaults.mjs": { prose: false, reason: "reads docs/contracts/{permission-defaults-contract.json,trust-statement.md} only -- both under docs/contracts/**" },
  "node:scripts/check-first-wave-sequence.mjs": { prose: false, reason: "reads a sequence contract plus packages/*/package.json runtime edges only" },
  "node:scripts/check-install-docs.mjs": { prose: false, reason: "reads packages/*/README.md only -- a packed-prose path, not one of the three prose-tier categories (see the OTHER #1420 wiring test)" },
  "node:scripts/check-package-skills.mjs": { prose: false, reason: "reads packages/*/skill/SKILL.md only -- packed-prose, not prose" },
  "node:scripts/check-pre-auth-taste-contract.mjs": { prose: false, reason: "reads a manifest and designer-owned prose fixture under packages/, not docs/ or .changesets/" },
  "node:scripts/check-conversation-contract.mjs": { prose: false, reason: "reads docs/contracts/conversation-contract.md (under docs/contracts/**) and packages/*/skill/SKILL.md (packed-prose)" },
  "node:evals/lib/*.test.mjs": { prose: false, reason: "evals fixtures under evals/, not docs/ or .changesets/" },
  "node:scripts/check-evals.mjs": { prose: false, reason: "reads evals/scenarios/*.json and packages/*/skill/SKILL.md (packed-prose), not docs/ or .changesets/" },

  // ---- Dependency-free structural/governance gates: NOT prose ------------
  "node:scripts/check-package-identity-transition.mjs": { prose: false, reason: "reads governance/package-identity-transition.json and package manifests only" },
  "node:scripts/check-public-npm-aggregate-canary.mjs": { prose: false, reason: "reads the public npm registry and governance/** records, not docs/ or .changesets/" },
  "node:scripts/check-public-npm-aggregate-closures.mjs": { prose: false, reason: "same class as check-public-npm-aggregate-canary.mjs" },
  "node:scripts/check-public-npm-aggregate-transcripts.mjs": { prose: false, reason: "same class as check-public-npm-aggregate-canary.mjs" },
  "node:scripts/lib/public-npm-aggregate-canary.test.mjs": { prose: false, reason: "unit tests for the canary script above, fixture-only" },
  "node:scripts/check-public-npm-aggregate-canary-v2.mjs": { prose: false, reason: "same class as check-public-npm-aggregate-canary.mjs" },
  "node:scripts/lib/public-npm-aggregate-canary-v2.test.mjs": { prose: false, reason: "unit tests for the v2 canary script, fixture-only" },
  "node:scripts/check-release-cleanup-inventory.mjs": { prose: false, reason: "reads governance/** release-cleanup records only" },
  "node:scripts/set-scope.mjs": { prose: false, reason: "writes package-scope.json and derived manifest fields, reads no docs/ or .changesets/ path" },
  "node:scripts/set-registry.mjs": { prose: false, reason: "writes registry fields into package manifests only" },
  "node:scripts/set-prepublish-hook.mjs": { prose: false, reason: "writes/validates package.json lifecycle hooks only" },
  "node:scripts/check-root-entry-policy.mjs": {
    prose: false,
    reason:
      "reads the repository ROOT DIRECTORY LISTING to classify entries, including root *.md filenames as one input to that policy -- see issue #1420 review round 3's separate, non-blocking finding on this job's own prose-tier exposure (tracked, not fixed by this table entry)",
  },
  "node:scripts/repository-profile-discovery.mjs": { prose: false, reason: "reads governance/repository-profile.json and packages/** layout only" },
  "node:scripts/check-neutrality.mjs": { prose: false, reason: "structural machine-layout scan over source text, not a docs/ or .changesets/ path read" },
  "node:packages/controller/dist/gates/cli.js": { prose: false, reason: "packages/* internal-dependency catalog gate, reads manifests only" },
  "node:packages/controller/dist/repository/run-bin.js": { prose: false, reason: "the richer three-state evaluator over governance/repository-profile.json, same input class as dist/repository/bin.js below -- no docs/ or .changesets/ read" },
  "node:scripts/check-later-publications.mjs": { prose: false, reason: "validates governance/release-publications/** immutable records against git history, no docs/ or .changesets/ read" },
  "node:scripts/check-workspace-links.mjs": { prose: false, reason: "reads package.json dependency graphs only" },
  "node:scripts/check-lock-workspace-versions.mjs": { prose: false, reason: "reads package-lock.json and package.json only" },
  "node:scripts/check-attestation-freshness.mjs": {
    prose: false,
    reason:
      "as ci.yml invokes it (`node scripts/check-attestation-freshness.mjs .`, no --registry/--rulesets flags), it only scans tracked files matched by `git ls-files -- *.json` (trackedJsonFiles()) and skips any fixtures-segment path -- a glob that can never match .changesets/*.md, a root *.md file, or docs/**/*.md",
  },
  "node:scripts/check-qualification-record-required.mjs": { prose: false, reason: "reads governance/release-qualifications/** and package.json version fields only" },
  "node:scripts/check-readme-examples.mjs": { prose: false, reason: "typechecks fenced code blocks in packages/*/README.md against shipped .d.ts -- packed-prose, not prose" },
  "node:packages/designer/dist/tokens/contrast-cli.js": { prose: false, reason: "reads packages/designer/styles/tokens.css only" },
  "node:scripts/check-touches-packages.mjs": { prose: false, reason: "reads only the diff's own changed-path list (packages/, governance/, scripts/ prefixes) to decide whether to skip an expensive step -- reads no file content" },
  "node:scripts/check-candidate-qualification.mjs": {
    prose: false,
    reason:
      "governance/release-qualifications/** records against git history. Its one apparent docs/ dependency -- scripts/lib/release-publication-cohort.mjs's TRIO_PUBLICATION_TRANSITION_PATHS, which names docs/DECISIONS.md, docs/LIFECYCLE.md, docs/PUBLISHING.md -- reads those paths' content ONLY at one frozen historical commit (via `git show <fixed-sha>:<path>`), never from the live PR tree in the normal (non-genesis) case; a current edit to any of those files cannot change this script's verdict (audited in review round 1)",
  },
  "node:scripts/check-packed-consumer-readiness.mjs": { prose: false, reason: "packs and installs packages/*/dist into a disposable consumer, no docs/ or .changesets/ read" },

  // ---- build job: governance/typecheck/test steps, no prose read ---------
  "node:scripts/check-bin-reachability.mjs": { prose: false, reason: "invokes packages/*/package.json bin entries only" },
  "node:scripts/check-publication-map.test.mjs": { prose: false, reason: "imports packages/publisher's own built entry point, package-internal fixtures only" },
  "node:.github/scripts/assemble-verify-inputs.test.mjs": { prose: false, reason: "verify-inputs assembler unit tests, fixture-only" },
  "node:scripts/collect-review-evidence.integration.test.mjs": { prose: false, reason: "review-evidence collector integration tests against a built validator, fixture-only" },
  "node:scripts/check-installed-positions.mjs": { prose: false, reason: "reads docs/contracts/{installed-position-ledger.fixture,role-loop-archetypes}.json only" },
  "node:scripts/check-completion-evidence.mjs": { prose: false, reason: "reads docs/contracts/{completion-evidence.fixture,installed-position-ledger.fixture}.json only" },
  "node:packages/controller/dist/cli.js": { prose: false, reason: "package-lifecycle governance against docs/contracts/package-lifecycle.json only" },
  "node:packages/controller/dist/repository/bin.js": { prose: false, reason: "governance/repository-profile.json structural check only" },
  "node:packages/locksmith/dist/infisical/cli.js": { prose: false, reason: "governance/locksmith-catalog.json only" },
  "node:packages/launcher/dist/cli.js": { prose: false, reason: "--help output only, no file reads beyond its own compiled bundle" },
  "node:packages/integrator/dist/cli.js": { prose: false, reason: "package.json and governance/foundry-supersession-map.json only" },
  "node:scripts/check-schema-versions.mjs": { prose: false, reason: "reads clossys/** JSON records and their declared schema versions only" },
  "node:scripts/check-heartbeat.mjs": { prose: false, reason: "reads clossys/** heartbeat digest records only" },
  "node:scripts/check-shared-vocabularies.mjs": { prose: false, reason: "reads packages/*/src shared-vocabulary source only" },
  "node:scripts/check-peer-version-assert.mjs": { prose: false, reason: "reads packages/*/package.json peer-dependency ranges only" },
  "node:scripts/check-typechecked-assertions.mjs": { prose: false, reason: "reads packages/*/src TypeScript source only" },
  "node:scripts/lib/candidate-runner-acceptance.test.mjs": { prose: false, reason: "runs the real candidate-runner framework against a disposable fixture registry, no docs/ or .changesets/ read" },
  "node:scripts/publish-qualified-directory.test.mjs": { prose: false, reason: "qualified-directory owner-present acceptance, fixture-only" },
  "node:scripts/observation-bundle.mjs": { prose: false, reason: "publishes this run's own observation bundle, no docs/ or .changesets/ read" },
  "node:scripts/observation-bundle.test.mjs": { prose: false, reason: "unit tests for observation-bundle.mjs, fixture-only" },
  "node:scripts/gate-run-history.test.mjs": { prose: false, reason: "reads the built @clossys/observer package's own gate-run-history reader, fixture-only" },
  "node:scripts/check-fleet-coverage.test.mjs": { prose: false, reason: "reads the built @clossys/observer package's fleet-coverage collector, fixture-only" },
  "node:scripts/check-strategist-subject.test.mjs": {
    prose: false,
    reason: "exercises check-strategist-subject.mjs against SYNTHETIC fixture doc trees under a temp directory, never the live repository's own docs/ tree -- the real gate (check-strategist-subject.mjs, above) is the one marked prose:true",
  },

  // ---- infrastructure: no docs/.changesets/ read at all -------------------
  "node:.github/scripts/collect-credential-evidence.mjs": { prose: false, reason: "reads this run's own GitHub Jobs API timestamps, not repository content" },
  "node:packages/locksmith/dist/bin.js": { prose: false, reason: "judges the credential evidence assembled above, not repository content" },
  "node:.github/scripts/collect-secret-scan-observation.mjs": { prose: false, reason: "reads this run's own gitleaks step outputs, not repository content" },
  "node:packages/inspector/dist/bin.js": { prose: false, reason: "judges the secret-scan evidence assembled above, not repository content" },
  "node:scripts/check-foreign-references.mjs": { prose: false, reason: "scans the whole tree for foreign account/scope references, including docs/PUBLISHING.md -- already in this table's ALWAYS-RUN safety-identity job, not a gated one, so out of scope for this test either way" },
  "node:scripts/push-tree-identical.mjs": { prose: false, reason: "compares this push's tree hash to the prior push, no path-specific read" },
  "node:scripts/run-gate-suites.mjs": { prose: false, reason: "runs check:gates' own discovered suite set, each already covered by its own gate-test-set exclusion reasoning" },
  "node:scripts/test-gates.mjs": { prose: false, reason: "invoked by run-gate-suites.mjs above; same reasoning" },
  "node:scripts/classify-change-tier.mjs": { prose: false, reason: "the classifier itself -- reads the diff's changed-path LIST to classify tier, never a file's content" },
  "node:scripts/check-release-pr-shape.mjs": { prose: false, reason: "reads docs/changelogs/<dir>.md and .changesets/*.md -- already in this table's ALWAYS-RUN release-pr-shape job, not a gated one" },
  "node:scripts/check-release-readiness.mjs": { prose: false, reason: "reads package.json version fields and .changesets/*.md -- already in this table's ALWAYS-RUN release-readiness job, not a gated one" },
  "node:scripts/check-readme-parity.mjs": { prose: false, reason: "reads packages/*/README.md -- packed-prose, not prose -- already in this table's ALWAYS-RUN prose job either way" },

  // ---- npm: entries that resolve to no further `node <path>` invocation --
  "npm:check:dependency-audit": { prose: false, reason: "`npm audit`, reads package-lock.json's own dependency graph, no repository file read" },
  "npm:typecheck": { prose: false, reason: "`tsc` over packages/*/src per workspace, no docs/ or .changesets/ read" },

  // `npm run build` is deliberately NOT resolved into its own per-package
  // `node <path>` invocations (each package's own build script is not
  // visible from the root package.json this table's resolver reads) --
  // instead audited directly, once, by issue #1324's own cache-key file
  // list (kept in sync by scripts/check-workflow-references.test.mjs's
  // "every workspace-build-cache step's key covers every input npm run
  // build can read" test): package.json, package-lock.json,
  // packages/*/{src/**,package.json,tsconfig*.json,scripts/**},
  // scripts/lib/**, docs/contracts/**. No prose-tier path is in that list.
  "npm:build": { prose: false, reason: "audited directly by issue #1324's own cache-key file list (see comment above) -- no prose-tier path" },
};

// npm scripts this module deliberately does not resolve into their own
// `node <path>` sub-invocations (see GATED_SCRIPT_PROSE_INPUTS's own
// "npm:build" comment) -- kept here, not inline in the test, so the test's
// resolver and this table's own documentation cannot drift apart.
export const OPAQUE_NPM_SCRIPTS = new Set(["build", "typecheck"]);
