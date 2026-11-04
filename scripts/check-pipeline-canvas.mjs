#!/usr/bin/env node
/**
 * check:pipeline-canvas: the Studio page /producer/pipeline draws packages/producer/pipeline/graph.json
 * and nothing else. It starts the built Producer (`clossys produce`), opens the page headless in the
 * Chrome already installed on this machine (playwright, never a downloaded browser) and fails unless
 *
 *   node-ids   the rendered React Flow node ids equal the graph's step ids;
 *   edge-ids   the rendered edge ids equal the graph's edges, as `from->to` (the form check:pipeline uses);
 *   flow-css   React Flow's stylesheet (pinned components.flow.canvas dist/style.css) is applied;
 *   flow-theme the generated --xy-* theme resolves to the pinned tokens (--xy-node-background-color
 *              equals --card on the canvas);
 *   page       the page renders without an uncaught error (an unresolved Writer key is one).
 *
 * `--rendered <file>` compares a recorded rendering (`{ nodes: [...], edges: [...] }`) instead of
 * opening a browser: the same comparison, for the rule fixture.
 *
 * Usage: node scripts/check-pipeline-canvas.mjs [--root CLOSSYS_DIR] [--graph FILE] [--port N]
 *        [--screenshot FILE] [--rendered FILE] [--json]
 * Exit 0 when every condition holds, 1 on any finding, 2 when Producer, Studio or a browser is missing.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const producerDir = join(repo, "packages/producer");
export const DEFAULT_PORT = 4619;
export const ROUTE = "/producer/pipeline";
export const VIEWPORT = Object.freeze({ width: 1440, height: 900 });

/** The ids a graph.json defines: step ids, and edges as `from->to`. */
export function graphIds(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error("graph.json has no nodes and edges");
  return { nodes: graph.nodes.map(node => node.id), edges: graph.edges.map(edge => `${edge.from}->${edge.to}`) };
}

/** Findings for a rendering against the graph: every id missing from, or extra in, the drawing. */
export function compareRendering(expected, rendered) {
  const findings = [];
  for (const [kind, rule] of [["nodes", "node-ids"], ["edges", "edge-ids"]]) {
    const want = new Set(expected[kind]), have = new Set(rendered[kind] ?? []);
    if (want.size !== expected[kind].length) findings.push({ rule, message: `graph.json repeats a ${kind.slice(0, -1)} id` });
    if (have.size !== (rendered[kind] ?? []).length) findings.push({ rule, message: `the page draws a ${kind.slice(0, -1)} id twice` });
    for (const id of want) if (!have.has(id)) findings.push({ rule, message: `${kind.slice(0, -1)} missing from the page: ${id}` });
    for (const id of have) if (!want.has(id)) findings.push({ rule, message: `${kind.slice(0, -1)} drawn but not in graph.json: ${id}` });
  }
  return findings;
}

function parseArgs(argv) {
  const args = { root: join(repo, "clossys"), graph: join(producerDir, "pipeline/graph.json"), port: DEFAULT_PORT, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => { const next = argv[++i]; if (next === undefined) throw new Error(`${flag} needs a value`); return next; };
    if (flag === "--root") args.root = resolve(value());
    else if (flag === "--graph") args.graph = resolve(value());
    else if (flag === "--port") args.port = Number(value());
    else if (flag === "--screenshot") args.screenshot = resolve(value());
    else if (flag === "--rendered") args.rendered = resolve(value());
    else if (flag === "--json") args.json = true;
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error("--port must be 1-65535");
  return args;
}

const envError = message => Object.assign(new Error(message), { env: true });

async function startProducer({ port, root }) {
  const cli = join(producerDir, "dist/cli/index.js");
  if (!existsSync(cli)) throw envError("producer is not built: dist/cli/index.js is missing");
  if (!existsSync(join(producerDir, "dist/studio/manifest.json"))) throw envError("Studio is not built: dist/studio/manifest.json is missing");
  const child = spawn(process.execPath, [cli, "produce", "--port", String(port), "--no-open", "--root", root], { stdio: ["ignore", "pipe", "pipe"] });
  const output = [];
  child.stdout.on("data", chunk => output.push(String(chunk)));
  child.stderr.on("data", chunk => output.push(String(chunk)));
  const origin = `http://127.0.0.1:${port}`;
  const exited = new Promise(done => child.once("exit", code => done(code)));
  const deadline = Date.now() + 180_000;
  for (;;) {
    const state = await Promise.race([exited.then(code => ({ exited: code })), fetch(`${origin}/api/health`).then(r => r.json()).catch(() => undefined)]);
    if (state?.exited !== undefined) throw envError(`producer exited (${state.exited}) before ready: ${output.join("").slice(-800)}`);
    if (state?.studio === "ready") break;
    if (Date.now() > deadline) { child.kill("SIGTERM"); throw envError("producer did not report ready within 180s"); }
    await new Promise(next => setTimeout(next, 250));
  }
  return {
    origin,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

/** Open the page and read what React Flow drew, after the node and edge counts settle. */
async function renderPage({ origin, expected, screenshot }) {
  const require = createRequire(join(producerDir, "package.json"));
  const { launchChrome } = require("./studio/checks/chrome-launch.cjs");
  let browser;
  try { browser = await launchChrome({}, { playwright: require("playwright") }); }
  catch (error) { throw envError(error instanceof Error ? error.message : String(error)); }
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    const response = await page.goto(`${origin}${ROUTE}`, { waitUntil: "networkidle", timeout: 60_000 });
    const status = response?.status() ?? 0;
    const read = () => page.evaluate(() => {
      const ids = prefix => [...document.querySelectorAll(`[data-testid^="${prefix}"]`)].map(element => element.getAttribute("data-testid").slice(prefix.length));
      const canvas = document.querySelector(".react-flow");
      const node = document.querySelector(".react-flow__node");
      const style = canvas ? getComputedStyle(canvas) : undefined;
      return {
        nodes: ids("rf__node-"), edges: ids("rf__edge-"),
        nodePosition: node ? getComputedStyle(node).position : undefined,
        xyNodeBackground: style?.getPropertyValue("--xy-node-background-color").trim(),
        card: style?.getPropertyValue("--card").trim(),
      };
    });
    // React Flow draws edges once their handles are measured: wait for the full graph or a stable count.
    let drawn = await read(), stable = 0;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !(drawn.nodes.length >= expected.nodes.length && drawn.edges.length >= expected.edges.length)) {
      await page.waitForTimeout(250);
      const next = await read();
      stable = next.nodes.length === drawn.nodes.length && next.edges.length === drawn.edges.length ? stable + 1 : 0;
      drawn = next;
      if (stable >= 12 && drawn.nodes.length > 0) break;
    }
    if (screenshot) { mkdirSync(dirname(screenshot), { recursive: true }); await page.screenshot({ path: screenshot }); }
    return { status, errors, ...drawn };
  } finally {
    await browser.close();
  }
}

export async function checkPipelineCanvas(args) {
  const expected = graphIds(JSON.parse(readFileSync(args.graph, "utf8")));
  if (args.rendered) {
    const rendered = JSON.parse(readFileSync(args.rendered, "utf8"));
    return { expected, rendered, findings: compareRendering(expected, rendered) };
  }
  const producer = await startProducer(args);
  try {
    const rendered = await renderPage({ origin: producer.origin, expected, screenshot: args.screenshot });
    const findings = [];
    if (rendered.status !== 200) findings.push({ rule: "page", message: `${ROUTE} answered ${rendered.status}` });
    for (const error of rendered.errors) findings.push({ rule: "page", message: error.split("\n")[0] });
    findings.push(...compareRendering(expected, rendered));
    if (rendered.nodes.length && rendered.nodePosition !== "absolute") findings.push({ rule: "flow-css", message: `React Flow's stylesheet is not applied (.react-flow__node is position ${rendered.nodePosition})` });
    if (rendered.nodes.length && (!rendered.xyNodeBackground || rendered.xyNodeBackground !== rendered.card)) findings.push({ rule: "flow-theme", message: `--xy-node-background-color (${rendered.xyNodeBackground || "unset"}) is not the pinned --card (${rendered.card || "unset"})` });
    return { expected, rendered, findings };
  } finally {
    await producer.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`check:pipeline-canvas: ${error.message}`); process.exit(2); }
  try {
    const result = await checkPipelineCanvas(args);
    if (args.json) writeFileSync(1, `${JSON.stringify(result, null, 2)}\n`);
    for (const finding of result.findings) console.log(`FAIL ${finding.rule}: ${finding.message}`);
    const drawn = `${result.rendered.nodes?.length ?? 0}/${result.expected.nodes.length} nodes, ${result.rendered.edges?.length ?? 0}/${result.expected.edges.length} edges`;
    if (result.findings.length) { console.log(`check:pipeline-canvas: FAIL (${result.findings.length}) ${drawn}`); process.exit(1); }
    console.log(`check:pipeline-canvas: PASS ${drawn}${args.screenshot ? `; screenshot ${args.screenshot}` : ""}`);
  } catch (error) {
    console.error(`check:pipeline-canvas: ${error.env ? "BLOCKED" : "ERROR"} ${error.message}`);
    process.exit(error.env ? 2 : 1);
  }
}
