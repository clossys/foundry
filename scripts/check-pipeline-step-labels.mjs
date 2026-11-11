#!/usr/bin/env node
// check:pipeline-step-labels: every step node the Content overview (/content)
// draws is titled by its resolved Writer copy, never by its raw step id.
//
// It bundles the view's own input builder (packages/producer/studio/lib/
// pipeline-flow.ts, the code the page renders from) with esbuild, runs it on
// the active wiring (`clossys pipeline wiring`, built from the run records
// under the repository) and on every step graph.json defines (so a step that
// has not run yet is titled the moment it does, in each node form the wiring
// draws: a step, a step run in more than one way, a check), and reads each
// canvas node's label. A finding is a node whose label equals its id
// (ignoring case and surrounding space), or a node whose label does not
// resolve at all.
//
// Usage: node scripts/check-pipeline-step-labels.mjs [--root REPO] [--graph FILE] [--wiring FILE] [--json]
// Exit 0 when every label is copy, 1 on any finding, 2 on a usage or environment error.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const normalize = (text) => String(text ?? "").trim().toLowerCase();

/** Findings for the canvas step nodes: a label that is missing, empty or the step id itself. */
export function stepLabelFindings(nodes) {
  const findings = [];
  for (const node of nodes) {
    const label = node?.data?.label;
    if (typeof label !== "string" || label.trim() === "") findings.push({ id: node?.id, label: label ?? null, message: "has no label" });
    else if (normalize(label) === normalize(node.id)) findings.push({ id: node.id, label, message: "is labelled with its raw step id" });
  }
  return findings;
}

/**
 * A wiring-shaped input with one never-run node per graph.json step, one node per step in the
 * invocation form (`<step>[<mode>]`) and one per check a step names (`check:<id>`): every label
 * the page can draw, whether or not that step has run.
 */
export function everyStepWiring(graph) {
  // Each node sits in its step's own lane and stage (a check in its first step's), so lane and stage labels resolve as drawn.
  const node = (id, step, kind, at) => ({ id, step, kind, invocation: null, command: "", holder: at.holder, stage: at.layout.stage,
    state: "never-run", citation: null, changed: [], changedCount: 0, reads: 0, writes: 0, checks: [], layout: { lane: at.layout.lane, stage: at.layout.stage, rank: 0, x: 0, y: 0 } });
  const steps = graph.nodes ?? [];
  const checks = [...new Set(steps.flatMap((step) => step.checks ?? []))].sort();
  return {
    schema: "clossys.pipeline-wiring/1", store: ".clossys/runs", edges: [], roster: [], seats: {}, undrawn: [],
    counts: { passed: 0, failed: 0, stale: 0, "never-run": steps.length, runs: 0 },
    layout: { constants: { nodeWidth: 240 }, lanes: [], stages: [], rounds: [] },
    nodes: [
      ...steps.map((step) => node(step.id, step.id, step.kind, step)),
      ...steps.map((step) => node(`${step.id}[--mode]`, step.id, step.kind, step)),
      ...checks.map((id) => node(`check:${id}`, `check:${id}`, "plumb", steps.find((step) => (step.checks ?? []).includes(id)))),
    ],
  };
}

/** The active wiring of the repository at `root`, from the built Producer (runs nothing, records nothing). */
export async function activeWiring(root) {
  const { buildWiring } = await import(pathToFileURL(join(root, "packages/producer/dist/pipeline/wiring.js")).href);
  return buildWiring(root);
}

/** Builds the page's flow input from `wiring` with the view code under `root`. */
export async function renderedStepNodes(root, wiring) {
  const { build } = await import("esbuild");
  const dir = mkdtempSync(join(tmpdir(), "pipeline-step-labels-"));
  try {
    const outfile = join(dir, "pipeline-flow.mjs");
    await build({
      entryPoints: [join(root, "packages/producer/studio/lib/pipeline-flow.ts")],
      outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent",
      nodePaths: [join(root, "node_modules")],
    });
    const { pipelineInputs } = await import(pathToFileURL(outfile).href);
    return pipelineInputs(wiring, { title: "Content" }, "/content").flow.graph.nodes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = { root: resolve(fileURLToPath(new URL("..", import.meta.url))), graph: null, wiring: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") args.json = true;
    else if (flag === "--root" && argv[index + 1]) args.root = resolve(argv[++index]);
    else if (flag === "--graph" && argv[index + 1]) args.graph = resolve(argv[++index]);
    else if (flag === "--wiring" && argv[index + 1]) args.wiring = resolve(argv[++index]);
    else throw new Error(`unknown argument ${flag}; usage: check-pipeline-step-labels.mjs [--root REPO] [--graph FILE] [--wiring FILE] [--json]`);
  }
  args.graph ??= join(args.root, "packages/producer/pipeline/graph.json");
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`check:pipeline-step-labels: ${error.message}`); process.exit(2); }
  const graph = JSON.parse(readFileSync(args.graph, "utf8"));
  let nodes;
  try {
    const wiring = args.wiring ? JSON.parse(readFileSync(args.wiring, "utf8")) : await activeWiring(args.root);
    nodes = [...await renderedStepNodes(args.root, wiring), ...await renderedStepNodes(args.root, everyStepWiring(graph))];
  }
  catch (error) {
    // An unresolved Writer key throws inside the view code: that is a finding, not an environment error.
    if (/Studio copy is unresolved/.test(error?.message ?? "")) {
      console.log(`FAIL ${error.message}`);
      console.log("check:pipeline-step-labels: FAIL a step label does not resolve");
      process.exit(1);
    }
    console.error(`check:pipeline-step-labels: BLOCKED ${error?.message ?? error}`);
    process.exit(2);
  }
  const findings = stepLabelFindings(nodes);
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ nodes: nodes.map((node) => ({ id: node.id, label: node.data.label })), findings }, null, 2)}\n`);
    process.exit(findings.length ? 1 : 0);
  }
  for (const finding of findings) console.log(`FAIL ${finding.id} ${finding.message}${finding.label ? ` (${JSON.stringify(finding.label)})` : ""}`);
  if (findings.length) {
    console.log(`check:pipeline-step-labels: FAIL ${findings.length} of ${nodes.length} step node(s)`);
    process.exit(1);
  }
  console.log(`check:pipeline-step-labels: PASS ${nodes.length} step node(s) titled by Writer copy`);
}
