#!/usr/bin/env node
import { LATER_PUBLICATION_DIRECTORY, validateRetainedLaterPublications } from "./lib/release-later-publication.mjs";

const { names, findings } = validateRetainedLaterPublications(process.cwd());
if (findings.length) {
  console.error("LATER PUBLICATION RECORDS INVALID");
  for (const item of findings) console.error(`- [${item.rule}] ${item.message}`);
  process.exitCode = 1;
} else {
  console.log(`LATER PUBLICATION RECORDS OK — ${names.size} immutable package-neutral record(s) in ${LATER_PUBLICATION_DIRECTORY}.`);
}
