import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const json = path => JSON.parse(readFileSync(path, "utf8"));
const run = (root, mode) => spawnSync(process.execPath, [resolve(root, "scripts/usage-graph.mjs"), mode], { cwd: root, encoding: "utf8" });

test("usage graph records the eligible shadcn default plan and composition seats", () => {
  const result = run(root, "--check");
  assert.equal(result.status, 0, result.stderr);
  const report = json(resolve(root, "src/catalog/reports/usage-graph.json"));
  assert.equal(report.basis, "shadcn@aria-default-plan");
  const fill = id => report.nodes.find(node => node.id === id)?.fill?.id;
  assert.equal(fill("components.button"), "shadcn@aria/components.button");
  assert.equal(fill("components.table"), "shadcn@aria/components.table");
  assert.equal(fill("components.file-trigger"), "shadcn@aria/components.file-trigger");
  assert.equal(fill("components.chart-area"), "foundry/components.chart-area");
  assert.ok(report.edges.some(edge => edge.from === "components.button" && edge.kind === "reads"));
  assert.ok(report.edges.some(edge => edge.from === "components.file-trigger" && edge.to === "components.button" && edge.kind === "composes" && edge.evidence.includes("declared")));
  for (const [from, to] of [["components.button", "assets.icon-chevron-right"], ["components.button", "components.icon"], ["components.table", "components.checkbox"]]) {
    assert.ok(!report.edges.some(edge => edge.from === from && edge.to === to && edge.evidence.includes("declared")), `${from} must not inherit Foundry declaration ${to}`);
  }
});

test("Designer check runs the usage graph freshness gate", () => {
  const scripts = json(resolve(root, "package.json")).scripts;
  assert.match(scripts.check ?? "", /(?:usage-graph\.mjs --check|npm run check:usage-graph)/);
  assert.match(scripts["check:usage-graph"] ?? scripts.check, /usage-graph\.mjs --check/);
});

test("check refuses an added slot until regeneration and never rewrites the stale report", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "designer-usage-graph-"));
  try {
    cpSync(resolve(root, "src"), resolve(fixture, "src"), { recursive: true });
    cpSync(resolve(root, "scripts"), resolve(fixture, "scripts"), { recursive: true });
    cpSync(resolve(root, "package.json"), resolve(fixture, "package.json"));
    symlinkSync(resolve(root, "../../node_modules"), resolve(fixture, "node_modules"), "dir");
    let result = run(fixture, "--write");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(run(fixture, "--check").status, 0);
    const reportPath = resolve(fixture, "src/catalog/reports/usage-graph.json");
    const previous = readFileSync(reportPath, "utf8");
    // A synthetic frame exercises inventory drift without changing the frozen value catalog.
    const slotsPath = resolve(fixture, "src/catalog/slots/frames.json");
    const slots = json(slotsPath);
    slots.push({ ...structuredClone(slots[0]), id: "frames.usage-graph-seed" });
    writeFileSync(slotsPath, JSON.stringify(slots));
    result = run(fixture, "--check");
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /usage-graph report is stale/);
    assert.equal(readFileSync(reportPath, "utf8"), previous);
    assert.equal(run(fixture, "--write").status, 0);
    assert.equal(run(fixture, "--check").status, 0);
    assert.ok(json(reportPath).nodes.some(node => node.id === "frames.usage-graph-seed"));
    // An owner-picked candidate that violates the live contract stays unchosen.
    const componentsPath = resolve(fixture, "src/catalog/slots/components.json");
    const components = json(componentsPath);
    components.find(slot => slot.id === "components.button").contract.allowedReads.tokens = [];
    writeFileSync(componentsPath, JSON.stringify(components));
    assert.equal(run(fixture, "--write").status, 0);
    assert.equal(json(reportPath).nodes.find(node => node.id === "components.button").fill, undefined);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
