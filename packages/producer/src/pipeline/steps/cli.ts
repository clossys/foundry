import { defineStep } from "../define.js";

const DIRECTOR_PINS = ["clossys/agents/director/*/pin.json", "clossys/agents/director/*/candidates/*"];
const agentInputs = (agent: string) => [`clossys/agents/${agent}/*/pin.json`, `clossys/agents/${agent}/*/candidates/*`, "clossys/agents/director/*/pin.json"];

/** The CLI verbs. `clossys <verb>` runs only the step whose verb and mode flags match (src/pipeline/runner.ts). */
export const CLI_STEPS = [
  defineStep({
    id: "director.check", kind: "plumb", actor: "code", stage: "check",
    summary: "Read-only Director check over pinned Director slots.",
    inputs: DIRECTOR_PINS, outputs: [],
    command: { cli: { verb: "direct" }, entry: "src/cli/direct.ts#runDirect" }, checks: ["workspace"],
  }),
  defineStep({
    id: "designer.brief", kind: "plumb", actor: "code", stage: "derive",
    summary: "Print the Designer derivation brief (read-only).",
    inputs: agentInputs("designer"), outputs: [],
    command: { cli: { verb: "design", flags: ["--brief"] }, entry: "src/cli/design.ts#runDesign" }, checks: ["workspace"],
  }),
  defineStep({
    id: "designer.check", kind: "plumb", actor: "code", stage: "check",
    summary: "Check Designer traceability (read-only).",
    inputs: agentInputs("designer"), outputs: [],
    command: { cli: { verb: "design", flags: ["--check"] }, entry: "src/cli/design.ts#runDesign" }, checks: ["workspace"],
  }),
  defineStep({
    id: "designer.compile", kind: "plumb", actor: "code", stage: "compile",
    summary: "Print the pinned Designer projection (read-only; written only to --out).",
    inputs: agentInputs("designer"), outputs: ["arg:--out"],
    command: { cli: { verb: "design" }, entry: "src/cli/design.ts#runDesign" }, checks: ["workspace"],
  }),
  defineStep({
    id: "writer.brief", kind: "plumb", actor: "code", stage: "derive",
    summary: "Print the Writer derivation brief (read-only).",
    inputs: agentInputs("writer"), outputs: [],
    command: { cli: { verb: "write", flags: ["--brief"] }, entry: "src/cli/write.ts#runWrite" }, checks: ["workspace"],
  }),
  defineStep({
    id: "writer.check", kind: "plumb", actor: "code", stage: "check",
    summary: "Check Writer traceability (read-only).",
    inputs: agentInputs("writer"), outputs: [],
    command: { cli: { verb: "write", flags: ["--check"] }, entry: "src/cli/write.ts#runWrite" }, checks: ["workspace"],
  }),
  defineStep({
    id: "writer.compile", kind: "plumb", actor: "code", stage: "compile",
    summary: "Print the pinned Writer projection (read-only; written only to --out).",
    inputs: agentInputs("writer"), outputs: ["arg:--out"],
    command: { cli: { verb: "write" }, entry: "src/cli/write.ts#runWrite" }, checks: ["workspace"],
  }),
  defineStep({
    id: "workspace.check", kind: "plumb", actor: "code", stage: "check",
    summary: "Slot model, page and record-suite checks over the workspace.",
    inputs: ["clossys/agents/*/ia.json", "clossys/agents/*/*/slot.json", "clossys/agents/*/*/pin.json", "clossys/agents/*/*/candidates/*"],
    outputs: [{ glob: "arg:--report", schema: "check-report" }],
    command: { cli: { verb: "check" }, entry: "src/cli/check.ts#runCheck" }, checks: ["workspace"],
  }),
  defineStep({
    id: "compile", kind: "plumb", actor: "code", stage: "compile",
    summary: "Compile the Studio from decision files only into the compile lock.",
    inputs: ["clossys/agents/*/*/pin.json", "clossys/agents/*/*/candidates/*", "clossys/agents/*/*/slot.json"],
    outputs: [{ glob: "pkg:studio/compile.lock.json", schema: "compile-lock" }],
    command: { cli: { verb: "compile", parser: "src/cli/compile.ts" }, entry: "src/cli/compile.ts#runCompileCli" }, checks: ["compile-pure"],
  }),
  defineStep({
    id: "decisions", kind: "plumb", actor: "code", stage: "check",
    summary: "List every slot's decision state: pinned, not needed or open (read-only).",
    inputs: ["clossys/agents/*/*/slot.json", "clossys/agents/*/*/pin.json"], outputs: [],
    command: { cli: { verb: "decisions", parser: "src/cli/pin.ts" }, entry: "src/cli/pin.ts#runDecisionsCli" }, checks: ["decisions"],
  }),
  defineStep({
    id: "studio.produce", kind: "plumb", actor: "code", stage: "operate",
    summary: "Serve the local Studio over the live slot model (no compile step).",
    inputs: ["clossys/agents/*/ia.json", "clossys/agents/*/*/slot.json", "clossys/agents/*/*/pin.json", "clossys/agents/*/*/candidates/*"], outputs: [],
    command: { cli: { verb: "produce" }, entry: "src/cli/produce.ts#runProduce" }, checks: ["studio-p0"],
  }),
  defineStep({
    id: "publish.install", kind: "plumb", actor: "code", stage: "compile",
    summary: "Install pinned pages, a routed site or Next routes into a consumer app.",
    inputs: ["clossys/agents/publisher/*/pin.json", "clossys/agents/publisher/*/candidates/*", "clossys/library/**"],
    outputs: ["arg:--out", "arg:--next"],
    command: { cli: { verb: "publish", flags: ["--install"] }, entry: "src/cli/publish.ts#runPublish" }, checks: ["workspace"],
  }),
  defineStep({
    id: "publish.page", kind: "plumb", actor: "code", stage: "compile",
    summary: "Bare publish: dry-run check of every pinned page against pinned Designer slots and Writer copy (read-only).",
    inputs: ["clossys/agents/publisher/*/pin.json", "clossys/agents/publisher/*/candidates/*", "clossys/agents/designer/*/pin.json", "clossys/agents/writer/*/pin.json"], outputs: [],
    command: { cli: { verb: "publish" }, entry: "src/cli/publish.ts#runPublishCheck" }, checks: ["workspace"],
  }),
  defineStep({
    id: "specimen", kind: "plumb", actor: "code", stage: "capture",
    summary: "Serve or snapshot a library element specimen.",
    inputs: ["clossys/library/**"], outputs: ["node_modules/.cache/clossys/specimen-thumbs/**", "arg:--out"],
    command: { cli: { verb: "specimen", parser: "src/cli/specimen.ts" }, entry: "src/cli/specimen.ts#runSpecimenCli" }, checks: ["studio-dom"],
  }),
  defineStep({
    id: "migrate", kind: "plumb", actor: "code", stage: "derive",
    summary: "One-shot codemod: migrate copy keys to port ids (--check reports only).",
    inputs: ["clossys/agents/*/*/candidates/*"], outputs: [],
    command: { cli: { verb: "migrate", parser: "src/cli/migrate.ts" }, entry: "src/cli/migrate.ts#runMigrateCli" }, checks: ["workspace"],
  }),
  defineStep({
    id: "pipeline", kind: "plumb", actor: "code", stage: "operate",
    summary: "Report pipeline status (read-only) and the step graph built from these definitions.",
    inputs: ["clossys/agents/producer/*/seat.json", "clossys/agents/*/*/slot.json", "clossys/agents/*/*/pin.json", "clossys/agents/*/*/candidates/*"],
    outputs: ["pkg:pipeline/graph.json"],
    command: { cli: { verb: "pipeline", parser: "src/cli/pipeline.ts" }, entry: "src/cli/pipeline.ts#runPipelineCli", npm: "generate:pipeline-graph" }, checks: ["pipeline"],
  }),
];
