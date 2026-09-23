#!/usr/bin/env node
/**
 * `ci-conventions-check` -- the CLI for `evaluateCiConventions`
 * (`./ci-conventions.ts`). Presentation only: read the workflow files, the
 * ruleset, the declaration, and (optionally) pricing data from disk, call
 * the pure evaluator, print the shared check-output envelope as JSON, and
 * pick an exit code. All the actual evaluation happens in
 * `./ci-conventions.ts`, which does none of this file's I/O itself --
 * matching `foundry-check`'s own CLI/library split (`../gates/cli.ts`).
 *
 * Exit codes, the same 0/1/2 contract every check command in this package
 * already uses (`../gates/result.ts`'s `gateResultToExitCode`):
 *
 *   0 -- `satisfied`: every checked rule holds (warnings alone still exit 0).
 *   1 -- `violated`: at least one error-severity finding, in `enforce` mode.
 *   2 -- `indeterminate`, OR bad input, OR (see below) any finding at all
 *        while in `report` mode.
 *
 * `--mode report` (the default) never exits 1: a repository dogfoods this
 * checker before its CI is clean enough to gate on, exactly as issue #1259
 * describes for this repository's own adoption sequence. Report mode still
 * exits 2 on a genuine indeterminate (bad input, no workflow files), and
 * still prints every finding -- "report" changes what a CI job does with
 * the exit code, not what the evaluator found. `--mode enforce` maps the
 * verdict straight through 0/1/2.
 */

import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateCiConventions,
  type CiConventionsDeclaration,
  type CiConventionsRuleset,
  type RunnerPricingData,
  type WorkflowFile,
} from "./ci-conventions.js";

const USAGE = `Usage: ci-conventions-check [workflowsDir] --ruleset <path> --declaration <path> [options]

  workflowsDir             Directory of *.yml/*.yaml workflow files. Defaults to ".github/workflows".

Options:
  --ruleset <path>         Required. Path to a CiConventionsRuleset JSON file.
  --declaration <path>     Required. Path to a CiConventionsDeclaration JSON file.
  --pricing <path>         Optional. Path to a RunnerPricingData JSON file (e.g. conventions/data/runner-pricing.json).
  --mode <report|enforce>  Defaults to "report". See exit codes below.
  --out <path>             Also write the JSON envelope to this path.
  --help                   Print this message and exit 0.

Exit codes:
  0 = satisfied
  1 = violated, in --mode enforce only
  2 = indeterminate, bad input, or (in --mode report) any finding at all -- report mode never exits 1
`;

interface ParsedArgs {
  workflowsDir: string;
  rulesetPath?: string;
  declarationPath?: string;
  pricingPath?: string;
  mode: "report" | "enforce";
  outPath?: string;
  help: boolean;
}

class CliInputError extends Error {}

function parseArgs(argv: string[]): ParsedArgs {
  let workflowsDir: string | undefined;
  let rulesetPath: string | undefined;
  let declarationPath: string | undefined;
  let pricingPath: string | undefined;
  let mode: "report" | "enforce" = "report";
  let outPath: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--ruleset": {
        const value = argv[++i];
        if (value === undefined) throw new CliInputError("--ruleset requires a value");
        rulesetPath = value;
        break;
      }
      case "--declaration": {
        const value = argv[++i];
        if (value === undefined) throw new CliInputError("--declaration requires a value");
        declarationPath = value;
        break;
      }
      case "--pricing": {
        const value = argv[++i];
        if (value === undefined) throw new CliInputError("--pricing requires a value");
        pricingPath = value;
        break;
      }
      case "--mode": {
        const value = argv[++i];
        if (value !== "report" && value !== "enforce") {
          throw new CliInputError(`--mode must be "report" or "enforce", got ${JSON.stringify(value)}`);
        }
        mode = value;
        break;
      }
      case "--out": {
        const value = argv[++i];
        if (value === undefined) throw new CliInputError("--out requires a value");
        outPath = value;
        break;
      }
      default:
        if (arg.startsWith("--")) throw new CliInputError(`Unknown option: ${arg}`);
        if (workflowsDir !== undefined) throw new CliInputError(`Unexpected extra argument: ${arg}`);
        workflowsDir = arg;
    }
  }

  return {
    workflowsDir: workflowsDir ?? ".github/workflows",
    rulesetPath,
    declarationPath,
    pricingPath,
    mode,
    outPath,
    help,
  };
}

function readJson<T>(path: string, label: string): T {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new CliInputError(`Could not read ${label} at "${path}": ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new CliInputError(`${label} at "${path}" is not valid JSON: ${(error as Error).message}`);
  }
}

/**
 * `readDir` is where files are actually opened from (absolute, so this
 * works regardless of the caller's cwd); `displayDir` is what `WorkflowFile.
 * path` is built from. They differ on purpose: a declaration's
 * `requiredContextWorkflows` names workflows by their repo-relative path
 * (e.g. ".github/workflows/ci.yml" -- an example of the CALLER's own path;
 * that exact path does not ship with this package -- matching how a
 * repository would write it), and that mapping would never match if `path`
 * carried this machine's absolute filesystem prefix instead.
 */
function readWorkflowFiles(readDir: string, displayDir: string): WorkflowFile[] {
  let entries: string[];
  try {
    entries = readdirSync(readDir);
  } catch (error) {
    throw new CliInputError(`Could not read workflows directory "${readDir}": ${(error as Error).message}`);
  }
  const files: WorkflowFile[] = [];
  for (const entry of entries.sort()) {
    if (!/\.ya?ml$/.test(entry)) continue;
    const full = join(readDir, entry);
    if (!statSync(full).isFile()) continue;
    files.push({ path: `${displayDir}/${entry}`, content: readFileSync(full, "utf8") });
  }
  return files;
}

function ownPackageVersion(): string {
  const here = fileURLToPath(import.meta.url);
  // Mirrors ./documents.ts's own two-hop walk: this module lives two
  // levels below the package root whether compiled (dist/conventions/) or
  // run as source (src/conventions/) via a source-map-aware runner.
  const packageRoot = resolve(here, "..", "..", "..");
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string };
  return manifest.version;
}

function envelopeVerdictExitCode(verdict: "satisfied" | "violated" | "indeterminate", mode: "report" | "enforce"): 0 | 1 | 2 {
  if (verdict === "satisfied") return 0;
  if (verdict === "indeterminate") return 2;
  // violated
  return mode === "enforce" ? 1 : 2;
}

export async function main(argv: string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(error.message);
      console.error(USAGE);
      return 2;
    }
    throw error;
  }

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  try {
    if (!args.rulesetPath) throw new CliInputError("--ruleset is required");
    if (!args.declarationPath) throw new CliInputError("--declaration is required");

    const readDir = isAbsolute(args.workflowsDir) ? args.workflowsDir : resolve(process.cwd(), args.workflowsDir);
    const workflowFiles = readWorkflowFiles(readDir, args.workflowsDir);
    const ruleset = readJson<CiConventionsRuleset>(args.rulesetPath, "ruleset");
    const declaration = readJson<CiConventionsDeclaration>(args.declarationPath, "declaration");
    const pricing = args.pricingPath ? readJson<RunnerPricingData>(args.pricingPath, "pricing") : undefined;

    const envelope = evaluateCiConventions({
      workflowFiles,
      ruleset,
      declaration,
      pricing,
      packageVersion: ownPackageVersion(),
    });

    const json = JSON.stringify(envelope, null, 2);
    console.log(json);
    if (args.outPath) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(args.outPath, `${json}\n`, "utf8");
    }

    if (args.mode === "report" && envelope.verdict === "violated") {
      console.error(
        `ci-conventions-check: report mode -- ${envelope.findings.length} finding(s) printed above, exit code 2 (not 1). Switch --mode enforce once this repository's own gaps are closed or declared as exceptions.`,
      );
    }

    return envelopeVerdictExitCode(envelope.verdict, args.mode);
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(error.message);
      return 2;
    }
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    return 2;
  }
}

/**
 * Both sides MUST be real-path'd before comparing -- see `../gates/cli.ts`'s
 * own `detectMainModule` for the full account. `import.meta.url` is always
 * already a realpath, but `process.argv[1]` is the path exactly as node was
 * invoked with it, and a plain comparison (or `path.resolve`, which only
 * normalises) does not follow symlinks. `npm install` publishes this CLI's
 * `bin` as a SYMLINK at `node_modules/.bin/ci-conventions-check`, so every
 * consumer invoking it the only way it ships hits the mismatch: `main()`
 * never fires, nothing prints, and the process exits 0 having validated
 * nothing. `realpathSync` throws if a path does not exist -- impossible for
 * a module currently executing, but guarded so a throw here falls back to
 * the plain comparison rather than crashing before `main()` is ever reached.
 */
function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
  } catch {
    return resolve(argvPath) === modulePath;
  }
}

if (detectMainModule()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
