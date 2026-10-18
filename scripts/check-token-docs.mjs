#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { generateTokenDocs, generateTokenSkillSection, replaceTokenSkillSection, tokenDocsPath, tokenSkillPath } from "./generate-token-docs.mjs";

try {
  const expected = await generateTokenDocs();
  const skill = readFileSync(tokenSkillPath, "utf8");
  const expectedSkill = replaceTokenSkillSection(skill, await generateTokenSkillSection());
  if (readFileSync(tokenDocsPath, "utf8") !== expected || skill !== expectedSkill) {
    console.error("Token reference or selection skill is stale. Run node scripts/generate-token-docs.mjs.");
    process.exitCode = 1;
  } else {
    console.log("Token reference and selection skill match shared token data.");
  }
} catch (error) {
  console.error(`Token reference cannot be checked: ${error.message}`);
  process.exitCode = 1;
}
