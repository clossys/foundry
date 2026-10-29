import { parseFinding } from "./format/finding.js";
import type { Finding } from "./format/types.js";

/** Parses the complete Markdown finding registry without filesystem access. */
export function readFindings(input: { files: Readonly<Record<string, string>> }): {
  findings: Finding[]; issues: { file: string; line: number; detail: string }[]; complete: boolean;
} {
  const findings: Finding[] = []; const issues: { file: string; line: number; detail: string }[] = [];
  const ids = new Set<string>();
  for (const [file, raw] of Object.entries(input.files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.md$/.test(file)) {
      issues.push({ file, line: 1, detail: "Expected a finding-id.md leaf" }); continue;
    }
    const result = parseFinding(raw, file);
    if (!result.ok) { issues.push(...result.issues.map(i => ({ file, line: i.line, detail: i.message }))); continue; }
    if (result.value.id !== file.slice(0, -3) || ids.has(result.value.id)) {
      issues.push({ file, line: 1, detail: "Finding id must be unique and match its filename" }); continue;
    }
    ids.add(result.value.id); findings.push(result.value);
  }
  if (!Object.keys(input.files).length) issues.push({ file: "(directory)", line: 1, detail: "No findings to read" });
  return { findings, issues, complete: issues.length === 0 };
}
