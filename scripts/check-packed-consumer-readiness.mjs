#!/usr/bin/env node

import { resolve } from "node:path";
import { parsePackedConsumerArgs, runPackedConsumerReadiness } from "./lib/packed-consumer-readiness.mjs";

try {
  const args = parsePackedConsumerArgs(process.argv.slice(2));
  const result = await runPackedConsumerReadiness({ ...args, root: resolve(args.root ?? process.cwd()) });
  for (const omission of result.frameworkEvaluatorOmissions) {
    console.log(`packed consumer readiness: EVIDENCE ${omission.package} rejects ${omission.exports.length} declared Next-context export(s) when next is omitted — ${omission.evidence}`);
  }
  console.log(`packed consumer readiness: PASS (${result.packages} package(s), ${result.runtimeImports} raw runtime import(s), ${result.frameworkExports} framework export(s), ${result.staticTargets} static target(s), ${result.bins} bin(s), ${result.omissionRows} optional-peer omission row(s))`);
  if (args.keep) console.log(`retained disposable consumer: ${result.scratch}`);
} catch (error) {
  console.error(`packed consumer readiness: FAIL\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
