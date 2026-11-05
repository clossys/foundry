#!/usr/bin/env node
/**
 * Usage: node scripts/check-designer-dogfood.mjs --admin-root SOURCE [--admin-root SOURCE]... [--root ADDITIONAL_SOURCE]...
 * Admin roots are explicit caller-owned shell entries/directories and stylesheets. Supply every shell entry
 * that is not reachable from another supplied entry; local imports (including CSS) are followed.
 * Studio's whole shipped source directory and PublisherPage's reachable closure are always required.
 * --root adds scope; it no longer replaces those consumers. Missing admin scope fails before scanning.
 * No exception manifest, ignore comment or source allowlist can waive a consumer finding.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanDesignerDogfood } from "./lib/designer-dogfood.mjs";
import { designerDogfoodRoots, designerDogfoodScopes } from "./lib/designer-dogfood-scopes.mjs";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let report;
try {
  const consumerScopes = designerDogfoodScopes(process.argv.slice(2), repo);
  report = { ...scanDesignerDogfood({ designerRoot: resolve(repo, "packages/designer"), roots: designerDogfoodRoots(consumerScopes) }), consumerScopes };
} catch (error) {
  report = { schema: "designer-dogfood/v1", ok: false, findings: [{ code: "DG0", file: "", line: 1, message: error.message }], inventory: [], foundation: [] };
}
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exitCode = report.ok ? 0 : 1;
