#!/usr/bin/env node
/**
 * Copies each package skill source into skill-catalogue/<name>/SKILL.md, and
 * two contracts -- the shared conversation contract (#1182) and the
 * repository inventory schema (#1334) -- into contracts/, so the published
 * launcher tarball carries its own copy of what it validates and composes
 * against without depending on this monorepo's root docs/ at runtime.
 *
 * It also writes src/generated/ (issue #1475): the shared plan and brief
 * contracts as a data module, and a copy of the one contract checker, which
 * lives in @clossys/advisor. This package validates a plan and a brief
 * against the same contracts Advisor does, with no runtime dependency on
 * Advisor. The rendering is shared with Advisor's own packer
 * (scripts/lib/plan-contracts.mjs in this repository), so both packages
 * carry byte-identical plan and brief contract data. This package also packs
 * the repository change-set and apply-bundle contracts (issue #1178), which
 * it computes and Advisor never reads.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_SCHEMA_COPY_PATH,
  LAUNCHER_CONTRACT_FILES,
  PLAN_CONTRACTS_MODULE_PATH,
  renderContractSchemaCopy,
  renderPlanContractsModule,
} from "../../../scripts/lib/plan-contracts.mjs";

const launcherRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(launcherRoot, "..");
const repoRoot = join(packagesDir, "..");
const outDir = join(launcherRoot, "skill-catalogue");
const contractsOutDir = join(launcherRoot, "contracts");
const contractSource = join(repoRoot, "docs", "contracts", "conversation-contract.md");
const inventoryContractSource = join(repoRoot, "docs", "contracts", "repository-inventory.json");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let copied = 0;
if (existsSync(packagesDir)) {
  for (const name of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const skillPath = join(packagesDir, name.name, "skill", "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const destDir = join(outDir, name.name);
    mkdirSync(destDir, { recursive: true });
    cpSync(skillPath, join(destDir, "SKILL.md"));
    copied += 1;
  }
}

console.log(`pack-skills: copied ${copied} skill(s) into skill-catalogue/`);

if (existsSync(contractsOutDir)) rmSync(contractsOutDir, { recursive: true, force: true });
if (!existsSync(contractSource)) {
  throw new Error(`pack-skills: missing ${contractSource} — docs/contracts/conversation-contract.md is required to build @clossys/launcher`);
}
if (!existsSync(inventoryContractSource)) {
  throw new Error(`pack-skills: missing ${inventoryContractSource} — docs/contracts/repository-inventory.json is required to build @clossys/launcher`);
}
mkdirSync(contractsOutDir, { recursive: true });
cpSync(contractSource, join(contractsOutDir, "conversation-contract.md"));
cpSync(inventoryContractSource, join(contractsOutDir, "repository-inventory.json"));
console.log("pack-skills: packed the conversation contract into contracts/conversation-contract.md");
console.log("pack-skills: packed the repository inventory contract into contracts/repository-inventory.json");

const generatedDir = join(launcherRoot, "src", "generated");
if (existsSync(generatedDir)) rmSync(generatedDir, { recursive: true, force: true });
mkdirSync(generatedDir, { recursive: true });
writeFileSync(join(launcherRoot, ...PLAN_CONTRACTS_MODULE_PATH.split("/")), renderPlanContractsModule(repoRoot, LAUNCHER_CONTRACT_FILES));
writeFileSync(join(launcherRoot, ...CONTRACT_SCHEMA_COPY_PATH.split("/")), renderContractSchemaCopy(repoRoot));
console.log(`pack-skills: wrote the plan, brief, change-set and bundle contracts and the contract checker copy into src/generated/`);
