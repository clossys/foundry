#!/usr/bin/env node
// Repository tooling: this script does not ship in the installed package.
import { readFileSync } from "node:fs";
import { atomDocsPath, atomSkillPath, generateAtomDocs, generateAtomSkillSection, replaceAtomSkillSection } from "./generate-atom-docs.mjs";
try {
  const skill = readFileSync(atomSkillPath, "utf8");
  if (readFileSync(atomDocsPath, "utf8") !== await generateAtomDocs() || skill !== replaceAtomSkillSection(skill, generateAtomSkillSection())) {
    console.error("Atom guide or skill selection is stale. Run node scripts/generate-atom-docs.mjs.");
    process.exitCode = 1;
  } else console.log("Atom guide and selection skill match shared atom data.");
} catch (error) {
  console.error(`Atom documentation cannot be checked: ${error.message}`);
  process.exitCode = 2;
}
