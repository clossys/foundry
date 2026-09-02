#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import {
  AGGREGATE_V2_CANARY_PATH,
  buildAggregateV2Closure,
  retainAggregateV2Closure,
} from "./lib/public-npm-aggregate-canary-v2.mjs";

function usage() {
  throw new Error("usage: create-public-npm-aggregate-canary-v2-closures.mjs");
}

try {
  if (process.argv.length !== 2) usage();
  const root = process.cwd();
  const regularHead = (path) => execFileSync("git", ["ls-tree", "HEAD", "--", path], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).startsWith("100644 ");
  const readHead = (path) => {
    if (!regularHead(path)) throw new Error(`required evidence is not a regular committed HEAD blob: ${path}`);
    return execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  };
  const publicationPaths = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", "governance/release-publications/later"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .trim().split("\n").filter(Boolean);
  if (publicationPaths.some((path) => !regularHead(path))) throw new Error("every enumerated publication must be a regular committed HEAD blob");
  const plan = JSON.parse(readHead(AGGREGATE_V2_CANARY_PATH));
  const generated = buildAggregateV2Closure({ root, plan, read: readHead, publicationPaths });
  const retained = await retainAggregateV2Closure({ root, closure: generated.closure });
  if (retained !== generated.closurePath) throw new Error("retained closure path does not equal its deterministic digest identity");
  console.log(`public npm aggregate canary v2 closure created — ${generated.closurePath}`);
} catch (error) {
  console.error(`public npm aggregate canary v2 closure creation: VIOLATED\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
