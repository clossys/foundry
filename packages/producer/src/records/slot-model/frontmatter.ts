/**
 * Candidate `.md` frontmatter. Each line is `key: <JSON value>`; JSON is a YAML
 * subset, so the block stays YAML while parsing stays exact and deterministic.
 */
export interface MdDocument { readonly fields: Readonly<Record<string, unknown>>; readonly body: string }

export function serializeFrontmatter(fields: Readonly<Record<string, unknown>>, body: string): string {
  const lines = Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join("\n")}\n---\n${body.startsWith("\n") ? body : `\n${body}`}`;
}

export function parseFrontmatter(source: string): { ok: true; value: MdDocument } | { ok: false; message: string } {
  if (!source.startsWith("---\n")) return { ok: false, message: "expected frontmatter opening ---" };
  const end = source.indexOf("\n---\n", 3);
  if (end < 0) return { ok: false, message: "expected frontmatter closing ---" };
  const fields: Record<string, unknown> = {};
  for (const line of source.slice(4, end).split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*): (.*)$/.exec(line);
    if (!match) return { ok: false, message: `invalid frontmatter line "${line}"` };
    if (Object.hasOwn(fields, match[1]!)) return { ok: false, message: `duplicate frontmatter key ${match[1]}` };
    try { fields[match[1]!] = JSON.parse(match[2]!); } catch { return { ok: false, message: `frontmatter ${match[1]} is not a JSON value` }; }
  }
  return { ok: true, value: { fields, body: source.slice(end + 5) } };
}
