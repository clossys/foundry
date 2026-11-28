/**
 * Incident records and their normalized signature. The signature is what makes the same failure
 * the same text twice: the failing output with every absolute or relative path, git sha, time,
 * duration and number replaced by a placeholder, blank lines dropped, whitespace collapsed and
 * repeated lines kept once, in first-seen order. Two runs of one failure on two machines, at two
 * times, in two scratch trees, give one signature.
 */
import { INCIDENT_SCHEMA, type IncidentRecord } from "./types.js";

/** The most lines a signature keeps: the tail of the output, where a failure reports itself. */
export const SIGNATURE_LINES = 40;

const ISO_TIME = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
const CLOCK = /\b\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\b/g;
const DURATION = /\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|m|min|mins|minutes|h|hours)\b/g;
// A path: a run of path characters with at least one slash that starts at a root, a home, a dot
// or a drive letter, or a relative path of two or more segments ending in a file name.
// A trailing `:line` or `:line:column` belongs to the path.
const ABSOLUTE_PATH = /(?<![\w.@-])(?:[A-Za-z]:\\|~\/|\/)[^\s'"`:,;()<>]*[/\\][^\s'"`:,;()<>]*(?::\d+){0,2}/g;
const RELATIVE_PATH = /\b(?:\.{1,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]+\b(?::\d+){0,2}/g;
const SHA = /\b[0-9a-f]{7,64}\b/g;
// A bare number (a count, a pid, a line:column); a number inside a word or an id (`r2f`, `cp1`, `h1`) is kept.
const NUMBER = /(?<![A-Za-z_\d.])\d+(?:\.\d+)?(?![A-Za-z_\d])/g;

/** One line, normalized. Order matters: times before numbers, paths before shas. */
export function normalizeLine(line: string): string {
  return line
    .replace(ISO_TIME, "<time>")
    .replace(CLOCK, "<time>")
    .replace(DURATION, "<duration>")
    .replace(ABSOLUTE_PATH, "<path>")
    .replace(RELATIVE_PATH, "<path>")
    .replace(SHA, match => (/[a-f]/.test(match) && /\d/.test(match) ? "<sha>" : match))
    .replace(NUMBER, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/** The normalized signature of a failing output: stable text, no paths, shas, times or numbers. */
export function normalizeSignature(output: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = normalizeLine(raw);
    if (line === "" || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.slice(-SIGNATURE_LINES).join("\n");
}

/** Builds the one fixed-form record a failing verb or check writes. */
export function incidentRecord(input: { stage: string; command: string; exit: number; output: string; at?: Date | string }): IncidentRecord {
  const at = input.at === undefined ? new Date().toISOString() : typeof input.at === "string" ? input.at : input.at.toISOString();
  return Object.freeze({
    schema: INCIDENT_SCHEMA,
    stage: input.stage,
    command: input.command,
    exit: input.exit,
    signature: normalizeSignature(input.output),
    at,
  });
}

/** Findings for a value read as a record; empty when it is one. */
export function recordFindings(value: unknown): string[] {
  const out: string[] = [];
  const record = value as Partial<IncidentRecord> | null;
  if (!record || typeof record !== "object") return ["an incident record is a JSON object"];
  if (record.schema !== INCIDENT_SCHEMA) out.push(`schema must be ${INCIDENT_SCHEMA}`);
  for (const key of ["stage", "command", "signature", "at"] as const) if (typeof record[key] !== "string") out.push(`${key} must be a string`);
  if (!Number.isInteger(record.exit)) out.push("exit must be an integer");
  if (typeof record.at === "string" && Number.isNaN(Date.parse(record.at))) out.push("at must be an ISO 8601 time");
  return out;
}
