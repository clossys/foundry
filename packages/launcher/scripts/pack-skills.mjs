#!/usr/bin/env node
/**
 * Copies each package skill source into skill-catalogue/<name>/SKILL.md, and
 * two contracts -- the shared conversation contract (#1182) and the
 * repository inventory schema (#1334) -- into contracts/, so the published
 * launcher tarball carries its own copy of what it validates and composes
 * against without depending on this monorepo's root docs/ at runtime.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
