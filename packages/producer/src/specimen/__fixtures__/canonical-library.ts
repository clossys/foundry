/**
 * Flat Designer slot fixtures (`agents/designer/<slot-id>/{slot.json,candidates/,pin.json}`).
 * `designer-slots/` holds the IA's slot documents every fixture shares; each fixture adds its
 * own `ia.json`, pinned candidates and extension slots on top.
 */
import { cpSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = (name: string) => fileURLToPath(new URL(`./${name}/`, import.meta.url));

/** A consumer folder holding the canonical Designer fixture: a theme preset, a button and a card. */
export async function canonicalLibrary(consumer: string): Promise<string> {
  const designer = join(consumer, "agents", "designer");
  mkdirSync(designer, { recursive: true });
  cpSync(fixture("designer-slots"), designer, { recursive: true });
  cpSync(fixture("canonical-designer"), designer, { recursive: true });
  return realpathSync(consumer);
}

/** Fill in the shared Designer slot documents a fixture consumer's own pins sit beside. */
export async function withDesignerSlots(consumer: string): Promise<void> {
  const designer = join(consumer, "agents", "designer");
  mkdirSync(designer, { recursive: true });
  cpSync(fixture("designer-slots"), designer, { recursive: true, force: false });
}
