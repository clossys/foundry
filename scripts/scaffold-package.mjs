#!/usr/bin/env node
// scaffold-package — issue #1203: a new role package starts complete and
// conforming instead of being retrofitted. Generates a package for an
// EXISTING role declaration (docs/contracts/role-loop-archetypes.json)
// that has no packages/<shortName>/ yet, shaped so
// scripts/check-package-conformance.mjs reports zero gaps for it on day
// one: the manifest `foundry` block, a capability-map and loop-matrix
// skeleton, the skill body (with its "Run the feedback loop" section
// generated from the matrix, never hand-written), a status probe that
// really emits the shared check-output envelope through a generated copy of
// the canonical constructor (issues #1383/#1384 -- never a hand-written
// sample), a qualification adapter, and CHANGELOG/README furniture.
//
// It writes NOTHING under this repository's own clossys/ folder (issue
// #1381). clossys/<role>/STATUS.md and loop.json are consumer state the
// loop engine writes in a staffed repository; a placeholder written here
// would be fabricated state, and the conformance gate no longer grades it.
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
import { ENVELOPE_COPY_PATH, renderEnvelopeCopyFromRoot } from "./sync-envelope-copies.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }

/**
 * Pure: builds every file this package needs, as a Map<relativePath, string>
 * (relative to the eventual packages/<shortName>/ directory) plus one
 * governance file (the qualification adapter), returned separately since it
 * lives outside the package directory. `envelopeCopy` is the exact text
 * scripts/sync-envelope-copies.mjs renders from the canonical envelope
 * source (the caller reads it; this function stays free of filesystem
 * access, which is what makes it testable without touching disk).
 */
export function buildScaffold({ role, shortName, roleDefinition, stageActivities, envelopeCopy }) {
  if (typeof envelopeCopy !== "string" || envelopeCopy.length === 0) throw new Error("buildScaffold: envelopeCopy (from scripts/sync-envelope-copies.mjs) is required");
  const capabilityId = "confirm-scaffold-conformance";
  const capability = {
    id: capabilityId,
    subQuestion: `Does ${role}'s own scaffolded starting point already conform to the Stage A framework?`,
    worldClass: "A newly scaffolded package reports zero gaps against every Stage A framework definition on day one (issue #1203).",
    inputs: [],
    outputs: [`clossys/${shortName}/status.json`],
    // `planned` pairs with `proofCase: null`: nothing proves a capability
    // that does not exist yet (the joint maturity/proofCase rule, #1258).
    proofCase: null,
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
    // The declared bin is dist/cli.js, so the package must be able to build
    // it: `npm run build --workspaces --if-present` compiles src/ to dist/
    // through the tsconfig.json written beside this manifest.
    scripts: {
      build: "tsc -p tsconfig.json",
      typecheck: "tsc -p tsconfig.json --noEmit",
    },
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

  // The status probe (docs/contracts/package-framework.json fields.status,
  // issue #1383): read-only, one check-output envelope on stdout, exit code
  // folded from its verdict. A skeleton has nothing to measure, so it says
  // exactly that -- `indeterminate`, with the one finding that explains why
  // -- rather than claiming a `satisfied` it has not earned.
  const statusProbe = [
    "#!/usr/bin/env node",
    `// ${role} status probe, scaffolded (issue #1203). Contract: the repository's`,
    "// docs/contracts/package-framework.json `fields.status` (not shipped): read-only,",
    "// exactly one check-output envelope on stdout, exit code folded from its verdict.",
    "// Replace the body once this role has real capability content to measure.",
    "import { readFileSync } from \"node:fs\";",
    "import { buildCheckOutputEnvelope, envelopeToExitCode } from \"./generated/check-output-envelope.js\";",
    "",
    "const manifest = JSON.parse(readFileSync(new URL(\"../package.json\", import.meta.url), \"utf8\")) as { name: string; version: string };",
    "",
    "const envelope = buildCheckOutputEnvelope({",
    "  package: manifest.name,",
    "  version: manifest.version,",
    "  verdict: \"indeterminate\",",
    "  summary: \"This role has no capability content yet, so there is nothing to measure.\",",
    `  findings: [{ rule: "no-capability-content", severity: "warning", message: "${role} is a scaffolded skeleton: no capability has built or partial maturity yet." }],`,
    "  nextAction: \"Author this role's first real capability, then make this probe measure it.\",",
    "});",
    "",
    "process.stdout.write(`${JSON.stringify(envelope, null, 2)}\\n`);",
    "process.exitCode = envelopeToExitCode(envelope);",
    "",
  ].join("\n");

  // Same compiler settings as the existing role packages (for example
  // packages/writer/tsconfig.json): src/<x>.ts compiles to dist/<x>.js, the
  // mapping the declared bin and the conformance gate's status-probe check
  // both rely on.
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      lib: ["ES2022"],
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      strict: true,
      noUncheckedIndexedAccess: true,
      noImplicitOverride: true,
      esModuleInterop: true,
      skipLibCheck: true,
      types: ["node"],
      isolatedModules: true,
      verbatimModuleSyntax: false,
      outDir: "./dist",
      rootDir: "./src",
    },
    include: ["src/**/*"],
    exclude: ["node_modules", "dist", "**/*.test.ts"],
  };

  const packageFiles = new Map([
    ["package.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ["tsconfig.json", `${JSON.stringify(tsconfig, null, 2)}\n`],
    ["intake-question-cards.json", `${JSON.stringify(intakeCards, null, 2)}\n`],
    ["fit-signal-declarations.json", `${JSON.stringify(fitSignals, null, 2)}\n`],
    ["loop-matrix.json", `${JSON.stringify(loopMatrix, null, 2)}\n`],
    [ENVELOPE_COPY_PATH, envelopeCopy],
    ["src/cli.ts", statusProbe],
    ["skill/SKILL.md", skillBody],
    ["CHANGELOG.md", changelog],
    ["README.md", readme],
  ]);

  const adapter = {
    schemaVersion: 1,
    role,
    cases: [{ id: "scaffold-conforms", description: "The scaffolded package reports zero gaps against the Stage A framework." }],
  };

  return {
    packageFiles,
    repoFiles: new Map([
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

  let envelopeCopy;
  try { envelopeCopy = renderEnvelopeCopyFromRoot(root); }
  catch (error) { console.error(`scaffold-package: ${error instanceof Error ? error.message : String(error)}`); return 2; }

  const packageDir = join(root, "packages", shortName);
  if (existsSync(packageDir)) {
    if (!force) {
      console.error(`scaffold-package: packages/${shortName} already exists — pass --force to overwrite`);
      return 2;
    }
    rmSync(packageDir, { recursive: true, force: true });
  }

  const { packageFiles, repoFiles } = buildScaffold({ role, shortName, roleDefinition, stageActivities, envelopeCopy });
  writeFiles(packageDir, packageFiles);
  writeFiles(root, repoFiles);

  console.log(`scaffold-package: wrote packages/${shortName}/ (${packageFiles.size} file(s)) and ${repoFiles.size} governance file(s) for ${role}`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
