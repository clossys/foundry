#!/usr/bin/env node
/**
 * check:pipeline-canvas: the Studio page /content (the Content overview) draws the active wiring (`clossys pipeline
 * wiring`: the steps that exist and the run records they left, served at /api/pipeline/wiring) and nothing else;
 * nothing on it is the declared graph.json. It builds dist/studio from the current source (packages/producer/scripts/build-studio.mjs, the
 * same build check:studio runs), starts the built Producer (`clossys produce`) on the single preview port
 * (packages/producer/studio/checks/studio-origin.mjs, 4503 unless --port), opens the page headless in the
 * Chrome already installed on this machine (playwright, never a downloaded browser) and fails unless
 *
 *   node-ids   the rendered React Flow node ids equal the wiring's node ids (the server's own, read from the page's
 *              origin in the same run);
 *   edge-ids   the rendered edge ids equal the wiring's observed edges (a file one run wrote and another read), as
 *              `from->to`;
 *   status     every drawn step's status badge (`data-status`) is the wiring node's state: passed, failed, stale or
 *              never-run, from its latest run record;
 *   flow-css   React Flow's stylesheet (pinned components.flow.canvas dist/style.css) is applied;
 *   flow-theme the generated --xy-* theme resolves to the pinned tokens (--xy-node-background-color
 *              equals --card on the canvas);
 *   page       the page renders without an uncaught error (an unresolved Writer key is one);
 *   layout     at the initial view in 1440x900 no two node boxes (steps and lane labels, on screen or
 *              not: the whole graph is measured, it is not expected to fit the window) intersect, each
 *              lane has exactly one label, every step sits inside its lane's swim row (from its label
 *              down to the next lane's label);
 *   flow       every edge flows forward: the source's stage is the target's stage or an earlier one, and an
 *              edge inside one stage runs left to right (its source box starts left of its target box);
 *   rank       inside one stage column a lower graph rank starts further left (rank order per stage);
 *   orphan     (a declared graph only) only a first-stage step may start the flow: every step in a later stage has
 *              an edge into it. The active wiring's edges are observations, so a step that never ran, or whose run
 *              read no file another run wrote, has none; edge-ids compares them instead;
 *   stage      each stage has exactly one header, and every step sits inside its stage's column (from its
 *              header across to the next stage's header); when graph.json groups the stages in rounds,
 *              each round has exactly one header, above its stages' headers, and every stage header sits
 *              inside its round's span (from the round's header across to the next round's header);
 *   roster     the drawn lane rows, top to bottom, equal graph.json's roster in order, plus `unassigned`
 *              while any step's lane is `unassigned` (lanes are the roster, never a hand list);
 *   readable   at the initial view every step title renders at READABLE_PX (12px) or more: its computed
 *              font size times the React Flow viewport scale;
 *   fill       the canvas reaches the bottom of the 1440x900 window (it fills the remaining content
 *              height) and sits fully inside it;
 *   legend     the pipeline legend is fully inside the 1440x900 viewport without scrolling;
 *   contain    every step's kind badge and title lie inside that step's node box (none overflows
 *              the card at any title length);
 *   sheet      a click on a step node away from its title opens the step sheet, and Enter on the
 *              focused step node opens it too (browser runs only).
 *
 * `--rendered <file>` compares a recorded rendering (`{ nodes: [...], edges: [...] }`, optionally
 * `boxes`, `parts`, `statuses` ({ id: data-status }), `legend`, `titlePx` and `canvas`; `parts` are `{ id, part: "badge" | "title", x, y,
 * width, height }` screen boxes inside step `id`) instead of opening a browser: the same comparison, for the rule fixture.
 *
 * `--wiring <file>` (or `--graph <file>`, a declared graph of the same shape) is the expected input for a recorded
 * rendering; a browser run reads the wiring from the Producer it starts.
 *
 * Usage: node scripts/check-pipeline-canvas.mjs [--root CLOSSYS_DIR] [--wiring FILE | --graph FILE] [--port N]
 *        [--screenshot FILE] [--sheet-screenshot FILE] [--color-scheme light|dark] [--rendered FILE] [--json]
 * `--sheet-screenshot` also captures the step sheet the sheet test opened by a click on the first step;
 * `--color-scheme` emulates prefers-color-scheme for the run (default light).
 * Exit 0 when every condition holds, 1 on any finding, 2 when Producer, Studio or a browser is missing.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { studioPort } from "../packages/producer/studio/checks/studio-origin.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const producerDir = join(repo, "packages/producer");
/** The single preview port; a check never carries a port of its own. */
export const DEFAULT_PORT = studioPort({});
export const ROUTE = "/content";
export const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
/** The smallest on-screen step title size at the initial view, in CSS pixels. */
export const READABLE_PX = 12;
/** How far above the window's bottom edge the canvas may stop and still count as filling it (frame padding). */
export const FILL_SLACK_PX = 48;

export const WIRING_SCHEMA = "clossys.pipeline-wiring/1";
/** The active wiring's node states (packages/producer/src/pipeline/wiring.ts RUN_STATES). */
export const RUN_STATES = Object.freeze(["passed", "failed", "stale", "never-run"]);
const isWiring = input => input?.schema === WIRING_SCHEMA;

/** The ids an input defines: node ids, and edges as `from->to`. */
export function graphIds(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error("the wiring has no nodes and edges");
  return { nodes: graph.nodes.map(node => node.id), edges: graph.edges.map(edge => `${edge.from}->${edge.to}`) };
}

/** Findings for the drawn status badges against the wiring: every node shows its latest run's state, and only a run state. */
export function compareStatuses(wiring, statuses) {
  const findings = [];
  if (!isWiring(wiring) || statuses === undefined) return findings;
  for (const node of wiring.nodes) {
    if (!RUN_STATES.includes(node.state)) findings.push({ rule: "status", message: `wiring node ${node.id} has state ${node.state}, not a run state` });
    if (node.state !== "never-run" && !node.citation) findings.push({ rule: "status", message: `wiring node ${node.id} shows ${node.state} without citing a run record` });
    const drawn = statuses?.[node.id];
    if (drawn === undefined) findings.push({ rule: "status", message: `step ${node.id} draws no status badge` });
    else if (drawn !== node.state) findings.push({ rule: "status", message: `step ${node.id} shows ${drawn}, but its latest run record says ${node.state}` });
  }
  return findings;
}

/** Findings for a rendering against the graph: every id missing from, or extra in, the drawing. */
export function compareRendering(expected, rendered) {
  const findings = [];
  for (const [kind, rule] of [["nodes", "node-ids"], ["edges", "edge-ids"]]) {
    const want = new Set(expected[kind]), have = new Set(rendered[kind] ?? []);
    if (want.size !== expected[kind].length) findings.push({ rule, message: `the wiring repeats a ${kind.slice(0, -1)} id` });
    if (have.size !== (rendered[kind] ?? []).length) findings.push({ rule, message: `the page draws a ${kind.slice(0, -1)} id twice` });
    for (const id of want) if (!have.has(id)) findings.push({ rule, message: `${kind.slice(0, -1)} missing from the page: ${id}` });
    for (const id of have) if (!want.has(id)) findings.push({ rule, message: `${kind.slice(0, -1)} drawn but not in the wiring: ${id}` });
  }
  return findings;
}

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** A part lies inside a box (half a pixel of subpixel rounding allowed). */
const inside = (part, box) => part.x >= box.x - 0.5 && part.y >= box.y - 0.5 && part.x + part.width <= box.x + box.width + 0.5 && part.y + part.height <= box.y + box.height + 0.5;

/**
 * Findings for the drawn geometry against graph.json. `boxes` are screen boxes
 * (`{ id, kind: "step" | "lane" | "stage" | "round", x, y, width, height }`; a lane, stage or round box's id
 * is its lane, stage or round id) and `legend`
 * the legend's screen box; `viewport` is the window it must fit. Runs only on what was recorded.
 */
export function checkGeometry(graph, rendered, viewport = VIEWPORT) {
  const findings = [];
  const boxes = rendered.boxes;
  const nodeOf = new Map((graph.nodes ?? []).map(node => [node.id, node]));
  const stageIndex = new Map((graph.layout?.stages ?? []).map(stage => [stage.id, stage.index]));
  const first = [...stageIndex].sort((a, b) => a[1] - b[1])[0]?.[0];
  // R-a (data half): every edge flows forward, never into an earlier stage.
  for (const edge of graph.edges ?? []) {
    const from = stageIndex.get(nodeOf.get(edge.from)?.layout?.stage), to = stageIndex.get(nodeOf.get(edge.to)?.layout?.stage);
    if (from !== undefined && to !== undefined && from > to) findings.push({ rule: "flow", message: `edge ${edge.from}->${edge.to} runs backward: ${edge.from} (${nodeOf.get(edge.from).layout.stage}) feeds ${edge.to} (${nodeOf.get(edge.to).layout.stage})` });
  }
  // R-c: only a first-stage step may start the flow; every later step has an edge into it. A declared
  // graph only: the wiring's edges are what runs read and wrote, compared by edge-ids.
  const fed = new Set((graph.edges ?? []).map(edge => edge.to));
  for (const node of isWiring(graph) ? [] : graph.nodes ?? []) {
    const stage = node.layout?.stage;
    if (stage !== undefined && stageIndex.has(stage) && stage !== first && !fed.has(node.id)) findings.push({ rule: "orphan", message: `step ${node.id} (${stage}) has no edge into it, so it starts the flow outside ${first}` });
  }
  if (Array.isArray(boxes)) {
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      if (intersects(boxes[i], boxes[j])) findings.push({ rule: "layout", message: `${boxes[i].kind} ${boxes[i].id} intersects ${boxes[j].kind} ${boxes[j].id}` });
    }
    const lanes = (graph.layout?.lanes ?? []).slice().sort((a, b) => a.index - b.index);
    const labels = new Map();
    for (const box of boxes.filter(box => box.kind === "lane")) {
      if (labels.has(box.id)) findings.push({ rule: "layout", message: `lane ${box.id} is labelled more than once` });
      labels.set(box.id, box);
    }
    for (const lane of lanes) if (!labels.has(lane.id)) findings.push({ rule: "layout", message: `lane ${lane.id} has no label` });
    for (const id of labels.keys()) if (!lanes.some(lane => lane.id === id)) findings.push({ rule: "layout", message: `lane label ${id} is not a graph.json lane` });
    const steps = new Map(boxes.filter(box => box.kind === "step").map(box => [box.id, box]));
    for (const node of graph.nodes ?? []) {
      const box = steps.get(node.id), at = lanes.findIndex(lane => lane.id === node.layout?.lane);
      const top = labels.get(lanes[at]?.id), next = labels.get(lanes[at + 1]?.id);
      if (!box || !top) continue;
      if (box.y < top.y || (next && box.y + box.height > next.y)) findings.push({ rule: "layout", message: `step ${node.id} is outside the ${node.layout.lane} swim row` });
    }
    const stages = (graph.layout?.stages ?? []).slice().sort((a, b) => a.index - b.index);
    const headers = new Map();
    for (const box of boxes.filter(box => box.kind === "stage")) {
      if (headers.has(box.id)) findings.push({ rule: "stage", message: `stage ${box.id} has more than one header` });
      headers.set(box.id, box);
    }
    if (!stages.length) findings.push({ rule: "stage", message: "graph.json lays out no stage columns" });
    for (const stage of stages) if (!headers.has(stage.id)) findings.push({ rule: "stage", message: `stage ${stage.id} has no header` });
    for (const id of headers.keys()) if (!stages.some(stage => stage.id === id)) findings.push({ rule: "stage", message: `stage header ${id} is not a graph.json stage` });
    for (const node of graph.nodes ?? []) {
      const box = steps.get(node.id), at = stages.findIndex(stage => stage.id === node.layout?.stage);
      const start = headers.get(stages[at]?.id), next = headers.get(stages[at + 1]?.id);
      if (!box) continue;
      if (at < 0) { findings.push({ rule: "stage", message: `step ${node.id} has no stage column (layout.stage ${node.layout?.stage ?? "unset"})` }); continue; }
      if (!start) continue;
      if (box.x < start.x - 0.5 || (next && box.x + box.width > next.x + 0.5)) findings.push({ rule: "stage", message: `step ${node.id} is outside the ${node.layout.stage} stage column` });
    }
    // Rounds group the stage columns: one header each, above and spanning its stages' headers.
    const rounds = Array.isArray(graph.layout?.rounds) ? graph.layout.rounds.slice().sort((a, b) => a.index - b.index) : undefined;
    if (!rounds && stages.some(stage => stage.round !== undefined)) findings.push({ rule: "stage", message: "graph.json stages name rounds but it lays out no rounds" });
    if (rounds) {
      const roundHeaders = new Map();
      for (const box of boxes.filter(box => box.kind === "round")) {
        if (roundHeaders.has(box.id)) findings.push({ rule: "stage", message: `round ${box.id} has more than one header` });
        roundHeaders.set(box.id, box);
      }
      for (const round of rounds) if (!roundHeaders.has(round.id)) findings.push({ rule: "stage", message: `round ${round.id} has no header` });
      for (const id of roundHeaders.keys()) if (!rounds.some(round => round.id === id)) findings.push({ rule: "stage", message: `round header ${id} is not a graph.json round` });
      for (const stage of stages) {
        const header = headers.get(stage.id);
        if (!header) continue;
        const at = rounds.findIndex(round => (round.stages ?? []).includes(stage.id));
        if (at < 0) { findings.push({ rule: "stage", message: `stage ${stage.id} is in no graph.json round` }); continue; }
        const start = roundHeaders.get(rounds[at].id), next = roundHeaders.get(rounds[at + 1]?.id);
        if (!start) continue;
        if (!(start.y + start.height <= header.y + 0.5)) findings.push({ rule: "stage", message: `round ${rounds[at].id}'s header is not above stage ${stage.id}'s header` });
        if (header.x < start.x - 0.5 || (next && header.x + header.width > next.x + 0.5)) findings.push({ rule: "stage", message: `stage ${stage.id}'s header is outside the ${rounds[at].id} round` });
      }
    }
    const roster = Array.isArray(graph.roster) ? graph.roster.map(entry => entry.id) : undefined;
    if (!roster) findings.push({ rule: "roster", message: "graph.json has no roster, so the lanes are not derived from it" });
    else {
      const want = [...roster, ...((graph.nodes ?? []).some(node => node.layout?.lane === "unassigned") ? ["unassigned"] : [])];
      const declared = lanes.map(lane => lane.id), drawn = [...labels.values()].sort((a, b) => a.y - b.y).map(box => box.id);
      if (declared.join(",") !== want.join(",")) findings.push({ rule: "roster", message: `graph.json lanes (${declared.join(", ")}) are not the roster (${want.join(", ")})` });
      if (drawn.join(",") !== want.join(",")) findings.push({ rule: "roster", message: `the drawn lane rows (${drawn.join(", ")}) are not the roster (${want.join(", ")})` });
    }
    // R-a (drawn half): an edge inside one stage runs left to right.
    for (const edge of graph.edges ?? []) {
      const a = nodeOf.get(edge.from), b = nodeOf.get(edge.to), boxA = steps.get(edge.from), boxB = steps.get(edge.to);
      if (a && b && boxA && boxB && a.layout?.stage === b.layout?.stage && !(boxA.x < boxB.x)) findings.push({ rule: "flow", message: `edge ${edge.from}->${edge.to} inside the ${a.layout.stage} stage does not run left to right (${edge.from} is not left of ${edge.to})` });
    }
    // R-b: inside one stage column, a lower rank sits further left.
    for (const a of graph.nodes ?? []) for (const b of graph.nodes ?? []) {
      const boxA = steps.get(a.id), boxB = steps.get(b.id);
      if (boxA && boxB && a.layout?.stage === b.layout?.stage && a.layout?.rank < b.layout?.rank && !(boxA.x < boxB.x)) findings.push({ rule: "rank", message: `in the ${a.layout.stage} stage, step ${a.id} (rank ${a.layout.rank}) is not left of ${b.id} (rank ${b.layout.rank})` });
    }
  }
  if (rendered.titlePx !== undefined) {
    if (!(rendered.titlePx >= READABLE_PX)) findings.push({ rule: "readable", message: `the smallest step title renders at ${Number(rendered.titlePx).toFixed(2)}px at the initial view, under ${READABLE_PX}px` });
  }
  const canvas = rendered.canvas;
  if (canvas !== undefined) {
    if (!canvas || canvas.x < 0 || canvas.y < 0 || canvas.x + canvas.width > viewport.width || canvas.y + canvas.height > viewport.height) findings.push({ rule: "fill", message: canvas ? `the canvas (${Math.round(canvas.y)}-${Math.round(canvas.y + canvas.height)}px) is not inside the ${viewport.width}x${viewport.height} viewport` : "the canvas is not on the page" });
    else if (canvas.y + canvas.height < viewport.height - FILL_SLACK_PX) findings.push({ rule: "fill", message: `the canvas stops at ${Math.round(canvas.y + canvas.height)}px, more than ${FILL_SLACK_PX}px above the ${viewport.height}px window bottom` });
  }
  if (Array.isArray(rendered.parts)) {
    const steps = new Map((rendered.boxes ?? []).filter(box => box.kind === "step").map(box => [box.id, box]));
    for (const part of rendered.parts) {
      const node = steps.get(part.id);
      if (!node) findings.push({ rule: "contain", message: `the ${part.part} of ${part.id} has no step node box` });
      else if (!inside(part, node)) findings.push({ rule: "contain", message: `the ${part.part} of step ${part.id} (${Math.round(part.x)},${Math.round(part.y)} ${Math.round(part.width)}x${Math.round(part.height)}) overflows its node (${Math.round(node.x)},${Math.round(node.y)} ${Math.round(node.width)}x${Math.round(node.height)})` });
    }
    for (const id of steps.keys()) if (!rendered.parts.some(part => part.id === id && part.part === "badge")) findings.push({ rule: "contain", message: `step ${id} draws no kind badge` });
  }
  if (rendered.sheet !== undefined) {
    if (!rendered.sheet?.click) findings.push({ rule: "sheet", message: `a click on a step node away from its title does not open the step sheet${rendered.sheet?.clickError ? ` (the click did not land: ${rendered.sheet.clickError})` : ""}` });
    if (!rendered.sheet?.enter) findings.push({ rule: "sheet", message: "Enter on the focused step node does not open the step sheet" });
  }
  const legend = rendered.legend;
  if (legend !== undefined && (!legend || legend.x < 0 || legend.y < 0 || legend.x + legend.width > viewport.width || legend.y + legend.height > viewport.height)) {
    findings.push({ rule: "legend", message: legend ? `the legend (${Math.round(legend.y)}-${Math.round(legend.y + legend.height)}px) is not inside the ${viewport.width}x${viewport.height} viewport` : "the legend is not on the page" });
  }
  return findings;
}

function parseArgs(argv) {
  const args = { root: join(repo, "clossys"), port: DEFAULT_PORT, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => { const next = argv[++i]; if (next === undefined) throw new Error(`${flag} needs a value`); return next; };
    if (flag === "--root") args.root = resolve(value());
    else if (flag === "--graph" || flag === "--wiring") args.graph = resolve(value());
    else if (flag === "--port") args.port = Number(value());
    else if (flag === "--screenshot") args.screenshot = resolve(value());
    else if (flag === "--sheet-screenshot") args.sheetScreenshot = resolve(value());
    else if (flag === "--color-scheme") args.colorScheme = value();
    else if (flag === "--rendered") args.rendered = resolve(value());
    else if (flag === "--json") args.json = true;
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (args.colorScheme !== undefined && !["light", "dark"].includes(args.colorScheme)) throw new Error("--color-scheme must be light or dark");
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error("--port must be 1-65535");
  if (args.rendered && !args.graph) throw new Error("--rendered needs the expected --wiring (or --graph) file");
  return args;
}

const envError = message => Object.assign(new Error(message), { env: true });

async function startProducer({ port, root }) {
  const cli = join(producerDir, "dist/cli/index.js");
  if (!existsSync(cli)) throw envError("producer is not built: dist/cli/index.js is missing");
  // Measure the current source, never a stale or missing dist/studio: the root `build` does not build the Studio.
  const build = spawnSync(process.execPath, [join(producerDir, "scripts/build-studio.mjs")], { cwd: producerDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  if (build.status !== 0) throw envError(`scripts/build-studio.mjs exited ${build.status}: ${`${build.stdout}\n${build.stderr}`.trim().split("\n").slice(-10).join(" / ")}`);
  if (!existsSync(join(producerDir, "dist/studio/manifest.json"))) throw envError("Studio is not built: dist/studio/manifest.json is missing after scripts/build-studio.mjs");
  const serving = await fetch(`http://127.0.0.1:${port}/api/health`).then(() => true, () => false);
  if (serving) throw envError(`port ${port} is already serving; stop it or pass --port`);
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
async function renderPage({ origin, expected, screenshot, sheetScreenshot, colorScheme = "light" }) {
  const require = createRequire(join(producerDir, "package.json"));
  const { launchChrome } = require("./studio/checks/chrome-launch.cjs");
  let browser;
  try { browser = await launchChrome({}, { playwright: require("playwright") }); }
  catch (error) { throw envError(error instanceof Error ? error.message : String(error)); }
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, colorScheme });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    const response = await page.goto(`${origin}${ROUTE}`, { waitUntil: "networkidle", timeout: 60_000 });
    const status = response?.status() ?? 0;
    const read = () => page.evaluate(() => {
      const ids = (selector, prefix) => [...document.querySelectorAll(selector)].map(element => element.getAttribute("data-testid").slice(prefix.length));
      const canvas = document.querySelector(".react-flow");
      const node = document.querySelector(".react-flow__node");
      const style = canvas ? getComputedStyle(canvas) : undefined;
      const box = element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
      const legend = document.querySelector('[data-clossys-slot="sections.producer.pipeline-legend"]');
      // The viewport transform is translate(x, y) scale(k); a title's on-screen size is its font size times k.
      const transform = document.querySelector(".react-flow__viewport");
      const scale = transform ? new DOMMatrixReadOnly(getComputedStyle(transform).transform).a : NaN;
      const titles = [...document.querySelectorAll('.react-flow__node-step [data-slot="item-title"]')];
      const titlePx = titles.length ? Math.min(...titles.map(title => parseFloat(getComputedStyle(title).fontSize) * scale)) : null;
      return {
        nodes: ids('.react-flow__node-step[data-testid^="rf__node-"]', "rf__node-"), edges: ids('[data-testid^="rf__edge-"]', "rf__edge-"),
        statuses: Object.fromEntries([...document.querySelectorAll('.react-flow__node-step[data-testid^="rf__node-"]')].map(element => [element.getAttribute("data-testid").slice("rf__node-".length), element.querySelector('[data-slot="badge"][data-status]')?.getAttribute("data-status")]).filter(([, status]) => status)),
        boxes: [...document.querySelectorAll('.react-flow__node[data-testid^="rf__node-"]')].map(element => {
          const id = element.getAttribute("data-testid").slice("rf__node-".length);
          const kind = element.classList.contains("react-flow__node-lane") ? "lane" : element.classList.contains("react-flow__node-stage") ? "stage" : element.classList.contains("react-flow__node-round") ? "round" : "step";
          return { id: kind === "step" ? id : id.replace(/^(lane|stage|round):/, ""), kind, ...box(element) };
        }),
        parts: [...document.querySelectorAll('.react-flow__node-step[data-testid^="rf__node-"]')].flatMap(element => {
          const id = element.getAttribute("data-testid").slice("rf__node-".length);
          return [...element.querySelectorAll('[data-slot="badge"]')].map(part => ({ id, part: "badge", ...box(part) }))
            .concat([...element.querySelectorAll('[data-slot="item-title"]')].map(part => ({ id, part: "title", ...box(part) })));
        }),
        legend: legend ? box(legend) : null,
        canvas: canvas ? box(canvas) : null,
        titlePx,
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
    // Let the measured nodes and the initial viewport transform settle before measuring boxes.
    await page.waitForTimeout(500);
    drawn = await read();
    if (screenshot) { mkdirSync(dirname(screenshot), { recursive: true }); await page.screenshot({ path: screenshot }); }
    // The sheet test: Enter on the focused first step, then a click near the step's bottom edge (away from its title).
    const sheet = { enter: false, click: false };
    const dialog = page.locator('[role="dialog"]').first();
    const opens = async () => dialog.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false);
    const step = page.locator('.react-flow__node-step').first();
    if (drawn.nodes.length) {
      await step.focus();
      await page.keyboard.press("Enter");
      sheet.enter = await opens();
      if (sheet.enter) { await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {}); }
      const size = await step.boundingBox();
      // A click another element intercepts (the step lies outside the drawn canvas) is the sheet finding, not a crash.
      const clicked = size ? await step.click({ position: { x: size.width / 2, y: size.height - 6 }, timeout: 10_000 }).then(() => true, error => { sheet.clickError = String(error?.message ?? error).split("\n")[0]; return false; }) : false;
      sheet.click = clicked && await opens();
      if (sheet.click && sheetScreenshot) {
        await page.waitForTimeout(500);
        mkdirSync(dirname(sheetScreenshot), { recursive: true });
        await page.screenshot({ path: sheetScreenshot });
      }
    }
    return { status, errors, ...drawn, sheet };
  } finally {
    await browser.close();
  }
}

export async function checkPipelineCanvas(args) {
  if (args.rendered) {
    const graph = JSON.parse(readFileSync(args.graph, "utf8"));
    const expected = graphIds(graph);
    const rendered = JSON.parse(readFileSync(args.rendered, "utf8"));
    return { expected, rendered, findings: [...compareRendering(expected, rendered), ...compareStatuses(graph, rendered.statuses), ...checkGeometry(graph, rendered)] };
  }
  const producer = await startProducer(args);
  try {
    // The expected wiring is the one the started Producer serves the page: the same run records, read once.
    const served = await fetch(`${producer.origin}/api/pipeline/wiring`).then(response => response.json());
    if (served?.state !== "ready" || !isWiring(served.wiring)) throw envError("/api/pipeline/wiring did not answer a clossys.pipeline-wiring/1 wiring");
    const graph = served.wiring;
    const expected = graphIds(graph);
    const rendered = await renderPage({ origin: producer.origin, expected, screenshot: args.screenshot, sheetScreenshot: args.sheetScreenshot, colorScheme: args.colorScheme });
    const findings = [];
    if (rendered.status !== 200) findings.push({ rule: "page", message: `${ROUTE} answered ${rendered.status}` });
    for (const error of rendered.errors) findings.push({ rule: "page", message: error.split("\n")[0] });
    findings.push(...compareRendering(expected, rendered));
    findings.push(...compareStatuses(graph, rendered.statuses));
    if (rendered.nodes.length && rendered.nodePosition !== "absolute") findings.push({ rule: "flow-css", message: `React Flow's stylesheet is not applied (.react-flow__node is position ${rendered.nodePosition})` });
    findings.push(...checkGeometry(graph, rendered));
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
    console.log(`check:pipeline-canvas: PASS ${drawn}, smallest title ${Number(result.rendered.titlePx ?? NaN).toFixed(2)}px${args.screenshot ? `; screenshot ${args.screenshot}` : ""}${args.sheetScreenshot ? `; sheet ${args.sheetScreenshot}` : ""}`);
  } catch (error) {
    console.error(`check:pipeline-canvas: ${error.env ? "BLOCKED" : "ERROR"} ${error.message}`);
    process.exit(error.env ? 2 : 1);
  }
}
