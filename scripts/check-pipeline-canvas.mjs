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
 *   page       the page renders without an uncaught error (an unresolved Writer key is one);
 *   layout     at the initial view in 1440x900 no two node boxes (steps and lane labels, on screen or
 *              not: the whole graph is measured, it is not expected to fit the window) intersect, each
 *              lane has exactly one label, every step sits inside its lane's swim row (from its label
 *              down to the next lane's label) and ranks run left to right (a lower rank starts further left);
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
 * `boxes`, `parts`, `legend`, `titlePx` and `canvas`; `parts` are `{ id, part: "badge" | "title", x, y,
 * width, height }` screen boxes inside step `id`) instead of opening a browser: the same comparison, for the rule fixture.
 *
 * Usage: node scripts/check-pipeline-canvas.mjs [--root CLOSSYS_DIR] [--graph FILE] [--port N]
 *        [--screenshot FILE] [--sheet-screenshot FILE] [--color-scheme light|dark] [--rendered FILE] [--json]
 * `--sheet-screenshot` also captures the step sheet the sheet test opened by a click on the first step;
 * `--color-scheme` emulates prefers-color-scheme for the run (default light).
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
/** The smallest on-screen step title size at the initial view, in CSS pixels. */
export const READABLE_PX = 12;
/** How far above the window's bottom edge the canvas may stop and still count as filling it (frame padding). */
export const FILL_SLACK_PX = 48;

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

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** A part lies inside a box (half a pixel of subpixel rounding allowed). */
const inside = (part, box) => part.x >= box.x - 0.5 && part.y >= box.y - 0.5 && part.x + part.width <= box.x + box.width + 0.5 && part.y + part.height <= box.y + box.height + 0.5;

/**
 * Findings for the drawn geometry against graph.json. `boxes` are screen boxes
 * (`{ id, kind: "step" | "lane", x, y, width, height }`; a lane box's id is its lane id) and `legend`
 * the legend's screen box; `viewport` is the window it must fit. Runs only on what was recorded.
 */
export function checkGeometry(graph, rendered, viewport = VIEWPORT) {
  const findings = [];
  const boxes = rendered.boxes;
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
    for (const a of graph.nodes ?? []) for (const b of graph.nodes ?? []) {
      const boxA = steps.get(a.id), boxB = steps.get(b.id);
      if (boxA && boxB && a.layout?.rank < b.layout?.rank && !(boxA.x < boxB.x)) findings.push({ rule: "layout", message: `step ${a.id} (rank ${a.layout.rank}) is not left of ${b.id} (rank ${b.layout.rank})` });
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
    if (!rendered.sheet?.click) findings.push({ rule: "sheet", message: "a click on a step node away from its title does not open the step sheet" });
    if (!rendered.sheet?.enter) findings.push({ rule: "sheet", message: "Enter on the focused step node does not open the step sheet" });
  }
  const legend = rendered.legend;
  if (legend !== undefined && (!legend || legend.x < 0 || legend.y < 0 || legend.x + legend.width > viewport.width || legend.y + legend.height > viewport.height)) {
    findings.push({ rule: "legend", message: legend ? `the legend (${Math.round(legend.y)}-${Math.round(legend.y + legend.height)}px) is not inside the ${viewport.width}x${viewport.height} viewport` : "the legend is not on the page" });
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
    else if (flag === "--sheet-screenshot") args.sheetScreenshot = resolve(value());
    else if (flag === "--color-scheme") args.colorScheme = value();
    else if (flag === "--rendered") args.rendered = resolve(value());
    else if (flag === "--json") args.json = true;
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (args.colorScheme !== undefined && !["light", "dark"].includes(args.colorScheme)) throw new Error("--color-scheme must be light or dark");
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
        boxes: [...document.querySelectorAll('.react-flow__node[data-testid^="rf__node-"]')].map(element => {
          const id = element.getAttribute("data-testid").slice("rf__node-".length);
          const lane = element.classList.contains("react-flow__node-lane");
          return { id: lane ? id.replace(/^lane:/, "") : id, kind: lane ? "lane" : "step", ...box(element) };
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
      if (size) await step.click({ position: { x: size.width / 2, y: size.height - 6 } });
      sheet.click = await opens();
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
  const graph = JSON.parse(readFileSync(args.graph, "utf8"));
  const expected = graphIds(graph);
  if (args.rendered) {
    const rendered = JSON.parse(readFileSync(args.rendered, "utf8"));
    return { expected, rendered, findings: [...compareRendering(expected, rendered), ...checkGeometry(graph, rendered)] };
  }
  const producer = await startProducer(args);
  try {
    const rendered = await renderPage({ origin: producer.origin, expected, screenshot: args.screenshot, sheetScreenshot: args.sheetScreenshot, colorScheme: args.colorScheme });
    const findings = [];
    if (rendered.status !== 200) findings.push({ rule: "page", message: `${ROUTE} answered ${rendered.status}` });
    for (const error of rendered.errors) findings.push({ rule: "page", message: error.split("\n")[0] });
    findings.push(...compareRendering(expected, rendered));
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
