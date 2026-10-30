/** Resolved Writer passage copy for the Hero host. No Designer label defaults. */
import type { WriterSectionCopyPorts } from "./copy-ports.js";
import type { SectionRenderInput } from "./group-a-content.js";

export type HeroCopy = WriterSectionCopyPorts["sections.hero"];
export function heroCopyOf(input: SectionRenderInput): HeroCopy {
  const copy = input.sectionHost?.heroCopy;
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) throw new TypeError("sections.hero: heroCopy host port is required");
  const values = copy as Record<string, unknown>;
  for (const key of ["header.heading", "header.eyebrow", "header.description", "actions.primary.label", "actions.secondary.label", "media.title", "media.series[].name"] as const) {
    const value = values[key];
    if ((key === "header.heading" || value !== undefined) && (typeof value !== "string" || !value.trim())) throw new TypeError(`sections.hero: heroCopy.${key} requires resolved nonempty Writer copy`);
  }
  return values as unknown as HeroCopy;
}
