/** Pure write helpers. Locking, staging, rollback and file access belong to the injected store writer. */
import type { DirectorStoreChange } from "../store-io.js";

export type Change = DirectorStoreChange;
/** Edit only frontmatter metadata; leave the body's bytes and line endings intact. */
export function metadata(text: string, fields: Record<string, string | undefined>): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(text);
  if (!match) throw new Error("Cell frontmatter is missing");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let lines = match[1]!.split(/\r?\n/);
  for (const [key, value] of Object.entries(fields)) {
    const i = lines.findIndex(line => line.startsWith(`${key}:`));
    if (value === undefined) { if (i !== -1) lines.splice(i, 1); }
    else if (i === -1) lines.push(`${key}: ${value}`);
    else lines[i] = `${key}: ${value}`;
  }
  return ["---", ...lines, "---"].join(newline) + text.slice(match[0].length);
}
