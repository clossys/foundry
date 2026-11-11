import type { Binding } from "../define.js";

/**
 * Code binds to action contracts by id (docs/step-standard.md). A `clossys <verb>` action binds its
 * handler entry (a src/pipeline/handlers.ts key) and, for a verb that parses its own argv, its parser;
 * a traced action binds the script its command runs; a gap may bind the modules its decider uses (no action is a gap in this build).
 * check:step-standard fails both ways: a contract with no binding, a binding with no contract, a
 * handler no binding names, and a binding that disagrees with its contract's run.
 */
const PIN: Binding = { entry: "src/cli/pin.ts#runPinCli", parser: "src/cli/pin.ts" };
const PICK: Binding = { entry: "src/cli/options.ts#runPickCli", parser: "src/cli/options.ts" };
const NEXT: Binding = { entry: "src/cli/next.ts#runNextSubmitCli", parser: "src/cli/next.ts" };

export const BINDINGS: Readonly<Record<string, Binding>> = {
  // Owner and agent decisions recorded by a clossys verb.
  "pin.director": PIN, "pin.designer": PIN, "pin.writer": PIN, "pin.publisher": PIN,
  "pick.director": PICK, "pick.designer": PICK, "pick.writer": PICK, "pick.publisher": PICK,
  // Agent candidates: `clossys next <agent>/<slot> --submit` checks and records one (W6a).
  "director.candidates": NEXT, "designer.candidates": NEXT, "writer.candidates": NEXT, "publisher.candidates": NEXT,
  // Owner decisions, each recorded by its own clossys verb (W6a).
  "ia": { entry: "src/cli/owner.ts#runIaCli", parser: "src/cli/owner.ts" },
  "evidence": { entry: "src/cli/owner.ts#runEvidenceCli", parser: "src/cli/owner.ts" },
  "workspace.config": { entry: "src/cli/owner.ts#runConfigCli", parser: "src/cli/owner.ts" },
  "seats": { entry: "src/cli/owner.ts#runSeatCli", parser: "src/cli/owner.ts" },
  "rules": { entry: "src/cli/owner.ts#runRuleCli", parser: "src/cli/owner.ts" },
  "writer.approve": { entry: "src/cli/owner.ts#runApproveCli", parser: "src/cli/owner.ts" },
  // clossys verbs.
  "director.check": { entry: "src/cli/direct.ts#runDirect" },
  "director.store": { entry: "src/cli/director.ts#runDirectorVerb", parser: "src/cli/director.ts" },
  "designer.brief": { entry: "src/cli/design.ts#runDesign" },
  "designer.check": { entry: "src/cli/design.ts#runDesign" },
  "designer.compile": { entry: "src/cli/design.ts#runDesign" },
  "writer.brief": { entry: "src/cli/write.ts#runWrite" },
  "writer.check": { entry: "src/cli/write.ts#runWrite" },
  "writer.compile": { entry: "src/cli/write.ts#runWrite" },
  "workspace.check": { entry: "src/cli/check.ts#runCheck" },
  "compile": { entry: "src/cli/compile.ts#runCompileCli", parser: "src/cli/compile.ts" },
  "options": { entry: "src/cli/options.ts#runOptionsCli", parser: "src/cli/options.ts" },
  "decisions": { entry: "src/cli/pin.ts#runDecisionsCli", parser: "src/cli/pin.ts" },
  "studio.produce": { entry: "src/cli/produce.ts#runProduce" },
  "publish.install": { entry: "src/cli/publish.ts#runPublish" },
  "publish.page": { entry: "src/cli/publish.ts#runPublishCheck" },
  "specimen": { entry: "src/cli/specimen.ts#runSpecimenCli", parser: "src/cli/specimen.ts" },
  "migrate": { entry: "src/cli/migrate.ts#runMigrateCli", parser: "src/cli/migrate.ts" },
  "pipeline": { entry: "src/cli/pipeline.ts#runPipelineCli", parser: "src/cli/pipeline.ts" },
  // Traced script steps: `clossys pipeline trace <id> -- <command>` records their run.
  "derive.uses": { script: "scripts/check-generated-derived.mjs" },
  "studio.map": { script: "scripts/generate-studio-map.mjs" },
  "specimen.evidence": { script: "../designer/scripts/generate-specimen-surface-evidence.mjs" },
  "build.receipt": { script: "scripts/generate-page-check-receipt.mjs" },
  "studio.compose": { script: "scripts/compose-studio.mjs" },
  "studio.checks": { script: "studio/checks/p0-studio-check.cjs" },
  "capture": { script: "scripts/capture-studio.mjs" },
};
