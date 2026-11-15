#!/usr/bin/env node
/**
 * check:slot-defaults (SOURCE-MIGRATE step 4): every package slot's behaviour fields in a consumer
 * slot.json (standard, options, varyOn, inputs) equal the package data: the agent's
 * src/catalog/slot-defaults.json, the producer option classes and the read graph. Declared
 * extensions keep their own fields and are only counted.
 *
 *   node scripts/check-slot-defaults.mjs [--root <consumer root>] [--json]
 *
 * Exit 0 when every placed package slot matches, 1 on any mismatch or a missing slot.json, 2 when
 * the root holds no consumer.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { consumerRootAt } from './consumer-root.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist", "records", "slot-model");
const { SYNC_AGENTS, BEHAVIOUR_KEYS, syncState, refContext, packageBehaviour } = await import(join(dist, "ia-sync.js"));
const args = process.argv.slice(2);
const at = args.indexOf("--root");
const root = at >= 0 ? resolve(args[at + 1]) : consumerRootAt();
const consumer = join(root, "clossys");
if (!existsSync(join(consumer, "agents"))) { console.error(`check-slot-defaults: no clossys/agents under ${root}`); process.exit(2); }
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const report = { root, agents: {}, mismatches: [] };
for (const agent of SYNC_AGENTS) {
  const state = syncState(consumer, agent);
  if (!state.consumer) { report.mismatches.push({ agent, detail: "no ia.json" }); continue; }
  const ctx = refContext(consumer, agent, state);
  const counts = { checked: 0, standard: 0, options: 0, listedInputs: 0, extensions: 0 };
  for (const [id, position] of state.positions) {
    const slot = state.pkg.slots.get(id);
    if (!slot) { counts.extensions++; continue; }
    const file = join(consumer, "agents", agent, id, "slot.json");
    if (!existsSync(file)) { report.mismatches.push({ agent, slot: id, detail: "placed with no slot.json" }); continue; }
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const want = packageBehaviour(agent, id, slot, position, ctx);
    counts.checked++;
    if (want.standard !== undefined) counts.standard++;
    if (want.options !== undefined) counts.options++;
    if (slot.defaults.inputs) counts.listedInputs++;
    for (const key of BEHAVIOUR_KEYS) {
      if (!same(doc[key], want[key])) report.mismatches.push({ agent, slot: id, detail: `${key} ${JSON.stringify(doc[key] ?? null)}, package ${JSON.stringify(want[key] ?? null)}` });
    }
  }
  report.agents[agent] = counts;
}

if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  for (const [agent, c] of Object.entries(report.agents)) console.log(`${agent}: ${c.checked} package slots checked (${c.standard} standard, ${c.options} options, ${c.listedInputs} listed inputs); ${c.extensions} extensions kept`);
  for (const m of report.mismatches.slice(0, 40)) console.log(`  MISMATCH ${m.agent}${m.slot ? `/${m.slot}` : ""}: ${m.detail}`);
  if (report.mismatches.length > 40) console.log(`  ... and ${report.mismatches.length - 40} more`);
  console.log(`check:slot-defaults: ${report.mismatches.length ? `${report.mismatches.length} mismatch(es)` : "every package slot matches the package data"}`);
}
process.exit(report.mismatches.length ? 1 : 0);
