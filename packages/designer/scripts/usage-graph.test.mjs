import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    components.find(slot => slot.id === "components.button").contract.allowedReads.themes = [];
    writeFileSync(componentsPath, JSON.stringify(components));
    assert.equal(run(fixture, "--write").status, 0);
    assert.equal(json(reportPath).nodes.find(node => node.id === "components.button").fill, undefined);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

const surfaceDescriptors = root => {
  const directory = resolve(root, "src/catalog/fills/foundry");
  return readdirSync(directory).filter(name => /^(?:sections|frames)\.(?!coverage\.)[^/]+\.json$/.test(name)).sort().map(name => {
    const doc = json(resolve(directory, name)), meta = doc.$extensions["com.clossys.fill"];
    return { meta, body: Object.values(doc[meta.slot.split(".")[0]])[0] };
  });
};

test("current surface descriptors select all measured surfaces and retain their evidence", () => {
  const report = json(resolve(root, "src/catalog/reports/usage-graph.json"));
  const descriptors = surfaceDescriptors(root);
  assert.equal(descriptors.length, 63);
  for (const { meta } of descriptors) {
    const node = report.nodes.find(node => node.id === meta.slot);
    assert.equal(node?.fill?.id, meta.id, meta.slot);
    assert.equal(node.scan, "lower-bound", meta.slot);
  }
  for (const [from, to] of [["frames.site-shell", "assets.js"], ["sections.features", "assets.icon-*"], ["sections.pagination", "assets.icon-*"], ["sections.status-list", "assets.icon-*"], ["frames.app-shell", "frames.inspector"]]) {
    assert.ok(!report.edges.some(edge => edge.from === from && edge.to === to), `${from} -> ${to}`);
  }
  for (const to of ["assets.icon-chevron-left", "assets.icon-chevron-right"]) {
    assert.ok(report.edges.some(edge => edge.from === "sections.pagination" && edge.to === to && edge.evidence.includes("declared") && edge.evidence.includes("scanned")));
  }
  assert.deepEqual(report.findings.filter(finding => /^(?:sections|frames)\./.test(finding.subject) && ["dangling-endpoint", "unselected-endpoint"].includes(finding.code)), []);
  assert.equal(report.surfaceEvidence.measurement, "source-only lower-bound");
  assert.equal(report.surfaceEvidence.runtime, "unmeasured");
  assert.deepEqual(report.surfaceEvidence.fills, descriptors.map(({ meta, body }) => ({ id: meta.id, slot: meta.slot, pin: meta.pin, ...body.consumption })));
  const unresolved = report.surfaceEvidence.fills.flatMap(fill => fill.unresolved ?? []);
  assert.equal(unresolved.filter(row => row.code === "DF2").length, 146);
  assert.equal(unresolved.filter(row => row.code === "DF5").length, 39);
  const site = report.surfaceEvidence.fills.find(fill => fill.slot === "frames.site-shell");
  assert.deepEqual(site.scannedReads.assets, []);
  assert.deepEqual(site.rawScannedReads.assets, ["assets.js"]);
  assert.equal(site.privateInternalReads.length, 1);
  assert.ok(site.privateInternalReads.every(row => row.target === "packages/designer/src/frames/site-frame/landing/internal/assets.ts" && row.targetSha256.length === 64));
  for (const from of ["sections.activity-feed", "sections.resource-list", "sections.usage"]) {
    assert.ok(report.edges.some(edge => edge.from === from && edge.to === "sections.empty-state" && edge.kind === "composes" && edge.evidence.includes("scanned")), from);
  }
});

test("actual descriptor and measured references remain strict while contract permissions add no usage", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "designer-usage-graph-references-"));
  try {
    cpSync(resolve(root, "src"), resolve(fixture, "src"), { recursive: true });
    cpSync(resolve(root, "scripts"), resolve(fixture, "scripts"), { recursive: true });
    cpSync(resolve(root, "package.json"), resolve(fixture, "package.json"));
    symlinkSync(resolve(root, "../../node_modules"), resolve(fixture, "node_modules"), "dir");
    const path = resolve(fixture, "src/catalog/fills/foundry/sections.features.json"), doc = json(path), body = doc.sections.features;
    body.reads.assets.push("assets.usage-graph-declared-unknown", "assets.usage-graph-actual-*");
    body.consumption.scannedReads.assets.push("assets.usage-graph-scanned-unknown");
    body.composes.push("frames.inspector");
    writeFileSync(path, JSON.stringify(doc));
    rmSync(resolve(fixture, "src/catalog/fills/foundry/frames.inspector.json"));
    const slotsPath = resolve(fixture, "src/catalog/slots/sections.json"), slots = json(slotsPath);
    slots.find(slot => slot.id === "sections.features").contract.allowedReads.assets.push("assets.usage-graph-permission-*");
    writeFileSync(slotsPath, JSON.stringify(slots));
    const result = run(fixture, "--write");
    assert.equal(result.status, 0, result.stderr);
    const report = json(resolve(fixture, "src/catalog/reports/usage-graph.json"));
    for (const [target, evidence] of [["assets.usage-graph-declared-unknown", "declared"], ["assets.usage-graph-scanned-unknown", "scanned"], ["assets.usage-graph-actual-*", "declared"]]) {
      assert.ok(report.edges.some(edge => edge.from === "sections.features" && edge.to === target && edge.evidence.includes(evidence)), target);
      assert.ok(report.findings.some(finding => finding.code === "dangling-endpoint" && finding.subject === "sections.features" && finding.target === target), target);
    }
    assert.ok(report.findings.some(finding => finding.code === "unselected-endpoint" && finding.subject === "sections.features" && finding.target === "frames.inspector"));
    assert.ok(!report.edges.some(edge => edge.from === "sections.features" && edge.to === "assets.usage-graph-permission-*"));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
