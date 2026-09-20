#!/usr/bin/env node
/**
 * Copies each package skill source into skill-catalogue/<name>/SKILL.md
 * so the published launcher tarball can compose skills from its own packed files.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const launcherRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(launcherRoot, "..");
const outDir = join(launcherRoot, "skill-catalogue");

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
