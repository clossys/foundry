/**
 * The conformance runner (foundry-build-0048 U1): judges every assertion of assertions.json, then every
 * dogfood row, for each agent, and formats one RED/GREEN line per cell with every red row under it.
 * Report-only: nothing here is a gate; `clossys conform` exits 1 while any cell is red.
 */
import { readFileSync } from "node:fs";
import { ASSERTIONS, type Judgement } from "./assertions.js";
import { judgeDogfood, type DogfoodRow, type ProbeFacts } from "./dogfood.js";
import type { ConformModel } from "./model.js";

export interface AssertionEntry { readonly id: string; readonly lens: string; readonly statement: string; readonly check: string; readonly status: string; readonly enforcedFor: readonly string[] }
export interface Registry { readonly schema: string; readonly agents: readonly string[]; readonly assertions: readonly AssertionEntry[]; readonly dogfood: readonly DogfoodRow[] }

export function readRegistry(): Registry {
  return JSON.parse(readFileSync(new URL("../../src/conform/assertions.json", import.meta.url), "utf8")) as Registry;
}

export interface Cell { readonly id: string; readonly label: string; readonly red: boolean; readonly vacuous: boolean; readonly rows: readonly string[]; readonly evidence: number; readonly findings: readonly string[] }
export interface AgentReport { readonly agent: string; readonly adapterIssues: readonly string[]; readonly cells: readonly Cell[]; readonly dogfood: readonly Cell[]; readonly red: number; readonly green: number; readonly dogfoodRed: number; readonly dogfoodGreen: number }
export interface ConformReport { readonly schema: "clossys.conform-report/1"; readonly ok: boolean; readonly agents: readonly AgentReport[] }

/** Empty is red: a judgement with no evidence is vacuous and red, whatever its rows. */
export function cellOf(id: string, label: string, judgement: Judgement): Cell {
  const vacuous = judgement.evidence === 0;
  return { id, label, red: vacuous || judgement.rows.length > 0, vacuous, rows: vacuous ? [...judgement.rows, "vacuous: nothing to judge (empty is red)"] : judgement.rows, evidence: judgement.evidence, findings: judgement.findings ?? [] };
}

/** `facts` comes from readProbeFacts (dogfood.ts), which runs the real verbs on temporary copies; a test passes its own. */
export function conform(model: ConformModel, registry: Registry, facts: ProbeFacts): ConformReport {
  const agents = model.agents.map(agent => {
    // An agent with no valid adapter is uncovered: every assertion is red with the adapter issues as its rows.
    const uncovered = agent.adapter === undefined;
    const cells = registry.assertions.map(entry => {
      const fn = ASSERTIONS[entry.id];
      const judgement: Judgement = uncovered ? { rows: agent.adapterIssues.map(issue => `uncovered: ${issue}`), evidence: 0 }
        : fn ? fn(agent, model, facts) : { rows: [`no assertion function for ${entry.id}`], evidence: 0 };
      return cellOf(entry.id, `${entry.lens}  ${entry.statement}`, judgement);
    });
    const dogfood = registry.dogfood.filter(row => row.agent === agent.agent).map(row =>
      cellOf(row.id, `${row.result}  ${row.finding}`, uncovered ? { rows: agent.adapterIssues.map(issue => `uncovered: ${issue}`), evidence: 0 } : judgeDogfood(row, agent, model, facts)));
    const red = cells.filter(cell => cell.red).length, dogfoodRed = dogfood.filter(cell => cell.red).length;
    return { agent: agent.agent, adapterIssues: agent.adapterIssues, cells, dogfood, red, green: cells.length - red, dogfoodRed, dogfoodGreen: dogfood.length - dogfoodRed };
  });
  return { schema: "clossys.conform-report/1", ok: agents.every(agent => agent.red === 0 && agent.dogfoodRed === 0), agents };
}

export function formatReport(report: ConformReport): string {
  const lines: string[] = [];
  const cellLines = (cell: Cell) => [`  ${cell.red ? "RED  " : "GREEN"} ${cell.id.padEnd(22)} ${cell.label}`, ...cell.rows.map(row => `        - ${row}`), ...cell.findings.map(row => `        ~ ${row} (report-only)`)];
  for (const agent of report.agents) {
    lines.push(`conform ${agent.agent}`);
    for (const cell of agent.cells) lines.push(...cellLines(cell));
    lines.push(`  dogfood rows`);
    for (const cell of agent.dogfood) lines.push(...cellLines(cell));
    lines.push(`  ${agent.agent}: standard ${agent.red} red, ${agent.green} green of ${agent.cells.length}; dogfood ${agent.dogfoodRed} red, ${agent.dogfoodGreen} green of ${agent.dogfood.length}`, "");
  }
  lines.push(`conform: ${report.agents.map(agent => `${agent.agent} ${agent.red}/${agent.cells.length} red (+${agent.dogfoodRed}/${agent.dogfood.length} dogfood)`).join(", ")}${report.ok ? "; all green" : "; report-only, not a gate"}`);
  return lines.join("\n");
}
