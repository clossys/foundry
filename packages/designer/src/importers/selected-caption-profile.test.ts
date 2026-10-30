// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { componentSecondaryExports } from "../catalog-core/component-secondary-exports.js";
import { sha256 } from "../catalog-core/digest.js";
import { rewriteShadcnAria } from "./rewrite.js";
import { selectedCaptionSource } from "./selected-caption-profile.js";
import { importShadcnAriaComponents, SHADCN_COMPONENT_ITEMS, materializeShadcnComponent, type ShadcnComponentInput } from "./shadcn-aria-components.js";
const fixture = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const read = (name: string) => readFileSync(resolve(fixture, name), "utf8");
function input(): ShadcnComponentInput {
  return { items: readdirSync(fixture).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"), styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } };
}
const result = () => importShadcnAriaComponents(input());
const entry = (item: "select" | "calendar") => result().rewrites[item]!.files.find(file => file.path === `components/${item}/${item}.tsx`)!.content;
describe("selected caption source prerequisite; runtime profile remains unavailable", () => {
  it("maps each Select member to the real root and preserves both Calendar roots", () => {
    const fills = result().fills;
    expect(fills.find(doc => doc.components.select)!.components.select!.propMap).toEqual({ "selection.single": "Select.selectionMode=single", "size.sm": "Select.size=sm", "size.md": "Select.size=md", "size.lg": "Select.size=lg", "state.invalid": "Select.isInvalid=true" });
    expect(fills.find(doc => doc.components.calendar)!.components.calendar!.propMap).toEqual({ "selection.single": "Calendar", "selection.range": "RangeCalendar" });
  });
  it("makes root size optional/default md and consumes it before forwarding props", () => {
    const code = entry("select");
    expect(code).toContain('size = "md"');
    expect(code).toContain('size?: "sm" | "md" | "lg"');
    expect(code).toContain('data-size={size}');
    expect(code).toContain('composeRenderProps(className, (className) => cn("group/select w-fit", className))');
    const ast = ts.createSourceFile("select.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const root = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "Select") as ts.FunctionDeclaration;
    expect(root.parameters[0]!.name.getText(ast)).toContain('size = "md"');
    expect(root.getText(ast)).toContain('{...props}');
    expect(root.getText(ast)).not.toContain("useState");
    expect(root.getText(ast)).not.toContain("cloneElement");
  });
  it("inherits root geometry only without an explicit Calendar trigger size", () => {
    const code = entry("select"), trigger = code.slice(code.indexOf("function SelectTrigger("), code.indexOf("function SelectContent("));
    expect(trigger).not.toContain('size = "default"');
    expect(trigger).toContain('group-data-[size=sm]/select:not-data-[size]:h-(--ui-control-h-sm,calc(var(--spacing)*7))');
    expect(trigger).toContain('group-data-[size=lg]/select:not-data-[size]:h-(--ui-control-h-lg,calc(var(--spacing)*9))');
    expect(trigger).toContain('data-[size=sm]:h-(--ui-control-h-sm,calc(var(--spacing)*7))');
    expect(trigger).toContain('data-[size=lg]:h-(--ui-control-h-lg)');
    expect(trigger).toContain('data-[size=default]:h-(--ui-control-h-md,calc(var(--spacing)*8))');
    expect(trigger).toContain('className={composeRenderProps(className, (className) => cn(');
    expect(entry("calendar")).toContain("<SelectTrigger>");
  });
  it.each([["select", 0], ["calendar", 0]] as const)("records actual exact %s K4 tuples after approved bindings (%i), independently of runtime observations", (item, count) => {
    const upstream = input(), source = upstream.items.find(row => row.name === item)!.files[0]!;
    const privateFiles = item === "select" ? [{ path: "components/_parts/input-group/input-group.tsx", content: upstream.items.find(row => row.name === "input-group")!.files[0]!.content }] : [];
    const baseline = rewriteShadcnAria({ item, leaf: item, files: [source, ...privateFiles], styles: upstream.styles.content, leafByItem: SHADCN_COMPONENT_ITEMS });
    const tuples = baseline.issues.filter(issue => issue.code === "K4");
    expect(tuples).toHaveLength(count);
    const imported = result();
    expect(imported.rewrites[item]!.issues.filter(issue => issue.code === "K4")).toEqual(tuples);
    expect(materializeShadcnComponent(imported, item)).toEqual(imported.rewrites[item]!.files);
  });
  it("leaves upstream pin, dependency claims, findings and unavailable observations honest", () => {
    const imported = result();
    for (const item of ["select", "calendar"] as const) {
      const fill = imported.fills.find(doc => doc.components[item])!, descriptor = fill.components[item]!;
      const raw = input().items.find(row => row.name === item)!.files[0]!;
      expect(descriptor.pin!.files).toContainEqual({ path: raw.path, sha256: sha256(raw.content) });
      expect(descriptor.deps).toContainEqual({ name: "react", version: "19.2.3", license: "MIT" });
      expect(descriptor.rac).toBeUndefined();
      // API-S1 approves exactly five Select parts (proved in shadcn-aria-components.test.ts); Calendar approves none.
      if (item === "calendar") expect(descriptor).not.toHaveProperty("secondaryExports");
      expect(descriptor).not.toHaveProperty("measurements");
      expect(fill.$extensions["com.clossys.fill"].status).toBe("draft");
      expect(fill.$extensions["com.clossys.fill"].evidence).toEqual([]);
    }
    expect(imported.rewrites.select!.reads.assets).toContain("assets.icon-search");
  });
  it("refuses a stale normalized source receipt instead of guessing an adapter", () => {
    expect(() => selectedCaptionSource({ path: "components/select/select.tsx", content: entry("select") })).toThrow(/receipt differs/);
    expect(() => selectedCaptionSource({ path: "components/calendar/calendar.tsx", content: entry("calendar") + " " })).toThrow(/receipt differs/);
  });
  it("fits the unchanged G1 concrete same-entry proof without approving real secondaries", () => {
    const imported = result(), fill = imported.fills.find(doc => doc.components.select)!.components.select!;
    const names = ["SelectContent", "SelectGroup", "SelectItem", "SelectTrigger", "SelectValue"];
    expect(componentSecondaryExports({ ...fill, secondaryExports: names.map(name => ({ name, export: name })) }, imported.rewrites.select!.files).map(row => row.name)).toEqual(names);
  });
});
