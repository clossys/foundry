#!/usr/bin/env node
// check:agent-ladder (Controller): the readiness ladder of docs/contracts/agents.json is whole and wired. Static: reads
// files, runs no rung check (check:agent-rung:<rung> and check:agent-rungs do). Findings, `<rule> <subject>: <message>`:
//   ladder-rungs        the ladder's rungs are not exactly the rungs scripts/lib/agent-ladder.mjs has a check for;
//   rung-check-unwired  a rung's check, check:agent-ladder or check:agent-rungs is not a root script run by root `check`;
//   rung-check-unowned  one of those checks has no rules-registry row with owner_agent controller;
//   need-unknown        a ladder need names a list agents.json does not have or a rung the ladder does not have;
//   rungs-absent / rungs-drift  agents.rungs.json is missing, or its ladder or agents disagree with agents.json, or an
//                       agent's next rung is not the one above its rung;
//   rungs-copy-drift    packages/producer/src/agent-rungs.generated.ts is not the render of agents.rungs.json.
//   node scripts/check-agent-ladder.mjs [--root DIR]
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNG_CHECKS, RUNGS_COPY_PATH, RUNGS_PATH, renderRungsCopy } from "./lib/agent-ladder.mjs";

const read = (root, path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null);
const parse = (text) => { try { return text === null ? null : JSON.parse(text); } catch { return null; } };

/** Every finding about the ladder at `root`: [{ rule, subject, message }]. */
export function evaluateLadder(root, { checks = RUNG_CHECKS } = {}) {
  const findings = [];
  const find = (rule, subject, message) => findings.push({ rule, subject, message });
  const agents = parse(read(root, "docs/contracts/agents.json"));
  const manifest = parse(read(root, "package.json"));
  const registry = parse(read(root, "scripts/rules/registry.json"));
  const rungs = agents?.ladder?.rungs ?? [];
  const ids = rungs.map((rung) => rung.id);
  const known = Object.keys(checks);
  if (ids.join(",") !== known.join(",")) find("ladder-rungs", "agents.json ladder", `rungs are [${ids.join(", ")}]; the rung checks are [${known.join(", ")}], in that order`);
  const steps = (manifest?.scripts?.check ?? "").split(/\s+/);
  const owned = new Set((registry?.rules ?? []).filter((row) => row.owner_agent === "controller").flatMap((row) => row.checks ?? []));
  for (const script of [...rungs.map((rung) => rung.check), "check:agent-ladder", "check:agent-rungs"]) {
    if (typeof manifest?.scripts?.[script] !== "string" || !steps.includes(script)) find("rung-check-unwired", script, "is not a root script that root `check` runs");
    if (!owned.has(`.#${script}`)) find("rung-check-unowned", script, "has no rules-registry row whose owner_agent is controller");
  }
  for (const need of agents?.ladder?.needs ?? []) {
    if (!agents?.lists?.[need.list]) find("need-unknown", `ladder.needs ${need.list}`, "names a list agents.json does not have");
    if (!ids.includes(need.rung)) find("need-unknown", `ladder.needs ${need.list}`, `needs rung ${need.rung}, which the ladder does not have`);
  }
  const computed = parse(read(root, RUNGS_PATH));
  if (!computed) { find("rungs-absent", RUNGS_PATH, "is missing or unreadable; run `clossys agents check`"); return findings; }
  if ((computed.ladder ?? []).join(",") !== ids.join(",")) find("rungs-drift", RUNGS_PATH, "its ladder differs from agents.json's; run `clossys agents check`");
  const rows = (agents?.agents ?? []).map((row) => row.id);
  const listed = (computed.agents ?? []).map((agent) => agent.id);
  if (listed.join(",") !== rows.join(",")) find("rungs-drift", RUNGS_PATH, "its agents differ from agents.json's rows; run `clossys agents check`");
  for (const agent of computed.agents ?? []) {
    const at = agent.rung === null ? -1 : ids.indexOf(agent.rung);
    if (agent.rung !== null && at === -1) find("rungs-drift", `${RUNGS_PATH} ${agent.id}`, `rung ${agent.rung} is not on the ladder`);
    if ((ids[at + 1] ?? null) !== agent.next) find("rungs-drift", `${RUNGS_PATH} ${agent.id}`, `next is ${agent.next}, but the rung above ${agent.rung} is ${ids[at + 1] ?? null}`);
    if ((agent.next === null) !== ((agent.missing ?? []).length === 0)) find("rungs-drift", `${RUNGS_PATH} ${agent.id}`, "an agent below the top rung names what it misses, and only that agent");
  }
  if (read(root, RUNGS_COPY_PATH) !== renderRungsCopy(computed)) find("rungs-copy-drift", RUNGS_COPY_PATH, `differs from the render of ${RUNGS_PATH}; run \`clossys agents check\``);
  return findings;
}

function main(argv) {
  const at = argv.indexOf("--root");
  const root = at === -1 ? process.cwd() : resolve(argv[at + 1] ?? "");
  const findings = evaluateLadder(root);
  for (const item of findings) console.log(`${item.rule} ${item.subject}: ${item.message}`);
  if (findings.length === 0) console.log("check:agent-ladder: the ladder is whole, every rung's check runs in root check and is Controller's, and agents.rungs.json and its Producer copy agree.");
  return findings.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
