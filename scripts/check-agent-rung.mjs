#!/usr/bin/env node
// check:agent-rung:<rung> (Controller): re-runs one rung's check (scripts/lib/agent-ladder.mjs RUNG_CHECKS) for every
// agent that docs/contracts/agents.rungs.json places at that rung or higher, so no agent keeps a rung its check no
// longer gives it. The conforming rung runs check-package-conformance.mjs --enforce. Exits 1 on any failure, 2 on a
// usage error or a missing rungs file.
//   node scripts/check-agent-rung.mjs <rung> [--root DIR]
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNG_CHECKS, RUNGS_PATH, ladderContext, readRungs, rungIndex } from "./lib/agent-ladder.mjs";

export function checkRung(root, rung, { checks = RUNG_CHECKS } = {}) {
  const rungs = readRungs(root);
  if (!rungs) return { exitCode: 2, lines: [`${RUNGS_PATH} is absent; run \`clossys agents check\``] };
  if (!rungs.ladder.includes(rung) || !checks[rung]) return { exitCode: 2, lines: [`unknown rung ${rung}; the ladder is ${rungs.ladder.join(", ")}`] };
  const context = ladderContext(root);
  const rows = new Map(context.rows.map((row) => [row.id, row]));
  const lines = [];
  let failed = 0;
  let held = 0;
  for (const agent of rungs.agents) {
    if (rungIndex(rungs.ladder, agent.rung) < rungIndex(rungs.ladder, rung)) continue;
    const row = rows.get(agent.id);
    let missing;
    if (!row) missing = ["no agents.json row"];
    else {
      try { missing = checks[rung](context, row); } catch (error) { missing = [`check could not run: ${error instanceof Error ? error.message : String(error)}`]; }
    }
    if (missing.length === 0) { held += 1; lines.push(`PASS ${rung} ${agent.id}`); continue; }
    failed += 1;
    lines.push(`FAIL ${rung} ${agent.id}: ${missing.join("; ")}`);
  }
  lines.push(`check:agent-rung:${rung}: ${held} agent(s) at ${rung} or higher hold it, ${failed} do not.`);
  return { exitCode: failed > 0 ? 1 : 0, lines };
}

function main(argv) {
  const args = [...argv];
  const at = args.indexOf("--root");
  let root = process.cwd();
  if (at !== -1) { root = resolve(args[at + 1] ?? ""); args.splice(at, 2); }
  if (args.length !== 1) {
    console.error("usage: node scripts/check-agent-rung.mjs <rung> [--root DIR]");
    return 2;
  }
  const result = checkRung(root, args[0]);
  for (const line of result.lines) (result.exitCode === 0 ? console.log : console.error)(line);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
