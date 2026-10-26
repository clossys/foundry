#!/usr/bin/env node
// Repository tooling: this script does not ship in the installed package.
import { readFileSync } from "node:fs";
import { componentDocsPath, componentSkillPath, generateComponentDocs, generateComponentSkillSection, replaceComponentSkillSection } from "./generate-component-docs.mjs";
try {
  const skill = readFileSync(componentSkillPath, "utf8");
  if (readFileSync(componentDocsPath, "utf8") !== await generateComponentDocs() || skill !== replaceComponentSkillSection(skill, generateComponentSkillSection())) {
    console.error("Component guide or skill selection is stale. Run node scripts/generate-component-docs.mjs.");
    process.exitCode = 1;
  } else console.log("Component guide and selection skill match shared component data.");
} catch (error) {
  console.error(`Component documentation cannot be checked: ${error.message}`);
  process.exitCode = 2;
}
