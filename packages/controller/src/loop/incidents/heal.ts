/**
 * The heal step: match a record against the known causes and act on the match, with no model.
 *
 *   known cause, remedy   run the remedy, re-run the failed step once, and record healed or still failing
 *   known cause, `none`   print the owner and the blocker
 *   unknown signature     print `NEW-CAUSE <signature>`: the only case a model is used for. It closes when
 *                         causes.json has an entry for it whose guard's check fails on its fixture.
 */
import { matchCause } from "./causes.js";
import { NO_REMEDY, REMEDIES, type HealEnv, type Remedy } from "./remedies.js";
import { OUTCOME_SCHEMA, type HealOutcome, type HealOutcomeRecord, type IncidentRecord, type KnownCause } from "./types.js";

export interface HealResult {
  readonly outcome: HealOutcome;
  readonly cause?: KnownCause;
  /** What the step prints, one finding per line. */
  readonly lines: readonly string[];
  /** 0 when healed; 1 otherwise. */
  readonly exit: 0 | 1;
  readonly record: HealOutcomeRecord;
}

const firstLine = (signature: string) => signature.split("\n").find(line => line.trim() !== "") ?? "(empty output)";

/** The signature on one line, for `NEW-CAUSE <signature>`. */
export const oneLineSignature = (signature: string): string => signature.split("\n").map(line => line.trim()).filter(Boolean).join(" | ") || "(empty output)";

export async function heal(record: IncidentRecord, options: { causes: readonly KnownCause[]; env: HealEnv; remedies?: Readonly<Record<string, Remedy>>; now?: () => Date }): Promise<HealResult> {
  const remedies = options.remedies ?? REMEDIES;
  const now = options.now ?? (() => new Date());
  const outcome = (kind: HealOutcome, cause: KnownCause | undefined, rerun: number | null, base: number | null): HealOutcomeRecord => Object.freeze({
    schema: OUTCOME_SCHEMA, signature: record.signature, stage: record.stage, command: record.command,
    cause: cause?.id ?? null, outcome: kind, remedy: cause && cause.remedy !== NO_REMEDY ? cause.remedy : null,
    rerun_exit: rerun, base_exit: base, at: now().toISOString(),
  });

  const cause = matchCause(record, options.causes);
  if (!cause) {
    return { outcome: "new-cause", lines: [`NEW-CAUSE ${oneLineSignature(record.signature)}`], exit: 1, record: outcome("new-cause", undefined, null, null) };
  }
  const remedy = cause.remedy === NO_REMEDY ? undefined : remedies[cause.remedy];
  if (!remedy) {
    const why = cause.remedy === NO_REMEDY ? "no remedy" : `remedy ${cause.remedy} is not a function in code`;
    return { outcome: "blocked", cause, lines: [`BLOCKED ${cause.id} owner=${cause.owner} (${why}): ${cause.blocker}`], exit: 1, record: outcome("blocked", cause, null, null) };
  }

  const done = await remedy(record, options.env);
  const lines = [`REMEDY ${cause.id} ${cause.remedy}: ${done.note}`];
  // The failed step re-runs exactly once, after the remedy, in the one environment the base run shares.
  const command = done.rerun ?? record.command;
  const rerun = await options.env.run(command, { cwd: options.env.cwd, env: options.env.env });
  if (rerun.exit === 0) {
    lines.push(`HEALED ${cause.id}: \`${command}\` exit 0 after ${cause.remedy}`);
    return { outcome: "healed", cause, lines, exit: 0, record: outcome("healed", cause, 0, null) };
  }
  if (done.compareBase) {
    const base = await options.env.runOnBase(command, { base: options.env.base, cwd: options.env.cwd, env: options.env.env });
    if (base.exit === rerun.exit) {
      lines.push(`HEALED ${cause.id}: \`${command}\` exit ${rerun.exit}, same exit as base ${options.env.base} in the same environment (not a new red)`);
      return { outcome: "healed", cause, lines, exit: 0, record: outcome("healed", cause, rerun.exit, base.exit) };
    }
    lines.push(`STILL-FAILING ${cause.id} owner=${cause.owner}: \`${command}\` exit ${rerun.exit}, base ${options.env.base} exit ${base.exit}: ${firstLine(record.signature)}`);
    return { outcome: "still-failing", cause, lines, exit: 1, record: outcome("still-failing", cause, rerun.exit, base.exit) };
  }
  lines.push(`STILL-FAILING ${cause.id} owner=${cause.owner}: \`${command}\` exit ${rerun.exit} after ${cause.remedy}: ${cause.blocker}`);
  return { outcome: "still-failing", cause, lines, exit: 1, record: outcome("still-failing", cause, rerun.exit, null) };
}
