#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { checkDocsPath, generateCheckDocs } from "./generate-check-docs.mjs";
try {
  if (readFileSync(checkDocsPath, "utf8") !== await generateCheckDocs()) {
    console.error("Check code reference is stale. Run node scripts/generate-check-docs.mjs.");
    process.exitCode = 1;
  } else console.log("Check code reference matches every Finding.code and runtime guidance.");
} catch (error) {
  console.error(`Check code reference cannot be checked: ${error.message}`);
  process.exitCode = 2;
}
