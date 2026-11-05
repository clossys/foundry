import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DESIGNER_SHADCN_FLAVOR, shadcnComponentsJson, shadcnComponentsJsonText } from "./flavor.mjs";
import * as entry from "../check-ref-verbatim.mjs";

const designer = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repo = join(designer, "..", "..");

test("the Designer's ui workspace components.json is the generator's output", () => {
  assert.equal(readFileSync(join(designer, "ui", "components.json"), "utf8"), shadcnComponentsJsonText({ css: "src/index.css" }));
});

test("the consumer components.json is the same flavor with its own stylesheet", () => {
  const consumer = JSON.parse(readFileSync(join(repo, "clossys", "components.json"), "utf8"));
  assert.deepEqual(consumer, shadcnComponentsJson({ css: consumer.tailwind.css }));
  assert.notEqual(consumer.tailwind.css, "src/index.css");
});

test("only tailwind.css varies; a bad stylesheet path is refused", () => {
  const a = shadcnComponentsJson({ css: "app.css" }), b = shadcnComponentsJson({ css: "src/index.css" });
  assert.deepEqual({ ...a, tailwind: { ...a.tailwind, css: "" } }, { ...b, tailwind: { ...b.tailwind, css: "" } });
  assert.equal(a.style, DESIGNER_SHADCN_FLAVOR.style);
  for (const css of ["", "/abs/app.css", "a\\b.css", undefined]) assert.throws(() => shadcnComponentsJson({ css }), TypeError);
});

test("the shipped ref-verbatim entry exports the writer", () => {
  assert.equal(entry.shadcnComponentsJsonText, shadcnComponentsJsonText);
});
