#!/usr/bin/env node
// scaffold-package — issue #1203: a new role package starts complete and
// conforming instead of being retrofitted. Generates a package for an
// EXISTING role declaration (docs/contracts/role-loop-archetypes.json)
// that has no packages/<shortName>/ yet, shaped so
// scripts/check-package-conformance.mjs reports zero gaps for it on day
// one: the manifest `foundry` block, a capability-map and loop-matrix
// skeleton, the skill body (with its "Run the feedback loop" section
// generated from the matrix, never hand-written), a qualification adapter
// and fixture, and CHANGELOG/README furniture.
//
//   node scripts/scaffold-package.mjs <role-short-name> [--root <repoRoot>] [--force]
//
// <role-short-name> is the manifest name's own scope-free form (for example
// "advisor" for "@clossys/advisor") and MUST already be declared in
// docs/contracts/role-loop-archetypes.json's own `roles` — this script
// does not invent a new role (that is a role-charter decision, out of this
// wave's scope; see docs/contracts/role-loop-archetypes.json's own
// `qualificationVerdicts`). --force overwrites an existing
// packages/<shortName>/ directory; without it, an existing directory is
// left untouched and the script exits 2.
//
// Exit 0 = scaffolded. Exit 2 = the role is not declared, the package
// already exists (without --force), or a required contract could not be
// read.
//
// Deliberately conservative in SCOPE: the scaffolded capability declares no
// applicable loop stages (every stage is `n/a`, reasoned) and an empty
// `solves`/`needs`/`feeds` — Stage B's job is a conforming SKELETON, not
// invented role content. A human (or a later, role-specific scaffold pass)
// fills in real capability content; this script's contract with
// check-package-conformance.mjs is structural conformance only.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateLoopSection, loadStageActivities } from "./generate-loop-section.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }

/**
 * Pure: builds every file this package needs, as a Map<relativePath, string>
 * (relative to the eventual packages/<shortName>/ directory) plus the two
 * repository-root files (clossys/<shortName>/STATUS.md and loop.json) and
 * one governance file (the qualification adapter), returned separately
 * since they live outside the package directory. No filesystem access --
 * callers write the result, which is what makes this testable without
 * touching disk and safe to preview with --dry-run.
 */
export function buildScaffold({ role, shortName, roleDefinition, stageActivities }) {
  const capabilityId = "confirm-scaffold-conformance";
  const capability = {
    id: capabilityId,
    subQuestion: `Does ${role}'s own scaffolded starting point already conform to the Stage A framework?`,
    worldClass: "A newly scaffolded package reports zero gaps against every Stage A framework definition on day one (issue #1203).",
    inputs: [],
    outputs: [`clossys/${shortName}/status.json`],
    proofCase: "scaffold-conforms",
    maturity: "planned",
    v0: false,
    businessLifecycleStage: "build",
  };

  const manifest = {
    name: role,
    version: "0.1.0",
    private: true,
    type: "module",
    license: "MIT",
    description: `${role}: scaffolded by scripts/scaffold-package.mjs (issue #1203). Conforming skeleton -- real capability content is added in Stage C.`,
    bin: { [`${shortName}-check`]: "dist/cli.js" },
    foundry: {
      assessment: { bin: `${shortName}-check`, invocation: "single-json-input" },
      intake: "intake-question-cards.json",
      outputs: [`clossys/${shortName}/status.json`],
      status: { bin: `${shortName}-check`, invocation: "single-json-input" },
      fit: "fit-signal-declarations.json",
      solves: [],
      needs: [],
      feeds: [],
      capabilities: [capability],
    },
  };

  const intakeCards = {
    schemaVersion: 1,
    role,
    cards: [
      {
        id: "primary-goal",
        prompt: `What should ${role} optimize for first?`,
        choices: [
          { id: "recommended", label: "Whatever the team recommends" },
          { id: "custom", label: "Something else" },
        ],
        recommendedChoiceId: "recommended",
        somethingElseFollowUp: "What would you like this role to optimize for instead?",
      },
    ],
  };

  const fitSignals = { schemaVersion: 1, role, signals: [] };

  const loopMatrix = {
    schemaVersion: 1,
    role,
    cells: ["sense", "judge", "act", "verify", "learn"].map((stage) => ({
      capability: capabilityId,
      stage,
      applicable: false,
      reason: "scaffolded starting point (issue #1203) -- this capability's real stage content is authored in Stage C, not invented by the scaffold",
    })),
  };

  const generatedSection = generateLoopSection(role, loopMatrix, stageActivities);

  const skillBody = [
    "---",
    `name: clossys-${shortName}`,
    `description: ${role}, scaffolded (issue #1203). Fill in this role's real craft before shipping to a client.`,
    "---",
    "",
    `# ${shortName}`,
    "",
    `This skill was scaffolded by \`scripts/scaffold-package.mjs\` for ${role}. It conforms structurally to the Stage A framework (issue #1187) on day one; its actual craft is written in Stage C.`,
    "",
    generatedSection.trim(),
    "",
    "## When this package is installed",
    "",
    `Run \`/clossys-${shortName} loop\` to start this role's feedback loop once its real capability content has been authored.`,
    "",
  ].join("\n");

  const changelog = ["# Changelog", "", "## 0.1.0", "", "- Scaffolded (issue #1203): conforming skeleton, no adopted capability content yet.", ""].join("\n");

  const readme = [
    `# ${role}`,
    "",
    `Scaffolded by \`scripts/scaffold-package.mjs\` (issue #1203). See \`skill/SKILL.md\` for this role's own skill.`,
    "",
  ].join("\n");

  const packageFiles = new Map([
    ["package.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ["intake-question-cards.json", `${JSON.stringify(intakeCards, null, 2)}\n`],
    ["fit-signal-declarations.json", `${JSON.stringify(fitSignals, null, 2)}\n`],
    ["loop-matrix.json", `${JSON.stringify(loopMatrix, null, 2)}\n`],
    ["check-output-envelope.fixture.json", `${JSON.stringify({ package: role, version: "0.1.0", verdict: "satisfied", summary: "This scaffolded package has no adopted checks yet, so there is nothing to report.", findings: [] }, null, 2)}\n`],
    ["skill/SKILL.md", skillBody],
    ["CHANGELOG.md", changelog],
    ["README.md", readme],
  ]);

  const statusMd = [
    "# Status",
    "",
    "## Mandate",
    "",
    `Scaffolded (issue #1203); no mandate confirmed yet -- ${role} has not been staffed on a real engagement.`,
    "",
    "## Where we are",
    "",
    "Structurally conforming skeleton, no adopted capability content.",
    "",
    "## Recommended next",
    "",
    "Author this role's real capability content, then convert to full Stage C conformance.",
    "",
    "## Decisions",
    "",
    "None yet.",
    "",
    "## Blockers",
    "",
    "None.",
    "",
  ].join("\n");

  const loopJson = {
    schemaVersion: 1,
    role,
    capabilities: [{ id: capabilityId, state: "found", condition: "current" }],
  };

  const adapter = {
    schemaVersion: 1,
    role,
    cases: [{ id: "scaffold-conforms", description: "The scaffolded package reports zero gaps against the Stage A framework." }],
  };

  return {
    packageFiles,
    repoFiles: new Map([
      [`clossys/${shortName}/STATUS.md`, statusMd],
      [`clossys/${shortName}/loop.json`, `${JSON.stringify(loopJson, null, 2)}\n`],
      [`governance/release-qualification-adapters/${shortName}/current-direct.json`, `${JSON.stringify(adapter, null, 2)}\n`],
    ]),
  };
}

function writeFiles(baseDir, files) {
  for (const [relativePath, content] of files) {
    const target = join(baseDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function main(argv) {
  const force = argv.includes("--force");
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex === -1 ? join(scriptDir, "..") : argv[rootIndex + 1];
  const shortName = argv.find((value, index) => !value.startsWith("--") && argv[index - 1] !== "--root");
  if (!shortName) {
    console.error("Usage: scaffold-package.mjs <role-short-name> [--root <repoRoot>] [--force]");
    return 2;
  }
  const role = `@clossys/${shortName}`;

  let contract;
  try { contract = readJson(join(root, "docs/contracts/role-loop-archetypes.json")); }
  catch (error) { console.error(`scaffold-package: cannot read role contract — ${error instanceof Error ? error.message : String(error)}`); return 2; }
  const roleDefinition = contract.roles?.[role];
  if (roleDefinition === undefined) {
    console.error(`scaffold-package: ${role} is not declared in docs/contracts/role-loop-archetypes.json — this script only scaffolds an already-declared role (a new role is a charter decision, out of scope here)`);
    return 2;
  }

  let stageActivities;
  try { ({ stageActivities } = loadStageActivities(root, role)); }
  catch (error) { console.error(`scaffold-package: ${error instanceof Error ? error.message : String(error)}`); return 2; }

  const packageDir = join(root, "packages", shortName);
  if (existsSync(packageDir)) {
    if (!force) {
      console.error(`scaffold-package: packages/${shortName} already exists — pass --force to overwrite`);
      return 2;
    }
    rmSync(packageDir, { recursive: true, force: true });
  }

  const { packageFiles, repoFiles } = buildScaffold({ role, shortName, roleDefinition, stageActivities });
  writeFiles(packageDir, packageFiles);
  writeFiles(root, repoFiles);

  console.log(`scaffold-package: wrote packages/${shortName}/ (${packageFiles.size} file(s)) and ${repoFiles.size} repository-root file(s) for ${role}`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
