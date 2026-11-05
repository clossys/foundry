import { defineStep } from "../define.js";
import { CANDIDATES, COMPILE_LOCK, IA, PINS, SLOTS, SOURCE_RECEIPT, STUDIO_MAP, candidatesOf, pinsOf } from "./ports.js";

const STUDIO_GENERATED = ["studio-copy.json", "studio-map.ts", "assembly-bindings.ts", "studio-icons.ts", "studio-provenance.json", "studio-brand.json", "studio-flow-theme.css"];

/** Build, generate, compose and capture scripts: plumb, byte-identical every run. */
export const SCRIPT_STEPS = [
  defineStep({
    id: "derive.uses", kind: "plumb", actor: "code", stage: "publish.assemble",
    summary: "Derive each slot's uses list from pinned candidates.",
    inputs: [PINS, ...CANDIDATES], outputs: ["clossys/agents/*/*/slot.json#uses"],
    command: { script: "scripts/check-generated-derived.mjs", npm: "build" }, checks: ["generated-derived"],
  }),
  defineStep({
    id: "studio.map", kind: "plumb", actor: "code", stage: "publish.assemble",
    summary: "Generate the Studio map, copy, bindings, icons, provenance, brand and flow theme.",
    // It never reads selection.json: compile runs it over a root holding only the
    // decision-inputs.json files, and check:compile-pure proves that root and edits to both leave the output unchanged.
    inputs: [IA, SLOTS, PINS, ...CANDIDATES],
    outputs: [STUDIO_MAP, ...STUDIO_GENERATED.map(name => `pkg:studio/generated/${name}`)],
    command: { script: "scripts/generate-studio-map.mjs", npm: "generate:studio-map" }, checks: ["studio-map", "studio-routes"],
  }),
  defineStep({
    id: "build.receipt", kind: "plumb", actor: "code", stage: "publish.check",
    summary: "Record the page-check source receipt in the build output.",
    // It records the git head and whether the tree is dirty: the committed decision files and the compile lock.
    inputs: [IA, SLOTS, PINS, ...CANDIDATES, COMPILE_LOCK], outputs: [SOURCE_RECEIPT],
    command: { script: "scripts/generate-page-check-receipt.mjs", npm: "build" }, checks: ["workspace"],
  }),
  defineStep({
    id: "studio.compose", kind: "plumb", actor: "code", stage: "publish.assemble",
    summary: "Compose the actual Studio runtime for the Studio checks.",
    // studioSelection reads the Designer pins and the shadcn registry item candidates they name.
    inputs: [pinsOf("designer"), candidatesOf("designer")], outputs: [],
    command: { script: "scripts/compose-studio.mjs", npm: "studio:compose" }, checks: ["studio-compose"],
  }),
  defineStep({
    id: "studio.checks", kind: "plumb", actor: "code", stage: "publish.check",
    summary: "Studio render, routing, assembly and propagation checks.",
    inputs: [STUDIO_MAP, "pkg:studio/generated/assembly-bindings.ts"], outputs: ["arg:--out"],
    command: { script: "studio/checks/p0-studio-check.cjs", npm: "studio:check" },
    checks: ["studio-p0", "studio-mutations", "studio-propagate", "studio-dom", "studio-modules", "publisher-preview", "theme-parity", "no-handrolling", "no-page-jsx", "studio-template", "assemble-only", "routes-published", "route-parity", "copy-source", "no-hidden-fallbacks", "studio"],
  }),
  defineStep({
    id: "capture", kind: "plumb", actor: "code", stage: "publish.check",
    summary: "Capture every Studio route as screenshots and a contact sheet.",
    inputs: [STUDIO_MAP], outputs: ["arg:--out"],
    command: { script: "scripts/capture-studio.mjs", npm: "capture:studio" }, checks: ["studio-capture"],
  }),
];
