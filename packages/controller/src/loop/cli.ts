/** CLI for rendering one role's `STATUS document` from its own `loop.json`. Presentation only: every decision lives in the pure modules this delegates to. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderLoopStatus } from "./status.js";
import { validateLoopState } from "./state.js";
import type { LoopState } from "./types.js";

const USAGE = `Usage: foundry-loop-status <loop.json> <mandate.txt> [--out <STATUS document path>]

Renders a role's STATUS document from its own clossys/<role>/loop.json and a plain-text
mandate (read verbatim from clossys/brief.json's own statement of why this role is
here). Prints the rendered document to stdout; --out also writes it to a file.

Exit codes: 0 = rendered, 2 = the loop.json document is unreadable or malformed.`;

function readText(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  const positional = argv.filter((value, index) => !value.startsWith("--") && argv[index - 1] !== "--out");
  if (positional.length !== 2) {
    console.error(USAGE);
    return 2;
  }
  try {
    const parsed: unknown = JSON.parse(readText(positional[0] as string));
    const findings = validateLoopState(parsed);
    if (findings.length > 0) {
      console.error(`foundry-loop-status: ${positional[0]} is not a valid loop.json document:`);
      for (const finding of findings) console.error(`  [${finding.rule}] ${finding.path}: ${finding.message}`);
      return 2;
    }
    const state = parsed as LoopState;
    const mandate = readText(positional[1] as string);
    const rendered = renderLoopStatus(state.role, state, mandate);
    const outPath = option(argv, "--out");
    if (outPath !== undefined) writeFileSync(resolve(outPath), rendered.endsWith("\n") ? rendered : `${rendered}\n`);
    console.log(rendered);
    return 0;
  } catch (error) {
    console.error(`foundry-loop-status: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
