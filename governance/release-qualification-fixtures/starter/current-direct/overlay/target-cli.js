#!/usr/bin/env node
import { readFileSync } from "node:fs";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const state = ["satisfied", "violated", "indeterminate"].includes(input.mode) ? input.mode : "indeterminate";
console.log(JSON.stringify({ state }));
process.exitCode = state === "satisfied" ? 0 : state === "violated" ? 1 : 2;
