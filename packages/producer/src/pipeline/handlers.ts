import type { CliArgs } from "../cli/args.js";
import { runCheck } from "../cli/check.js";
import { runCompileCli } from "../cli/compile.js";
import { runDesign } from "../cli/design.js";
import { runDirect } from "../cli/direct.js";
import { runDirectorVerb } from "../cli/director.js";
import type { CliResult } from "../cli/main.js";
import { runMigrateCli } from "../cli/migrate.js";
import { runNextSubmitCli } from "../cli/next.js";
import { runApproveCli, runConfigCli, runEvidenceCli, runIaCli, runRuleCli, runSeatCli } from "../cli/owner.js";
import { runDecisionsCli, runPinCli } from "../cli/pin.js";
import { runOptionsCli, runPickCli } from "../cli/options.js";
import { runPipelineCli } from "../cli/pipeline.js";
import { runProduce } from "../cli/produce.js";
import { runPublish, runPublishCheck } from "../cli/publish.js";
import { runSpecimenCli } from "../cli/specimen.js";
import { runWrite } from "../cli/write.js";
import type { Step } from "./define.js";

/**
 * The only place the CLI reaches a step's code. Each key is a step's declared `command.entry`
 * (or, for composed steps, `command.module`); check:pipeline fails on a key no step declares and
 * on a runnable step with no key here.
 */
export interface StepContext {
  readonly step: Step;
  /** The verb's own argv (after the verb) for steps with their own parser; the full argv otherwise. */
  readonly argv: readonly string[];
  readonly args?: CliArgs;
  readonly cwd: string;
  /** The workspace root, discovered on first use. */
  readonly root: () => string;
  readonly composed?: readonly unknown[];
}
export type Handler = (context: StepContext) => Promise<CliResult>;
export type ModuleHandler = (context: StepContext) => Promise<unknown>;

const shared = (context: StepContext): CliArgs => {
  if (!context.args) throw new Error(`${context.step.id}: expected parsed arguments`);
  return context.args;
};

export const HANDLERS: Readonly<Record<string, Handler>> = {
  "src/cli/direct.ts#runDirect": async context => runDirect(shared(context), context.root()),
  "src/cli/design.ts#runDesign": async context => runDesign(shared(context), context.root()),
  "src/cli/write.ts#runWrite": async context => runWrite(shared(context), context.root()),
  "src/cli/check.ts#runCheck": async context => runCheck(shared(context), context.cwd),
  "src/cli/produce.ts#runProduce": async context => runProduce(shared(context), context.root()),
  "src/cli/publish.ts#runPublish": async context => runPublish(shared(context), context.root(), context.cwd),
  "src/cli/publish.ts#runPublishCheck": async context => runPublishCheck(shared(context), context.root()),
  "src/cli/compile.ts#runCompileCli": async context => runCompileCli(context.argv, context.cwd),
  "src/cli/pin.ts#runPinCli": async context => runPinCli(context.argv, context.cwd),
  "src/cli/pin.ts#runDecisionsCli": async context => runDecisionsCli(context.argv, context.cwd),
  "src/cli/options.ts#runOptionsCli": async context => runOptionsCli(context.argv, context.cwd),
  "src/cli/options.ts#runPickCli": async context => runPickCli(context.argv, context.cwd),
  "src/cli/specimen.ts#runSpecimenCli": async context => runSpecimenCli(context.argv, context.cwd),
  "src/cli/migrate.ts#runMigrateCli": async context => runMigrateCli(context.argv, context.cwd),
  "src/cli/pipeline.ts#runPipelineCli": async context => runPipelineCli(context.argv, context.cwd),
  "src/cli/director.ts#runDirectorVerb": async context => runDirectorVerb(context.argv),
  "src/cli/next.ts#runNextSubmitCli": async context => runNextSubmitCli(context.argv, context.cwd, context.step),
  "src/cli/owner.ts#runIaCli": async context => runIaCli(context.argv, context.cwd),
  "src/cli/owner.ts#runEvidenceCli": async context => runEvidenceCli(context.argv, context.cwd),
  "src/cli/owner.ts#runConfigCli": async context => runConfigCli(context.argv, context.cwd),
  "src/cli/owner.ts#runSeatCli": async context => runSeatCli(context.argv, context.cwd),
  "src/cli/owner.ts#runRuleCli": async context => runRuleCli(context.argv, context.cwd),
  "src/cli/owner.ts#runApproveCli": async context => runApproveCli(context.argv, context.cwd),
};

/** Modules a composed step runs (command.steps). No step composes modules in this build. */
export const MODULE_HANDLERS: Readonly<Record<string, ModuleHandler>> = {};
