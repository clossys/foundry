/** @vitest-environment node */
/** Source-local inspection only: selected emitted closure remains blocked. */
import { describe, it, expect } from "vitest";
import { transform } from "esbuild";
import { loadComponentCompositionRules } from "../catalog-core/component-compositions.js";
import { productionCompositionFixture } from "../catalog-core/__fixtures__/date-picker-composition.js";
import { assertComponentImportClosure } from "../catalog-core/emit-components.js";
import { sha256 } from "../catalog-core/digest.js";

describe("stored production DatePicker source protocol", () => {
  it("parses both forwarded roots from the single receipted source with child-owned glyph trigger", async () => {
    const rule = loadComponentCompositionRules()[0]!;
    const file = rule.files.find(file => file.path === rule.template.impl.entry)!;
    const output = await transform(file.content, { loader: "tsx", format: "esm" });
    expect(output.code).toContain("DateRangePicker");
    expect(file.content.match(/ref=\{ref\}/g)).toHaveLength(2);
    expect(file.content).toContain('slot="start"'); expect(file.content).toContain('slot="end"');
    expect(file.content).toContain('selection="range"'); expect(file.content).toContain('selection="single"');
    expect(file.content).toContain('pickerTrigger={{ label: triggerLabel');
    expect(file.content).toContain('glyphs["assets.icon-date"]');
    expect(file.content).not.toMatch(/<svg|--[a-z]|buttonVariants|PopoverContent/);
    expect(rule.template.reads.tokens).toEqual([]);
    expect(rule.template.composes).toHaveLength(3);
    expect(rule.template.outputSha256).toContainEqual({ path: file.path, sha256: sha256(file.content) });
  });
  it("retains the actual missing selected facade after Calendar syntax normalization", () => {
    const { library } = productionCompositionFixture();
    const calendarFile = library.files.find(file => file.path.endsWith("calendar.tsx"))!;
    expect(() => assertComponentImportClosure([calendarFile, ...library.files.filter(file => file !== calendarFile)], {})).toThrow("components: missing import ../icon/index.js");
    const calendar = library.files.find(file => file.path.endsWith("calendar.tsx"))!.content;
    expect(calendar).not.toContain("buttonVariants");
    expect(calendar).toContain("SelectTrigger");
    expect(calendar).toContain('import { forwardRef as ReactForwardRef } from "react"');
  });
});
