#!/usr/bin/env node
/**
 * check:ia-source (SOURCE-MIGRATE step 6, blocking): every consumer ia.json `source` resolves. A
 * source is `@clossys/<package>#<path>`, a file or folder that exists in that installed package, or
 * `workspace#owner` for a workspace-owned IA (records/slot-model/ia-source.ts). A dead source (a
 * consumer path, a leaf-freeze label, a package path that is not there) fails.
 *
 *   node scripts/check-ia-source.mjs [--root <consumer root>] [--json]
 *
 * Exit 0 when every ia.json source resolves, 1 on any that does not, 2 when the root holds no consumer.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { resolveIaSource } = await import(pathToFileURL(join(here, "..", "dist", "records", "slot-model", "ia-source.js")).href);
const args = process.argv.slice(2);
const at = args.indexOf("--root");
const root = resolve(at >= 0 ? args[at + 1] : process.cwd());
const agents = join(root, "clossys", "agents");
if (!existsSync(agents)) { console.error(`check-ia-source: no clossys/agents under ${root}`); process.exit(2); }

const report = { root, sources: [], failures: [] };
for (const agent of readdirSync(agents, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
  const file = join(agents, agent, "ia.json");
  if (!existsSync(file)) continue;
  let source;
  try { source = JSON.parse(readFileSync(file, "utf8")).source; }
  catch (error) { report.failures.push({ agent, source: null, reason: `ia.json is not JSON (${error.message})` }); continue; }
  const resolution = resolveIaSource(source);
  report.sources.push({ agent, source, ok: resolution.ok, ...(resolution.ok ? { kind: resolution.kind } : { reason: resolution.reason }) });
  if (!resolution.ok) report.failures.push({ agent, source, reason: resolution.reason });
}

if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  for (const row of report.sources) console.log(`${row.ok ? "ok  " : "FAIL"} ${row.agent}: ${row.source}${row.ok ? ` (${row.kind})` : ` - ${row.reason}`}`);
  for (const row of report.failures.filter(row => row.source === null)) console.log(`FAIL ${row.agent}: ${row.reason}`);
  console.log(`check:ia-source: ${report.failures.length ? `${report.failures.length} ia.json source(s) do not resolve` : `${report.sources.length} ia.json sources resolve`}`);
}
process.exit(report.failures.length ? 1 : 0);
