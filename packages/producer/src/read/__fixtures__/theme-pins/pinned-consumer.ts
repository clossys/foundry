/**
 * The int2 fixture consumer (`test-fixtures/consumer`) pins its own `themes.*` slots (the fixture world, 97d2ec8bc).
 * `unpinnedConsumer` copies its Designer slots into a temp root without those theme pins, so the package default can be
 * proved; `pinnedConsumer` then pins two of them, one `registry:theme` item and one `registry:font` item, so the
 * projection can be proved against a consumer pin.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flatConsumer } from "../../../cli/__fixtures__/flat-consumer.js";

export const PINNED_CANDIDATES: Record<string, { name: string; item: Record<string, unknown> }> = {
  "themes.primary": {
    name: "primary-v1.json",
    item: { name: "tally-primary", type: "registry:theme", cssVars: { theme: { radius: "0.5rem" }, light: { primary: "oklch(0.45 0.09 160)", "primary-foreground": "oklch(0.985 0 0)" }, dark: { primary: "oklch(0.78 0.11 160)" } } },
  },
  "themes.font-sans": {
    name: "font-sans-v1.json",
    item: { name: "tally-sans", type: "registry:font", font: { family: "\"Inter\", sans-serif", variable: "--font-sans" } },
  },
};

export const candidateBytes = (item: Record<string, unknown>) => `${JSON.stringify(item, null, 2)}\n`;

/** A temp consumer with the int2 Designer slots and none of their `themes.*` pins. */
export function unpinnedConsumer(): string {
  const root = flatConsumer(["designer"]);
  const designer = join(root, "clossys", "agents", "designer");
  for (const slot of readdirSync(designer)) {
    const pin = join(designer, slot, "pin.json");
    if (slot.startsWith("themes.") && existsSync(pin)) unlinkSync(pin);
  }
  return root;
}

/** A temp consumer with the int2 Designer slots, no fixture theme pin, and the two pins above. */
export function pinnedConsumer(): string {
  const root = unpinnedConsumer();
  for (const [slot, { name, item }] of Object.entries(PINNED_CANDIDATES)) {
    const dir = join(root, "clossys", "agents", "designer", slot);
    mkdirSync(join(dir, "candidates"), { recursive: true });
    const bytes = candidateBytes(item);
    writeFileSync(join(dir, "candidates", name), bytes);
    const sha256 = createHash("sha256").update(bytes, "utf8").digest("hex");
    writeFileSync(join(dir, "pin.json"), `${JSON.stringify({ candidate: name, sha256, decidedBy: "planner", basis: "planner", at: "2026-11-14T00:00:00Z" }, null, 2)}\n`);
  }
  return root;
}
