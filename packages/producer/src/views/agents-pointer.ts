/**
 * The agent-neutral pointer `clossys init` adds to the consumer's `AGENTS.md` (system.md 14.9): any chat agent that
 * reads the file learns to show clossys state through the view prompts and to write answers back only through
 * `clossys answer`. Added once: a second run finds the marker and changes nothing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const POINTER_START = "<!-- clossys:views -->";
export const POINTER_END = "<!-- /clossys:views -->";

export const AGENTS_POINTER = [
  POINTER_START,
  "## Clossys views",
  "",
  "To show clossys state, run `clossys views list`, then follow `clossys views show <id>` for the view that fits.",
  "Read the workspace only through `clossys status`, `clossys slot`, `clossys render` and `clossys preview`.",
  "Answers go back only through `clossys answer`, with the owner's words in `--quote`.",
  POINTER_END,
].join("\n");

export interface PointerResult {
  readonly file: string;
  /** "added" when the block was written, "present" when the file already had it. */
  readonly outcome: "added" | "present";
}

/** Appends the pointer block to `<root>/AGENTS.md` (created when missing) unless the block is already there. */
export function ensureAgentsPointer(root: string): PointerResult {
  const file = join(root, "AGENTS.md");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.includes(POINTER_START)) return { file, outcome: "present" };
  const separator = current === "" ? "" : current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(file, `${current}${separator}${AGENTS_POINTER}\n`);
  return { file, outcome: "added" };
}
