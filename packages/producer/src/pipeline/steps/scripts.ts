import { defineStep } from "../define.js";

const STUDIO_GENERATED = ["studio-copy.json", "studio-map.json", "studio-map.ts", "assembly-bindings.ts", "studio-icons.ts", "studio-provenance.json", "studio-brand.json"];

/** Build, generate, compose and capture scripts: plumb, byte-identical every run. */
export const SCRIPT_STEPS = [
  defineStep({
    id: "derive.uses", kind: "plumb", actor: "code", stage: "derive",
    summary: "Derive each slot's uses list from pinned candidates.",
    inputs: ["clossys/agents/*/*/pin.json", "clossys/agents/*/*/candidates/*"], outputs: ["clossys/agents/*/*/slot.json#uses"],
    command: { script: "scripts/check-generated-derived.mjs", npm: "build" }, checks: ["generated-derived"],
  }),
  defineStep({
    id: "studio.map", kind: "plumb", actor: "code", stage: "derive",
    summary: "Generate the Studio map, copy, bindings, icons, provenance and brand.",
    inputs: ["clossys/agents/*/ia.json", "clossys/agents/*/*/slot.json", "clossys/agents/*/*/pin.json", "clossys/agents/*/*/candidates/*", "clossys/library/**", "clossys/selection.json"],
    outputs: STUDIO_GENERATED.map(name => `pkg:studio/generated/${name}`),
    command: { script: "scripts/generate-studio-map.mjs", npm: "generate:studio-map" }, checks: ["studio-map", "studio-routes"],
  }),
  defineStep({
    id: "build.receipt", kind: "plumb", actor: "code", stage: "check",
    summary: "Record the page-check source receipt in the build output.",
    inputs: ["pkg:studio/generated/studio-map.json"], outputs: ["pkg:dist/check/source-receipt.json"],
    command: { script: "scripts/generate-page-check-receipt.mjs", npm: "build" }, checks: ["workspace"],
  }),
  defineStep({
    id: "studio.compose", kind: "plumb", actor: "code", stage: "check",
    summary: "Compose the actual Studio runtime for the Studio checks.",
    inputs: ["pkg:studio/generated/studio-map.json", "clossys/library/**"], outputs: [],
    command: { script: "scripts/compose-studio.mjs", npm: "studio:compose" }, checks: ["studio-compose"],
  }),
  defineStep({
    id: "studio.checks", kind: "plumb", actor: "code", stage: "check",
    summary: "Studio render, routing, assembly and propagation checks.",
    inputs: ["pkg:studio/generated/studio-map.json", "pkg:studio/generated/assembly-bindings.ts", "clossys/library/**"], outputs: ["arg:--out"],
    command: { script: "studio/checks/p0-studio-check.cjs", npm: "studio:check" },
    checks: ["studio-p0", "studio-mutations", "studio-propagate", "studio-dom", "studio-modules", "publisher-preview", "theme-parity", "no-handrolling", "no-page-jsx", "studio-template", "assemble-only", "copy-source"],
  }),
  defineStep({
    id: "capture", kind: "plumb", actor: "code", stage: "capture",
    summary: "Capture every Studio route as screenshots and a contact sheet.",
    inputs: ["pkg:studio/generated/studio-map.json"], outputs: ["arg:--out"],
    command: { script: "scripts/capture-studio.mjs", npm: "capture:studio" }, checks: ["studio-capture"],
    pending: { branch: "claude/visual-harness", change: "adds" },
  }),
];
