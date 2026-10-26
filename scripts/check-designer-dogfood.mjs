#!/usr/bin/env node
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanDesignerDogfood } from "./lib/designer-dogfood.mjs";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), roots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--root" || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("usage: check-designer-dogfood.mjs [--root SOURCE]...");
  roots.push(resolve(args[++i]));
}
const report = scanDesignerDogfood({ designerRoot: resolve(repo, "packages/designer"), roots: roots.length ? roots : [resolve(repo, "packages/designer/src/studio/index.ts"), resolve(repo, "packages/publisher/src/web/publisher/PublisherPage.tsx")] });
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exitCode = report.ok ? 0 : 1;
