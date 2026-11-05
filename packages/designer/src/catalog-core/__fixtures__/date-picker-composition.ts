/** Real selected descriptors/bytes. Remaining rewrite/runtime findings are retained. */
import slots from "../../catalog/slots/components.json" with { type: "json" };
import dateField from "../../catalog/fills/foundry/components.date-field.json" with { type: "json" };
import button from "../../catalog/fills/foundry/components.button.json" with { type: "json" };
import icon from "../../catalog/fills/foundry/components.icon.json" with { type: "json" };
import calendar from "../../catalog/fills/shadcn@aria/components.calendar.json" with { type: "json" };
import select from "../../catalog/fills/shadcn@aria/components.select.json" with { type: "json" };
import popover from "../../catalog/fills/shadcn@aria/components.popover.json" with { type: "json" };
import calendarBytes from "../../importers/__fixtures__/shadcn-aria/calendar.golden.json" with { type: "json" };
import selectBytes from "../../importers/__fixtures__/shadcn-aria/select.golden.json" with { type: "json" };
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { importShadcnAriaComponents } from "../../importers/shadcn-aria-components.js";
import { loadComponentCompositionRules } from "../component-compositions.js";
import { componentOf } from "../resolve-components.js";
import type { ComponentCandidateDocument, ComponentDocument, ComponentFile, ComponentLibrary } from "../resolve-components.js";
import type { ComponentSlot } from "../types.js";
export function productionCompositionFixture() {
  const source = { id: "consumer", kind: "consumer" as const, author: "consumer" as const, license: "MIT" };
  const candidates = structuredClone([dateField, button, icon, calendar, select, popover]) as unknown as ComponentCandidateDocument[];
  const fills = candidates.map(doc => {
    const fill = componentOf(doc); fill.source = source.id;
    doc.$extensions["com.clossys.fill"].source = source.id;
    return { ...doc, components: { [fill.slot.slice(11)]: { ...fill, origin: { kind: "authored", license: "MIT" } } } } as ComponentDocument;
  });
  const directory = resolve(import.meta.dirname, "../../importers/__fixtures__/shadcn-aria");
  const read = (name: string) => readFileSync(resolve(directory, name), "utf8");
  const imported = importShadcnAriaComponents({
    items: readdirSync(directory).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") },
    notice: { path: "LICENSE.md", content: read("LICENSE.md") },
  });
  const popoverBytes = imported.rewrites.popover!;
  const paths = new Map<string, ComponentFile>();
  for (const file of [...calendarBytes.files, ...selectBytes.files, ...popoverBytes.files]) {
    const previous = paths.get(file.path);
    if (previous && previous.content !== file.content) throw new Error("conflicting selected bytes");
    paths.set(file.path, file);
  }
  const library: ComponentLibrary = { source, fills, files: [...paths.values()] };
  return { library, catalog: { slots: slots as unknown as ComponentSlot[], fills: candidates, rules: loadComponentCompositionRules() } };
}
