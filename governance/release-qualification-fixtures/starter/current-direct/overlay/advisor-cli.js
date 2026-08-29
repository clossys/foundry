#!/usr/bin/env node
import { readFileSync } from "node:fs";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
console.log(JSON.stringify({
  state: "satisfied",
  assessment: {
    firstWavePlan: {
      state: "ready-for-sponsor-approval",
      workItems: [{
        targetRepositoryId: input.target.repository,
        package: { name: input.target.name, version: input.target.version, integrity: input.target.integrity },
        bin: input.target.bin,
        invocation: input.target.invocation
      }]
    }
  }
}));
