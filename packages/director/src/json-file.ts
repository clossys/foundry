/**
 * `readJsonFile` — read, parse, and validate one JSON record file, reporting
 * failure as a typed read issue instead of throwing. Failures distinguish
 * unreadable files, unparseable JSON and invalid schema data.
 */

import { readFileSync } from "node:fs";
import { summarizeIssues, type Validator } from "./validation.js";

interface JsonFileIssue {
  file: string;
  reason: "unreadable" | "unparseable" | "invalid-schema";
  detail: string;
}

export function readJsonFile<T>(
  path: string,
  relLabel: string,
  validate: Validator<T>,
): { ok: true; value: T } | { ok: false; issue: JsonFileIssue } {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      ok: false,
      issue: { file: relLabel, reason: "unreadable", detail: error instanceof Error ? error.message : String(error) },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      issue: { file: relLabel, reason: "unparseable", detail: error instanceof Error ? error.message : String(error) },
    };
  }
  const result = validate(parsed);
  if (!result.ok) {
    return { ok: false, issue: { file: relLabel, reason: "invalid-schema", detail: summarizeIssues(result.issues) } };
  }
  return { ok: true, value: result.value };
}
