#!/usr/bin/env node
/**
 * Copies each package skill source into skill-catalogue/<name>/SKILL.md, and
 * two contracts -- the shared conversation contract (#1182) and the
 * repository inventory schema (#1334) -- into contracts/, so the published
 * launcher tarball carries its own copy of what it validates and composes
 * against without depending on this monorepo's root docs/ at runtime.
 *
 * What it copies, and from where, is declared once, as data, in
 * scripts/packed-copies.json beside this file. This script copies exactly
 * that list, and the repository's contamination gate reads the same list to
 * judge each copy of another package's file from its source's position
 * (#1500), so the two cannot disagree about what is a copy.
 *
 * It also writes src/generated/ (issue #1475): the shared plan and brief
 * contracts as a data module, and a copy of the one contract checker, which
 * lives in @clossys/advisor. This package validates a plan and a brief
 * against the same contracts Advisor does, with no runtime dependency on
 * Advisor. The rendering is shared with Advisor's own packer
 * (scripts/lib/plan-contracts.mjs in this repository), so both packages
 * carry byte-identical plan and brief contract data. This package also packs
 * the registry snapshot contract, as Advisor does, with the publishing scope
 * and registry from package-scope.json: the snapshot step reads its registry
 * from there, never from a hardcoded value, and validates what it writes
 * against the contract. After those come the repository change-set and
 * apply-bundle contracts (issue #1178), which it computes and Advisor never
 * reads.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PACKED_COPIES_FILE, loadPackedCopies } from "../../../scripts/lib/packed-copies.mjs";
import {
  CONTRACT_SCHEMA_COPY_PATH,
  LAUNCHER_CONTRACT_FILES,
  PACKAGE_SCOPE_MODULE_PATH,
  PLAN_CONTRACTS_MODULE_PATH,
  renderContractSchemaCopy,
  renderPackageScopeModule,
  renderPlanContractsModule,
} from "../../../scripts/lib/plan-contracts.mjs";

const launcherRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(launcherRoot, "..");
const repoRoot = join(packagesDir, "..");

// The directories this script owns and rebuilds from scratch. Every declared
// copy must land in one of them, so a stale copy from an earlier build can
// never survive beside the declared set.
const OWNED_DIRS = ["skill-catalogue", "contracts"];

const copies = loadPackedCopies(launcherRoot, repoRoot);
if (!copies) throw new Error(`pack-skills: missing ${PACKED_COPIES_FILE} -- the declaration of what this build copies`);
for (const { copy, source } of copies) {
  if (!OWNED_DIRS.includes(copy.split("/")[0])) {
    throw new Error(`pack-skills: ${PACKED_COPIES_FILE} declares "${copy}", outside the directories this script rebuilds (${OWNED_DIRS.join(", ")})`);
  }
  if (!existsSync(join(repoRoot, ...source.split("/")))) {
    throw new Error(`pack-skills: missing ${source} -- it is required to build @clossys/launcher`);
  }
}

for (const dir of OWNED_DIRS) {
  rmSync(join(launcherRoot, dir), { recursive: true, force: true });
  mkdirSync(join(launcherRoot, dir), { recursive: true });
}
for (const { copy, source } of copies) {
  const dest = join(launcherRoot, ...copy.split("/"));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(repoRoot, ...source.split("/")), dest);
}
const skills = copies.filter((c) => c.copy.startsWith("skill-catalogue/")).length;
console.log(`pack-skills: copied ${skills} skill(s) into skill-catalogue/`);
for (const { copy, source } of copies) {
  if (!copy.startsWith("skill-catalogue/")) console.log(`pack-skills: packed ${source} into ${copy}`);
}

const generatedDir = join(launcherRoot, "src", "generated");
if (existsSync(generatedDir)) rmSync(generatedDir, { recursive: true, force: true });
mkdirSync(generatedDir, { recursive: true });
writeFileSync(join(launcherRoot, ...PLAN_CONTRACTS_MODULE_PATH.split("/")), renderPlanContractsModule(repoRoot, LAUNCHER_CONTRACT_FILES));
writeFileSync(join(launcherRoot, ...CONTRACT_SCHEMA_COPY_PATH.split("/")), renderContractSchemaCopy(repoRoot));
writeFileSync(join(launcherRoot, ...PACKAGE_SCOPE_MODULE_PATH.split("/")), renderPackageScopeModule(repoRoot));
console.log(`pack-skills: wrote the plan, brief, registry snapshot, change-set and bundle contracts, the contract checker copy, and the publishing scope and registry into src/generated/`);
