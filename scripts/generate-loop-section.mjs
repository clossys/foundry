#!/usr/bin/env node
// generate-loop-section — renders a role package's `## Run the feedback
// loop` skill section from its loop matrix (docs/contracts/loop-matrix.json,
// issue #1197), so the section is generated, never hand-written, and can be
// diffed byte-for-byte by scripts/check-loop-matrix.mjs.
//
//   node scripts/generate-loop-section.mjs <packageDir> [--write] [<repoRoot>]
//
// <packageDir> is a package's own directory name under packages/ (for
// example "strategist"). Prints the generated section to stdout; --write
// splices it into that package's skill/SKILL.md in place (same splice
// mechanics as scripts/check-conversation-contract.mjs's injectContract,
// keyed on the `## Run the feedback loop` heading instead).
//
// Exit 0 = generated (and, with --write, spliced). Exit 2 = the role has no
// packages/<packageDir>/loop-matrix.json, no foundry.capabilities, or no
// resolvable operating mode -- nothing to generate from.
//
// Manifest, contract, and fixture reads only: no build, no child process.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const HEADING = "## Run the feedback loop";

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }

const STAGE_LABELS = { sense: "Sense", judge: "Judge", act: "Act", verify: "Verify", learn: "Learn" };

/**
 * Reads docs/contracts/role-loop-archetypes.json and returns this role's own
 * operating mode's stageActivities (the DEFAULT meaning of each stage,
 * before any capability-specific content from the matrix is composed in).
 */
export function loadStageActivities(root, role) {
  const contract = readJson(join(root, "docs/contracts/role-loop-archetypes.json"));
  const definition = contract.roles?.[role];
  if (!isRecord(definition) || typeof definition.primaryMode !== "string") {
    throw new Error(`role-loop-archetypes.json declares no primaryMode for ${role}`);
  }
  const mode = contract.modes?.[definition.primaryMode];
  if (!isRecord(mode) || !isRecord(mode.stageActivities)) {
    throw new Error(`role-loop-archetypes.json declares no mode "${definition.primaryMode}" for ${role}`);
  }
  return { mode: definition.primaryMode, stageActivities: mode.stageActivities };
}

function demandSummary(demand) {
  if (!isRecord(demand)) return "";
  const parts = [
    `reasoning: ${demand.reasoningTier ?? "?"}`,
    demand.minimumTierFloor ? `floor: ${demand.minimumTierFloor}` : null,
    `vision: ${demand.visionRequired ? "yes" : "no"}`,
    `context: ${demand.contextSize ?? "?"}`,
    `parallel: ${demand.parallel ? "yes" : "no"}`,
    `independent: ${demand.independence ? "yes" : "no"}`,
  ].filter((value) => value !== null);
  return parts.join(", ");
}

/**
 * Pure: composes the mode's own stage default plus every matrix cell for
 * that stage, sorted by capability id for determinism. Cells not belonging
 * to `stage` are ignored -- the caller is expected to pass the FULL cell
 * array, one call per stage, or use `generateLoopSection` below for the
 * whole document.
 */
export function renderStageSection(stage, stageActivities, cellsForStage) {
  const lines = [`### ${STAGE_LABELS[stage] ?? stage}`, "", stageActivities[stage] ?? "", ""];
  const sorted = [...cellsForStage].sort((a, b) => a.capability.localeCompare(b.capability));
  for (const cell of sorted) {
    if (cell.applicable === false) {
      lines.push(`- **${cell.capability}**: n/a — ${cell.reason}`);
    } else {
      lines.push(`- **${cell.capability}** — ${cell.inputs}. Check: ${cell.check}. Output: \`${cell.output}\`. Proof: \`${cell.proofCase}\`. (${demandSummary(cell.demand)})`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Pure: the full `## Run the feedback loop` section for one role, generated
 * from its loop-matrix document and operating mode. Deterministic given the
 * same inputs -- this is the function scripts/check-loop-matrix.mjs diffs
 * the committed skill section against.
 */
export function generateLoopSection(role, matrixDoc, stageActivities) {
  const cellsByStage = new Map(["sense", "judge", "act", "verify", "learn"].map((stage) => [stage, []]));
  for (const cell of matrixDoc.cells ?? []) {
    if (cellsByStage.has(cell.stage)) cellsByStage.get(cell.stage).push(cell);
  }
  const shortName = role.split("/").pop();
  const parts = [
    HEADING,
    "",
    `Invoke with \`/clossys-${shortName} loop\` (Claude Code) or \`@clossys-${shortName} loop\` (Cursor). One invocation runs one iteration and stops at the approval gate inside judge (docs/contracts/loop.json).`,
    "",
  ];
  for (const stage of ["sense", "judge", "act", "verify", "learn"]) {
    parts.push(renderStageSection(stage, stageActivities, cellsByStage.get(stage)));
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Splices `section` into `skillBody` at the `## Run the feedback loop` heading, replacing through the next `## ` heading (or end of file). Inserts before `## When this package is installed` when the heading is not already present. */
export function spliceLoopSection(skillBody, section) {
  const lines = skillBody.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === HEADING);
  let start;
  let end;
  if (headingIndex !== -1) {
    start = headingIndex;
    end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const trimmed = (lines[index] ?? "").trim();
      if (trimmed.startsWith("## ") && trimmed !== HEADING) { end = index; break; }
    }
  } else {
    const installedIndex = lines.findIndex((line) => line.trim() === "## When this package is installed");
    start = installedIndex === -1 ? lines.length : installedIndex;
    end = start;
  }
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const needsLeadingBlank = before.length > 0 && (before[before.length - 1] ?? "").trim() !== "";
  const needsTrailingBlank = after.length > 0 && (after[0] ?? "").trim() !== "";
  const block = [...(needsLeadingBlank ? [""] : []), ...section.replace(/\n$/, "").split("\n"), ...(needsTrailingBlank ? [""] : [])];
  return [...before, ...block, ...after].join("\n");
}

export function loadLoopMatrix(root, packageDir) {
  const matrixPath = join(root, "packages", packageDir, "loop-matrix.json");
  if (!existsSync(matrixPath)) return null;
  return readJson(matrixPath);
}

function main(argv) {
  const write = argv.includes("--write");
  const positional = argv.filter((value) => value !== "--write");
  const packageDir = positional[0];
  const root = resolve(positional[1] ?? join(scriptDir, ".."));
  if (!packageDir) {
    console.error("Usage: generate-loop-section.mjs <packageDir> [--write] [<repoRoot>]");
    return 2;
  }
  const matrixDoc = loadLoopMatrix(root, packageDir);
  if (matrixDoc === null) {
    console.error(`generate-loop-section: packages/${packageDir}/loop-matrix.json does not exist -- nothing to generate`);
    return 2;
  }
  let stageActivities;
  try {
    ({ stageActivities } = loadStageActivities(root, matrixDoc.role));
  } catch (error) {
    console.error(`generate-loop-section: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const section = generateLoopSection(matrixDoc.role, matrixDoc, stageActivities);
  if (!write) {
    process.stdout.write(section);
    return 0;
  }
  const skillPath = join(root, "packages", packageDir, "skill", "SKILL.md");
  const skillBody = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : "";
  writeFileSync(skillPath, spliceLoopSection(skillBody, section));
  console.log(`generate-loop-section: wrote packages/${packageDir}/skill/SKILL.md`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
