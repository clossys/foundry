/** @vitest-environment node */
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { mergeRendererGroups } from "../runtime/contract.js";
import { surfaceRuntimeCallbacks, surfaceRuntimeRenderers } from "../runtime/index.js";
import { specimenDataset } from "./specimen-dataset.js";
import { packageBarrelExports } from "../library-cli/surface-package-evidence.js";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
it("keeps the interactive specimen on the Studio entrypoint only", () => {
  for (const path of ["../index.ts", "../frames/index.ts", "../frames/server.ts"]) {
    const exports = packageBarrelExports(source(path));
    expect(exports.values, path).not.toContain("AppFrameSpecimen");
    expect(exports.types, path).not.toContain("AppFrameSpecimenProps");
  }
  expect(packageBarrelExports(source("./index.ts")).values).toContain("AppFrameSpecimen");
});
it("removes the retired editor without removing live agent history", () => {
  expect(existsSync(new URL("./edit-session.ts", import.meta.url))).toBe(false);
  expect(existsSync(new URL("./history.ts", import.meta.url))).toBe(false);
  expect(existsSync(new URL("./agent/history.ts", import.meta.url))).toBe(true);
});
it("owns the synthetic dataset specialization in Studio", () => {
  expect(source("../runtime/contract.ts")).not.toContain("SpecimenDataset");
  expect(source("./surface-renderer-contract.ts")).toContain("SpecimenDataset");
});

it("shares runtime renderer callbacks and keeps typed sample inputs", () => {
  const sample = (dataset: { value: string }) => ({ value: dataset.value });
  const render = () => null;
  const entry = mergeRendererGroups({ "sections.example": { leaf: "sections.example" as const, render, sample } })["sections.example"]!;
  expect(entry.sample({ value: "custom" })).toEqual({ value: "custom" });
  expect(entry.render).toBe(render);
  const runtime = surfaceRuntimeRenderers["frames.auth-shell"]!;
  expect(surfaceRuntimeCallbacks([runtime.leaf])[`package:${runtime.leaf}`]).toBe(runtime.render);
  expect(runtime.sample(specimenDataset)).toEqual({ "skip-link": specimenDataset.frames.app.skipLabel });
  expect(source("../../dist/runtime/contract.js")).not.toMatch(/(?:from|import).*studio/);
  expect(source("../../dist/runtime/index.js")).not.toMatch(/(?:from|import).*studio/);
});
