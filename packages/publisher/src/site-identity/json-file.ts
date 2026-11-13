import { readFileSync } from "node:fs";
export interface SiteIdentityReadIssue { file: string; reason: "unreadable" | "unparseable" | "invalid-schema"; detail: string }
import { summarizeIssues, type Validator } from "./validation.js";

export function readJsonFile<T>(
  path: string,
  relLabel: string,
  validate: Validator<T>,
): { ok: true; value: T } | { ok: false; issue: SiteIdentityReadIssue } {
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
