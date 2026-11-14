/** Certification test support: candidate builders for fixture workspaces. Test support only. */

/** A Writer strings candidate in the slot-body format: `## <locale>` then one text record per key. */
export function writerText(slot: string, keys: Record<string, string>, locales = ["en"]): string {
  const records = () => Object.entries(keys).map(([id, text]) => `### ${id}\n<!-- {"id":"${id}","bindings":[]} -->\n${text}\n`).join("\n");
  return `---\nslot: "${slot}"\nlocales: ${JSON.stringify(locales)}\nsource: {"kind":"original","ref":[]}\n---\n\n${locales.map(locale => `## ${locale}\n\n${records()}`).join("\n")}`;
}

/** The headings every Director brief body carries (slot-model validate.ts). */
export const BRIEF_HEADINGS = ["Direction", "Because", "Watch"];
/** A Director brief candidate: frontmatter, then the three brief sections. */
export function briefText(slot: string, direction = "Calm and plain."): string {
  return `---\nslot: "${slot}"\nsource: {"kind":"original","ref":[]}\nfeeds: []\nfunctions: []\n---\n\n## Direction\n\n${direction}\n\n## Because\n\nThe owner asked for it.\n\n## Watch\n\nHype.\n`;
}

/** A Publisher page candidate (clossys.page/1). */
export function pageItem(path: string, sections: string[], copy: Record<string, string>): Record<string, unknown> {
  return { schema: "clossys.page/1", path, title: "Home", frame: null, sections, copy, meta: { source: { kind: "original", ref: [] } } };
}

/** A Designer registry item shipping `file` with `code`; an original unless `extra.meta.source` says otherwise. */
export function elementItem(file: string, code: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const meta = { source: { kind: "original", ref: [] }, ...(extra.meta as Record<string, unknown> | undefined) };
  return { name: file.replace(/^.*\/|\.tsx$/g, ""), type: "registry:ui", files: [{ path: file, type: "registry:ui", content: code }], ...extra, meta };
}
export const LABEL = "export function Example({ label }: { label: string }) { return <button type=\"button\">{label}</button>; }\n";
