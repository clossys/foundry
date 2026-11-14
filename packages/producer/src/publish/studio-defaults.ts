/**
 * The Studio publication's package defaults (SOURCE-MIGRATE step 6). The Studio publication is this
 * package's own: its Writer declarations (the page meta and section field bindings of the Studio
 * pages to `studio.*` copy records) ship as src/studio-defaults/writer-declarations.json, not in a
 * consumer's Writer store. A consumer's own agents/writer/declarations.json still wins; the package
 * default applies only to a consumer that places the Studio publication (`publication.studio`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCER_ROOT } from "../package-path.js";
import { readAgentFile, readIa } from "../records/slots.js";

export const STUDIO_PUBLICATION_SLOT = "publication.studio";
export const STUDIO_WRITER_DECLARATIONS = join(PRODUCER_ROOT, "src", "studio-defaults", "writer-declarations.json");

/** Whether the consumer's Publisher IA places the Studio publication. */
export function placesStudioPublication(consumer: string): boolean {
  const ia = readIa(consumer, "publisher");
  return !!ia && ia.nodes.some(node => node.children.some(group => group.slots.includes(STUDIO_PUBLICATION_SLOT)));
}

/** The Writer declarations text a consumer publishes with: its own file, else the Studio package default, else none. */
export function writerDeclarationsText(consumer: string): string | undefined {
  const own = readAgentFile(consumer, "writer", "declarations.json");
  if (own !== undefined) return own;
  return placesStudioPublication(consumer) ? readFileSync(STUDIO_WRITER_DECLARATIONS, "utf8") : undefined;
}
