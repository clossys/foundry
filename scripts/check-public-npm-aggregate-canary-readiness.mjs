#!/usr/bin/env node
import { existsSync } from "node:fs";
import { AGGREGATE_TRANSCRIPT_DIRECTORY } from "./lib/public-npm-aggregate-canary.mjs";

if (!existsSync(AGGREGATE_TRANSCRIPT_DIRECTORY)) {
  console.error("public npm aggregate canary: INDETERMINATE — no immutable satisfied aggregate transcript exists.");
  process.exitCode = 2;
} else await import("./check-public-npm-aggregate-transcripts.mjs");
