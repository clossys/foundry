import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, VERBS } from "../cli/args.js";
import type { Step } from "./define.js";

/** This package's root, in the source tree (src/pipeline) and in the build (dist/pipeline). */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const SHARED_PARSER = "src/cli/args.ts";

export interface CliOption {
  readonly flag: string;
  /** true: takes a value; false: a switch; null: the verb's own parser decides. */
  readonly value: boolean | null;
}

/** The flags a parser module defines, read from its own `case "--x"` / `=== "--x"` branches. */
export function parserFlags(parser: string, packageRoot = PACKAGE_ROOT): string[] {
  const file = join(packageRoot, parser);
  if (!existsSync(file)) return [];
  const flags = [...readFileSync(file, "utf8").matchAll(/(?:case\s+|===\s*)["'](--[a-z][a-z0-9-]*)["']/g)].map(match => match[1]!);
  return [...new Set(flags)].sort();
}

const message = (run: () => unknown): string | null => {
  try { run(); return null; } catch (error) { return error instanceof Error ? error.message : String(error); }
};

/**
 * Options of one CLI step, from the actual parser: the shared parser is probed so a flag
 * that requires another verb is left out; a verb with its own parser lists its flags.
 */
export function stepOptions(step: Step, packageRoot = PACKAGE_ROOT): CliOption[] | null {
  const cli = step.command.cli;
  if (!cli) return null;
  if (cli.parser) return parserFlags(cli.parser, packageRoot).map(flag => ({ flag, value: null }));
  // A verb the shared parser does not know yet (a pending step) has no options here.
  if (!(VERBS as readonly string[]).includes(cli.verb)) return null;
  const base = [cli.verb, ...(cli.flags ?? [])];
  const options: CliOption[] = [];
  for (const flag of parserFlags(SHARED_PARSER, packageRoot)) {
    if (cli.flags?.includes(flag)) continue;
    const bare = message(() => parseArgs([...base, flag]));
    const value = bare !== null && bare.startsWith(`${flag} requires a value`);
    const error = value ? message(() => parseArgs([...base, flag, "1"])) : bare;
    if (error !== null && error.includes(flag)) {
      const required = /requires?\s+(.+)$/.exec(error)?.[1] ?? "";
      const verbs = required.split(/[\s,]+/).filter(word => (VERBS as readonly string[]).includes(word));
      if (verbs.length && !verbs.includes(cli.verb)) continue;
      if (/mutually exclusive|not both/.test(error) && cli.flags?.some(own => error.includes(own))) continue;
    }
    options.push({ flag, value });
  }
  return options;
}
