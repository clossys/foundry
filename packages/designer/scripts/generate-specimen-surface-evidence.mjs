#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prepareStudioSelection } from "../../producer/dist/server/selection-defaults.js";
import * as sourceEvidence from "../dist/library-cli/measure-specimen-surfaces.js";
import { stableStringify } from "../dist/catalog-core/stable.js";
import { SPECIMEN_SECTION_EXPORTS } from "../dist/importers/specimen-sections.js";

const args = process.argv.slice(2);
if (args.some(arg => arg !== "--check") || args.length > 1) throw new Error("Usage: generate-specimen-surface-evidence.mjs [--check]");
let environment;
const prepared = await prepareStudioSelection(undefined, {
  specimenSurfaceEnvironment: async input => (environment = await sourceEvidence.specimenSurfaceEnvironment(input)),
  qualifySpecimenSurfaces: sourceEvidence.qualifySpecimenSurfaces,
});
const measurements = prepared.input.surfaceOptions.measurements;
const native = SPECIMEN_SECTION_EXPORTS.map(row => row.id).sort();
if (stableStringify(measurements.map(row => row.slot).sort()) !== stableStringify(native) || measurements.some(row => row.scope !== "real" || row.command.exitCode !== 0 || row.checks.types !== "pass" || row.checks.closure !== "pass")) throw new Error("Every registered native specimen needs real completed compiler evidence.");
const first = measurements[0];
if (measurements.some(row => stableStringify(row.compiler) !== stableStringify(first.compiler) || stableStringify(row.command) !== stableStringify(first.command))) throw new Error("Native evidence must retain the completed shared compiler invocation.");
const modules = new Set(environment.dependencies.map(row => row.module));
const artifact = { version: 1, packages: environment.input.surfaceOptions.packages.filter(row => modules.has(row.module)), dependencies: environment.dependencies,
  compiler: first.compiler, command: first.command,
  // Compilation facts have no consumer identity. Replay must prove exact input equivalence
  // before creating a current measurement; provenance remains the surface engine's job.
  certificates: measurements.map(({ slot, source, compiled, checks }) => ({ slot, source, compiled, checks })),
};
const path = fileURLToPath(new URL("../src/catalog/native-specimen-evidence.json", import.meta.url));
const text = stableStringify(artifact);
if (args.includes("--check")) {
  if (await readFile(path, "utf8") !== text) throw new Error("Native specimen compiler evidence is stale; regenerate it from the current completed builds.");
} else await writeFile(path, text);
console.log(`${args.includes("--check") ? "PASS current" : "Wrote"}: ${native.length} real native compiler certificates; ${first.command.argv.join(" ")}`);
