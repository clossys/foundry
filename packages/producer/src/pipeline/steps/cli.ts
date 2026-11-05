import { defineStep } from "../define.js";
import { CANDIDATES, IA, PINS, PIPELINE_GRAPH, SEATS, SLOTS, SOURCE_RECEIPT, candidatesOf, pinsOf, slotsOf } from "./ports.js";
import type { Agent } from "./ports.js";

const DIRECTOR_PINS = [pinsOf("director"), candidatesOf("director")];
const agentInputs = (agent: Agent) => [pinsOf(agent), candidatesOf(agent), pinsOf("director")];
/** A brief reads only the pinned Director slots (readPinnedDirector): the Director pins and the candidates they name. */
const BRIEF_INPUTS = DIRECTOR_PINS;

/** The CLI verbs. `clossys <verb>` runs only the step whose verb and mode flags match (src/pipeline/runner.ts). */
export const CLI_STEPS = [
  defineStep({
    id: "director.check", kind: "plumb", actor: "code", stage: "publish.check",
    summary: "Read-only Director check over pinned Director slots.",
    inputs: DIRECTOR_PINS, outputs: [],
    command: { cli: { verb: "direct" }, entry: "src/cli/direct.ts#runDirect" }, checks: ["workspace"],
  }),
  defineStep({
    id: "director.store", kind: "plumb", actor: "code", stage: "direct.pin",
    summary: "Director's own store commands (clossys director check, rate-check) through the slot-model reader and writer.",
    // The pinned Director slots, then everything under the default root (--root may name another), plus
    // the consumer's Director evidence. The commands write only generated files; pins are made by `clossys pin`.
    inputs: [...DIRECTOR_PINS, "clossys/agents/director/**", "clossys/evidence/director/*.md"],
    outputs: [
      "clossys/evidence/director/briefs/**", "clossys/evidence/director/reports/*.json",
    ],
    command: { cli: { verb: "director", parser: "src/cli/director.ts" }, entry: "src/cli/director.ts#runDirectorVerb" }, checks: ["workspace"],
  }),
  defineStep({
    id: "designer.brief", kind: "plumb", actor: "code", stage: "design.brief",
    summary: "Print the Designer derivation brief (read-only).",
    inputs: BRIEF_INPUTS, outputs: [],
    command: { cli: { verb: "design", flags: ["--brief"] }, entry: "src/cli/design.ts#runDesign" }, checks: ["workspace"],
  }),
  defineStep({
    id: "designer.check", kind: "plumb", actor: "code", stage: "publish.check",
    summary: "Check Designer traceability (read-only).",
    inputs: agentInputs("designer"), outputs: [],
    command: { cli: { verb: "design", flags: ["--check"] }, entry: "src/cli/design.ts#runDesign" }, checks: ["workspace"],
  }),
  defineStep({
    id: "designer.compile", kind: "plumb", actor: "code", stage: "publish.assemble",
    summary: "Print the pinned Designer projection (read-only; written only to --out).",
    inputs: agentInputs("designer"), outputs: ["arg:--out"],
    command: { cli: { verb: "design" }, entry: "src/cli/design.ts#runDesign" }, checks: ["workspace"],
  }),
  defineStep({
    id: "writer.brief", kind: "plumb", actor: "code", stage: "design.brief",
    summary: "Print the Writer derivation brief (read-only).",
    inputs: BRIEF_INPUTS, outputs: [],
    command: { cli: { verb: "write", flags: ["--brief"] }, entry: "src/cli/write.ts#runWrite" }, checks: ["workspace"],
  }),
  defineStep({
    id: "writer.check", kind: "plumb", actor: "code", stage: "publish.check",
    summary: "Check Writer traceability (read-only).",
    inputs: agentInputs("writer"), outputs: [],
    command: { cli: { verb: "write", flags: ["--check"] }, entry: "src/cli/write.ts#runWrite" }, checks: ["workspace"],
  }),
  defineStep({
    id: "writer.compile", kind: "plumb", actor: "code", stage: "publish.assemble",
    summary: "Print the pinned Writer projection (read-only; written only to --out).",
    inputs: agentInputs("writer"), outputs: ["arg:--out"],
    command: { cli: { verb: "write" }, entry: "src/cli/write.ts#runWrite" }, checks: ["workspace"],
  }),
  defineStep({
    id: "workspace.check", kind: "plumb", actor: "code", stage: "publish.check",
    summary: "Slot model, page and record-suite checks over the workspace.",
    inputs: [IA, SLOTS, PINS, ...CANDIDATES, SOURCE_RECEIPT],
    outputs: [{ glob: "arg:--report", schema: "check-report" }],
    command: { cli: { verb: "check" }, entry: "src/cli/check.ts#runCheck" }, checks: ["workspace", "slot-pins", "cli-verbs"],
  }),
  defineStep({
    id: "compile", kind: "plumb", actor: "code", stage: "publish.assemble",
    summary: "Compile the Studio from decision files only into the compile lock.",
    inputs: [PINS, ...CANDIDATES, SLOTS],
    outputs: [{ glob: "pkg:studio/compile.lock.json", schema: "compile-lock" }],
    command: { cli: { verb: "compile", parser: "src/cli/compile.ts" }, entry: "src/cli/compile.ts#runCompileCli" }, checks: ["compile-pure"],
  }),
  defineStep({
    id: "options", kind: "plumb", actor: "code", stage: "publish.assemble",
    summary: "Candidate options: write slot.json options/varyOn from the class mapping, list a slot's options, or print the brief for fresh ones.",
    // It reads every pin and candidate, so it sits after the last pin stage, beside derive.uses (also a slot.json field).
    inputs: [IA, SLOTS, PINS, ...CANDIDATES],
    outputs: ["clossys/agents/*/*/slot.json#options", "clossys/agents/*/*/slot.json#varyOn"],
    command: { cli: { verb: "options", parser: "src/cli/options.ts" }, entry: "src/cli/options.ts#runOptionsCli" }, checks: ["slot-options"],
  }),
  defineStep({
    id: "decisions", kind: "plumb", actor: "code", stage: "publish.check",
    summary: "List every slot's decision state: pinned, not needed or open (read-only).",
    inputs: [SLOTS, PINS], outputs: [],
    command: { cli: { verb: "decisions", parser: "src/cli/pin.ts" }, entry: "src/cli/pin.ts#runDecisionsCli" }, checks: ["decisions"],
  }),
  defineStep({
    id: "studio.produce", kind: "plumb", actor: "code", stage: "publish.publish",
    summary: "Serve the local Studio over the live slot model (no compile step).",
    inputs: [IA, SLOTS, PINS, ...CANDIDATES, PIPELINE_GRAPH], outputs: [],
    command: { cli: { verb: "produce" }, entry: "src/cli/produce.ts#runProduce" }, checks: ["studio-p0", "one-brand"],
  }),
  defineStep({
    id: "publish.install", kind: "plumb", actor: "code", stage: "publish.publish",
    summary: "Install pinned pages, a routed site or Next routes into a consumer app.",
    inputs: [pinsOf("publisher"), candidatesOf("publisher")],
    outputs: ["arg:--out", "arg:--next"],
    command: { cli: { verb: "publish", flags: ["--install"] }, entry: "src/cli/publish.ts#runPublish" }, checks: ["workspace"],
  }),
  defineStep({
    id: "publish.page", kind: "plumb", actor: "code", stage: "publish.check",
    summary: "Bare publish: dry-run check of every pinned page against pinned Designer slots and Writer copy (read-only).",
    inputs: [pinsOf("publisher"), candidatesOf("publisher"), pinsOf("designer"), pinsOf("writer")], outputs: [],
    command: { cli: { verb: "publish" }, entry: "src/cli/publish.ts#runPublishCheck" }, checks: ["workspace"],
  }),
  defineStep({
    id: "specimen", kind: "plumb", actor: "code", stage: "publish.assemble",
    summary: "Serve or snapshot a library element specimen.",
    // libraryRecordSource reads the Designer slot model and the pinned Writer copy, not the legacy library store.
    inputs: [IA, slotsOf("designer"), pinsOf("designer"), candidatesOf("designer"), pinsOf("writer"), candidatesOf("writer")], outputs: ["node_modules/.cache/clossys/specimen-thumbs/**", "arg:--out"],
    command: { cli: { verb: "specimen", parser: "src/cli/specimen.ts" }, entry: "src/cli/specimen.ts#runSpecimenCli" }, checks: ["studio-dom"],
  }),
  defineStep({
    id: "migrate", kind: "plumb", actor: "code", stage: "publish.assemble",
    summary: "One-shot codemod: migrate copy keys to port ids (--check reports only).",
    inputs: [...CANDIDATES], outputs: [],
    command: { cli: { verb: "migrate", parser: "src/cli/migrate.ts" }, entry: "src/cli/migrate.ts#runMigrateCli" }, checks: ["workspace"],
  }),
  defineStep({
    id: "pipeline", kind: "plumb", actor: "code", stage: "publish.check",
    summary: "Report pipeline status (read-only) and the step graph built from these definitions.",
    inputs: [SEATS, SLOTS, PINS, ...CANDIDATES],
    outputs: [PIPELINE_GRAPH],
    command: { cli: { verb: "pipeline", parser: "src/cli/pipeline.ts" }, entry: "src/cli/pipeline.ts#runPipelineCli", npm: "generate:pipeline-graph" }, checks: ["pipeline"],
  }),
];
