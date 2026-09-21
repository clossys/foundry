#!/usr/bin/env node
/**
 * `designer-hero-css-check` — fails when a built stylesheet is missing the
 * utility rules `Hero` and primary `Button` need. Same three-state exit
 * contract as `designer-token-check` / `designer-environment-check`.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkHeroCss, HERO_BUTTON_REQUIRED_UTILITIES } from "./check-hero-css.js";

const USAGE = `Usage: designer-hero-css-check <built-css-file>

  built-css-file   Path to a compiled CSS file (your Tailwind output after
                   importing @clossys/designer/theme.css and @source on dist).

Options:
  --help           Print this message and exit 0.

Required utility rules (from Hero + primary Button): ${HERO_BUTTON_REQUIRED_UTILITIES.join(", ")}.

Exit codes: 0 = every required utility is present, 1 = at least one missing, 2 = could not run (bad input or unreadable file).
`;

export class CliInputError extends Error {}

interface ParsedArgs {
  cssFile?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let cssFile: string | undefined;
  let help = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) throw new CliInputError(`unknown flag "${arg}"`);
    if (cssFile === undefined) cssFile = arg;
    else throw new CliInputError(`unexpected extra argument "${arg}"`);
  }
  return { cssFile, help };
}

function requireFile(label: string, path: string): void {
  if (!existsSync(path)) throw new CliInputError(`${label} "${path}" does not exist`);
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new CliInputError(`cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) throw new CliInputError(`${label} "${path}" is not a file`);
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.cssFile) throw new CliInputError("built-css-file is required");

  const path = resolve(args.cssFile);
  requireFile("built-css-file", path);

  let css: string;
  try {
    css = readFileSync(path, "utf8");
  } catch (error) {
    console.error(`Could not read "${path}": ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  console.log(`Stylesheet: ${path}`);
  const result = checkHeroCss(css);
  console.log(`${result.utilitiesChecked} required utility rule(s) checked.`);

  if (result.findings.length === 0) {
    console.log("Hero/Button utility coverage: satisfied.");
    return 0;
  }

  console.log(`\n${result.findings.length} finding(s):`);
  for (const f of result.findings) console.log(`  [${f.rule}] ${f.utility}  ${f.message}`);
  return 1;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`designer-hero-css-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(
        `designer-hero-css-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      process.exitCode = 2;
    }
  }
}

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
  run();
}
