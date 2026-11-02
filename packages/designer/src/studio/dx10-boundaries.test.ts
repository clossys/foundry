/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { packageBarrelExports } from "../library-cli/surface-package-evidence.js";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
it("exports the interactive AppFrame specimen through Studio", () => {
  for (const path of ["../index.ts", "../frames/index.ts", "../frames/server.ts"]) {
    const exports = packageBarrelExports(source(path));
    expect(exports.values, path).not.toContain("AppFrameSpecimen");
    expect(exports.types, path).not.toContain("AppFrameSpecimenProps");
  }
  const studio = packageBarrelExports(source("./index.ts"));
  expect(studio.values).toContain("AppFrameSpecimen");
  expect(studio.types).toContain("AppFrameSpecimenProps");
  expect(packageBarrelExports(source("../frames/index.ts")).values).toContain("AppFrame");
});
