import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderedStepNodes, stepLabelFindings } from "./check-pipeline-step-labels.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("a node titled by its raw step id is a finding, in any case or spacing", () => {
  const findings = stepLabelFindings([
    { id: "writer.check", data: { label: "writer.check" } },
    { id: "capture", data: { label: " Capture " } },
    { id: "ia", data: { label: "Shape the IA" } },
  ]);
  assert.deepEqual(findings.map((finding) => finding.id), ["writer.check", "capture"]);
});

test("a node with no label, or an empty one, is a finding", () => {
  const findings = stepLabelFindings([
    { id: "seats", data: {} },
    { id: "rules", data: { label: "   " } },
  ]);
  assert.deepEqual(findings.map((finding) => finding.message), ["has no label", "has no label"]);
});

test("every step the Content overview draws is titled by Writer copy", async () => {
  const graph = JSON.parse(readFileSync(join(root, "packages/producer/pipeline/graph.json"), "utf8"));
  const nodes = await renderedStepNodes(root, graph);
  assert.equal(nodes.length, graph.nodes.length);
  assert.deepEqual(stepLabelFindings(nodes), []);
});
