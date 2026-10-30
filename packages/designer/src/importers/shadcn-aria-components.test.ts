// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as digest from "../catalog-core/digest.js";
import { sha256 } from "../catalog-core/digest.js";
import { rewriteShadcnAria } from "./rewrite.js";
import slots from "../catalog/slots/components.json" with { type: "json" };
import type { ComponentSlot } from "../catalog-core/types.js";
import { componentSecondaryExports } from "../catalog-core/component-secondary-exports.js";
import { bindSiblingLeafModules, generatedShadcnComponentFiles, importShadcnAriaComponents, materializeShadcnComponent, SHADCN_ARIA_COMPONENT_PIN, SHADCN_COMPONENT_ITEMS, verifyShadcnSource, type ShadcnComponentInput } from "./shadcn-aria-components.js";

const here = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const read = (name: string): string => readFileSync(resolve(here, name), "utf8");
export function pinnedInput(): ShadcnComponentInput {
  return { items: readdirSync(here).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } };
}

describe("pinned shadcn aria component import", () => {
  it("does not rehash shared upstream pin bytes for every produced fill", () => {
    const input = pinnedInput();
    const upstream = new Map([...input.items.flatMap(item => item.files), input.styles, input.notice].map(file => [file.path, file.content]));
    const hash = vi.spyOn(digest, "sha256");
    try {
      const observe = () => {
        hash.mockClear();
        const result = importShadcnAriaComponents(input);
        const styleCalls = hash.mock.calls.filter(([content]) => content === input.styles.content).length;
        const styleReferences = result.fills.filter(doc => Object.values(doc.components)[0]!.pin!.files!.some(file => file.path === input.styles.path)).length;
        expect(styleCalls).toBeGreaterThan(1); // Original verification and current-content pin hashing both run.
        expect(styleCalls).toBeLessThan(styleReferences);
        for (const doc of result.fills) for (const file of Object.values(doc.components)[0]!.pin!.files!) {
          expect(file.sha256, file.path).toBe(createHash("sha256").update(upstream.get(file.path)!).digest("hex"));
        }
        return { result, styleCalls, calls: hash.mock.calls.length };
      };
      const first = observe();
      const second = observe();
      expect(second.result).toEqual(first.result);
      expect(second.styleCalls).toBe(first.styleCalls);
      expect(second.calls).toBe(first.calls);
    } finally { hash.mockRestore(); }
  });
  it("rechecks current bytes at the same paths after a successful import", () => {
    for (const kind of ["source", "styles", "notice"] as const) {
      const input = pinnedInput();
      const file = kind === "source" ? input.items.find(item => item.name === "button")!.files[0]! : input[kind];
      importShadcnAriaComponents(input);
      const content = file.content;
      file.content += " ";
      expect(() => importShadcnAriaComponents(input), kind).toThrow(/sha256 mismatch/);
      expect(() => verifyShadcnSource(file), kind).toThrow(/sha256 mismatch/);
      file.content = content;
      expect(() => verifyShadcnSource(file), kind).not.toThrow();
    }
  });
  it("binds a sibling's own module only for sub-parts, keeps contract-only and Icon imports on the entrypoint, refuses an ambiguous leaf", () => {
    const leafByItem = { button: "button", select: "select", toggle: "toggle-button", input: "text-field", textarea: "text-field" };
    const source = 'import { Button } from "../button/index"\nimport {\n  Select,\n  SelectContent,\n} from "../select/index"\nimport { Icon as LibraryIcon } from "../icon/index"\nimport { cn } from "../_parts/utils/index"\nimport { Button as Deep, buttonVariants } from "../../button/index"\nimport { ToggleButton } from "../toggle-button/index"\nimport { toggleVariants } from "../toggle-button/index"';
    const bound = bindSiblingLeafModules(source, leafByItem);
    expect(bound.content).toBe('import { Button } from "../button/index"\nimport {\n  Select,\n  SelectContent,\n} from "../select/select"\nimport { Icon as LibraryIcon } from "../icon/index"\nimport { cn } from "../_parts/utils/index"\nimport { Button as Deep, buttonVariants } from "../../button/button"\nimport { ToggleButton } from "../toggle-button/index"\nimport { toggleVariants } from "../toggle-button/toggle"');
    expect(bound.ambiguous).toEqual([]);
    expect(bindSiblingLeafModules('import { TextField } from "../text-field/index"', leafByItem)).toEqual({ content: 'import { TextField } from "../text-field/index"', ambiguous: [] });
    expect(bindSiblingLeafModules('import { Input } from "../text-field/index"', leafByItem)).toEqual({ content: 'import { Input } from "../text-field/index"', ambiguous: ["text-field"] });
  });
  it("calendar rebind owns day styles and preserves single/range root protocols", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const code = result.rewrites.calendar!.files.find(file => file.path.endsWith("calendar.tsx"))!.content;
    expect(code).not.toContain("buttonVariants");
    expect(code).toContain('import { Button } from "../button/index"');
    expect(code).toContain('import { forwardRef as ReactForwardRef } from "react"');
    expect(code).toContain("ReactForwardRef(function Calendar");
    expect(code).toContain("ReactForwardRef(function RangeCalendar");
    expect(code.match(/ref=\{ref\}/g)).toHaveLength(2);
    expect(code.match(/typeof props.className === "function"/g)).toHaveLength(2);
    expect(code.match(/typeof props.children === "function"/g)).toHaveLength(2);
    expect(code).toContain('variant={buttonVariant}');
    expect(code).toContain('data-selected-single');
    expect(code).toContain('isToday');
    // Caption subparts stay visible as unresolved selected-export findings.
    expect(code).toContain('SelectTrigger');
  });
  it("regenerates every committed descriptor and coverage byte", () => {
    const files = generatedShadcnComponentFiles(pinnedInput());
    const destination = resolve(import.meta.dirname, "../catalog/fills/shadcn@aria");
    expect([...Object.keys(files), "components.command.json", "components.dropdown-menu.json", "components.empty.json", "components.item.json", "components.rich-text.json", "components.scroll-area.json", "components.sheet.json", "components.sidebar.json"].sort()).toEqual(readdirSync(destination).sort());
    for (const [name, bytes] of Object.entries(files)) expect(readFileSync(resolve(destination, name), "utf8"), name).toBe(bytes);
    // This admitted Tiptap exception is authored as a package-backed composition,
    // rather than regenerated from a pinned shadcn registry item.
    const richText = JSON.parse(readFileSync(resolve(destination, "components.rich-text.json"), "utf8"));
    expect(richText.$extensions["com.clossys.fill"]).toMatchObject({ author: "foundry", trust: "foundry",
      id: "shadcn@aria/components.rich-text", sourceAddress: "./components#RichText" });
    expect(richText.$extensions["com.clossys.engine-exception"]).toMatchObject({ component: "components.rich-text", engine: "Tiptap 3 / ProseMirror" });
    expect(richText.components["rich-text"].impl).toEqual({ kind: "package", module: "@clossys/designer/components", export: "RichText" });
    expect(richText.components["rich-text"].composes).toEqual(["components.badge", "components.link", "components.semantic-content", "components.table"]);
  });
  it("classifies every inspected item at the immutable commit with no unknown runtime result", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    expect(SHADCN_ARIA_COMPONENT_PIN.commit).toBe("daaf156ee00ed91cc7e6bdd937c1b4973152d141");
    expect(result.receipt.map(row => row.item).sort()).toEqual([...Object.keys(SHADCN_COMPONENT_ITEMS), "input-group", "button#LinkButton"].sort());
    expect(result.receipt.every(row => ["U-V", "X"].includes(row.runtime))).toBe(true);
    for (const item of ["form", "input", "textarea", "spinner", "field", "label", "sidebar", "sonner", "resizable"]) expect(result.receipt.find(row => row.item === item)).toMatchObject({ runtime: "X", status: "rejected" });
    expect(result.fills.some(fill => ["text-field", "spinner", "field", "navigation-tree", "toast", "resize-handle", "form"].some(leaf => leaf in fill.components))).toBe(false);
  });
  it("keeps upstream pins and output receipts in distinct hash domains", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const upstream = JSON.parse(read("button.json")).files[0];
    const fill = result.fills.find(fill => fill.components.button)!.components.button!;
    expect(fill.pin!.files).toContainEqual({ path: upstream.path, sha256: sha256(upstream.content) });
    expect(fill.outputSha256.find(file => file.path === "components/button/button.tsx")!.sha256).not.toBe(sha256(upstream.content));
    for (const [item, rewritten] of Object.entries(result.rewrites)) for (const file of rewritten.files) expect(rewritten.outputSha256, item).toContainEqual({ path: file.path, sha256: createHash("sha256").update(file.content).digest("hex") });
    expect(result.rewrites.button!.files.find(file => file.path === "notices/THIRD-PARTY.md")!.content).toContain(read("LICENSE.md"));
    expect(fill.pin!.files!.find(file => file.path === "LICENSE.md")!.sha256).toBe(sha256(read("LICENSE.md")));
  });
  it("rejects one-byte source, style and licence tampering before transformation", () => {
    for (const field of ["styles", "notice"] as const) {
      const input = pinnedInput(); input[field] = { ...input[field], content: input[field].content + " " };
      expect(() => importShadcnAriaComponents(input)).toThrow(/sha256 mismatch/);
    }
    const input = pinnedInput(); const button = input.items.find(item => item.name === "button")!;
    button.files[0]!.content += " ";
    expect(() => importShadcnAriaComponents(input)).toThrow(/sha256 mismatch/);
    expect(() => verifyShadcnSource({ path: "../button.tsx", content: "" })).toThrow(/sha256 mismatch/);
  });
  it("rejects duplicate, foreign-pin and missing dependency inspection inputs", () => {
    const input = pinnedInput(); expect(() => importShadcnAriaComponents({ ...input, items: [...input.items, input.items[0]!] })).toThrow(/identity/);
    const foreign = pinnedInput(); foreign.items[0]!.commit = "0".repeat(40); expect(() => importShadcnAriaComponents(foreign)).toThrow(/pin/);
    expect(() => importShadcnAriaComponents({ ...input, items: input.items.filter(item => item.name !== "button") })).toThrow(/missing inspection/);
  });
  it("screens the observed root against the actual leaf contract", () => {
    const contracts = structuredClone(slots) as ComponentSlot[];
    contracts.find(slot => slot.id === "components.button")!.contract.root = "rac:MissingRoot";
    const result = importShadcnAriaComponents({ ...pinnedInput(), slots: contracts });
    expect(result.receipt.find(row => row.item === "button")).toMatchObject({ runtime: "X", reason: "K2: missing RAC root MissingRoot" });
    expect(result.fills.some(fill => fill.components.button)).toBe(false);
  });
  it("materializes clean authenticated drafts while refusing unsafe synthetic rewrite output", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const entries = { button: "components/button/button.tsx", select: "components/select/select.tsx", calendar: "components/calendar/calendar.tsx" };
    for (const [item, entry] of Object.entries(entries)) {
      expect(result.rewrites[item]!.issues).toEqual([]);
      const files = materializeShadcnComponent(result, item);
      expect(files.map(file => file.path)).toContain(entry);
      expect(files).toEqual(result.rewrites[item]!.files);
    }
    // This malformed-result control is SYNTHETIC, never an authenticated candidate or observation.
    const unsafe = rewriteShadcnAria({ item: "button", leaf: "button", files: [{ path: "unsafe.tsx", content: 'const value = "bg-red-500"' }], styles: "", leafByItem: { button: "button" } });
    expect(unsafe.issues).toContainEqual(expect.objectContaining({ code: "K4", value: "bg-red-500" }));
    expect(() => materializeShadcnComponent({ ...result, rewrites: { ...result.rewrites, button: unsafe } }, "button")).toThrow(/unresolved/);
    expect(() => materializeShadcnComponent(result, "sonner")).toThrow(/rejected/);
  });
  it("makes no fabricated accessibility, token or RAC installation observations", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const bySlot = new Map((slots as ComponentSlot[]).map(slot => [slot.id, slot]));
    for (const doc of result.fills) {
      const meta = doc.$extensions["com.clossys.fill"], fill = Object.values(doc.components)[0]!;
      expect(meta.conforms).toEqual([]); expect(meta.evidence).toEqual([]); expect(meta.status).toBe("draft");
      expect(fill.rac).toEqual({ range: expect.stringMatching(/^\^1\.\d+\.\d+$/), peer: false, instance: "react-aria-components" }); expect(fill).not.toHaveProperty("measurements");
      const contract = bySlot.get(fill.slot)!.contract;
      if (contract.members.mode === "closed") expect(fill.members.every(member => contract.members.names.includes(member))).toBe(true);
    }
    const button = result.fills.find(doc => doc.components.button)!.components.button!;
    for (const member of ["variant.tonal", "variant.quiet", "state.pending", "ground.inverse"]) expect(button.members).not.toContain(member);
    expect(button.deps).toContainEqual({ name: "class-variance-authority", version: "0.7.1", license: "Apache-2.0" });
  });
  it("refuses edits to an otherwise resolved materialization", () => {
    const result = structuredClone(importShadcnAriaComponents(pinnedInput()));
    const part = result.rewrites.collapsible!;
    expect(part.issues).toEqual([]);
    expect(materializeShadcnComponent(result, "collapsible").length).toBeGreaterThan(0);
    part.files[0]!.content += " ";
    expect(() => materializeShadcnComponent(result, "collapsible")).toThrow(/output hash differs/);
  });
  it("rejects missing and unreceipted output files in otherwise resolved materialization", () => {
    for (const operation of ["missing", "additional"] as const) {
      const result = structuredClone(importShadcnAriaComponents(pinnedInput()));
      const part = result.rewrites.collapsible!;
      expect(part.issues).toEqual([]);
      if (operation === "missing") part.files = part.files.slice(1);
      else part.files = [...part.files, { path: "components/disclosure/unreceipted.ts", content: "export const extra = true" }];
      expect(() => materializeShadcnComponent(result, "collapsible")).toThrow(/output (?:hash|receipt) differs/);
    }
  });
  it("rebinds component leaves and materializes only non-leaf private parts", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const select = result.rewrites.select!, calendar = result.rewrites.calendar!;
    expect(select.files.some(file => file.path === "components/_parts/input-group/input-group.tsx")).toBe(true);
    expect(select.files.some(file => /_parts\/(?:button|input|textarea)\//.test(file.path))).toBe(false);
    expect(select.contextualInputs).toEqual(["input", "textarea"]);
    expect(select.issues.filter(issue => issue.code === "K9")).toEqual([]);
    expect(calendar.reads.components).toEqual(expect.arrayContaining(["components.button", "components.select", "components.icon"]));
    expect(calendar.files.some(file => /_parts\/(?:button|select)\//.test(file.path))).toBe(false);
    expect(calendar.files.some(file => file.path.includes("_parts/input-group/"))).toBe(false);
  });

  it("declares only registry dependencies that every fill composes or materializes", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    for (const doc of result.fills) {
      const fill = Object.values(doc.components)[0]!;
      const files = result.rewrites[fill.item!]!.files;
      for (const dep of fill.deps.filter(dep => dep.registryItem)) {
        const rebound = !!dep.slot && fill.composes.includes(dep.slot);
        const materialized = fill.parts!.some(part => part.item === dep.registryItem) && files.some(file => file.path.includes(`_parts/${dep.registryItem}/`));
        expect(rebound || materialized, `${fill.slot} ${dep.registryItem}`).toBe(true);
      }
    }
  });

  it("approves exactly the five Calendar-caption Select parts as same-entry identity aliases and nothing else", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const descriptors = result.fills.map(doc => Object.values(doc.components)[0]!);
    const select = descriptors.find(fill => fill.slot === "components.select")!;
    const five = ["SelectContent", "SelectGroup", "SelectItem", "SelectTrigger", "SelectValue"].map(name => ({ name, export: name }));
    expect(select.secondaryExports).toEqual(five);
    // The approval is proved against the exact authenticated entry the descriptor receipts.
    expect(componentSecondaryExports(select, materializeShadcnComponent(result, "select"))).toEqual(five);
    expect(select.impl).toEqual({ kind: "source", entry: "components/select/select.tsx", export: "Select" });
    for (const name of ["SelectList", "SelectInput", "SelectLabel", "SelectPopover", "SelectSeparator", "SelectEmpty", "Select"]) expect(select.secondaryExports!.map(row => row.name)).not.toContain(name);
    expect(descriptors.filter(fill => fill.secondaryExports !== undefined).map(fill => fill.slot).sort()).toEqual(["components.button", "components.card", "components.dialog", "components.disclosure", "components.menu", "components.select", "components.table", "components.tabs"]);
    for (const [slot, names] of [["components.button", ["LinkButton"]], ["components.tabs", ["TabsList", "TabsTrigger", "TabsContent"]]] as const) {
      const descriptor = descriptors.find(fill => fill.slot === slot)!;
      const parts = names.map(name => ({ name, export: name }));
      expect(descriptor.secondaryExports).toEqual(parts);
      expect(componentSecondaryExports(descriptor, result.rewrites[descriptor.item!]!.files)).toEqual([...parts].sort((a, b) => a.name.localeCompare(b.name)));
    }
  });

  it("approves the admitted Menu anatomy and native trigger from the same selected entry", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const menu = result.fills.map(doc => Object.values(doc.components)[0]!).find(fill => fill.slot === "components.menu")!;
    const parts = [{ name: "MenuGroup", export: "DropdownMenuGroup" }, { name: "MenuItem", export: "DropdownMenuItem" }, { name: "MenuLabel", export: "DropdownMenuLabel" }, { name: "MenuSeparator", export: "DropdownMenuSeparator" }, { name: "DropdownMenuTrigger", export: "DropdownMenuTrigger" }];
    expect(menu.secondaryExports).toEqual(parts);
    expect(componentSecondaryExports(menu, result.rewrites["dropdown-menu"]!.files)).toEqual([...parts].sort((a, b) => a.name.localeCompare(b.name)));
    expect(menu.impl).toEqual({ kind: "source", entry: "components/menu/dropdown-menu.tsx", export: "DropdownMenu" });
    for (const name of ["InlineMenu", "DropdownMenu", "DropdownMenuSub", "DropdownMenuSubTrigger", "DropdownMenuSubContent", "DropdownMenuShortcut", "DropdownMenuContent"]) expect(menu.secondaryExports!.map(row => row.export)).not.toContain(name);
  });

  it("approves the Dialog naming parts and native trigger as same-entry identity exports", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const dialog = result.fills.map(doc => Object.values(doc.components)[0]!).find(fill => fill.slot === "components.dialog")!;
    const parts = ["DialogDescription", "DialogHeader", "DialogTitle", "DialogTrigger"].map(name => ({ name, export: name }));
    expect(dialog.secondaryExports).toEqual(parts);
    expect(componentSecondaryExports(dialog, result.rewrites.dialog!.files)).toEqual(parts);
    expect(dialog.impl).toEqual({ kind: "source", entry: "components/dialog/dialog.tsx", export: "Dialog" });
    for (const name of ["DialogClose", "DialogOverlay", "DialogFooter", "DialogContent", "DialogPortal", "Dialog"]) expect(dialog.secondaryExports!.map(row => row.export)).not.toContain(name);
  });

  it("proves the five admitted Card parts against the authenticated pinned source closure", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const card = result.fills.map(doc => Object.values(doc.components)[0]!).find(fill => fill.slot === "components.card")!;
    const parts = ["CardHeader", "CardTitle", "CardAction", "CardContent", "CardFooter"].map(name => ({ name, export: name }));
    expect(card.secondaryExports).toEqual(parts);
    const files = materializeShadcnComponent(result, "card");
    const entry = "components/card/card.tsx";
    expect(componentSecondaryExports(card, files)).toEqual([...parts].sort((a, b) => a.name.localeCompare(b.name)));
    expect(card.impl).toEqual({ kind: "source", entry: "components/card/card.tsx", export: "Card" });
    expect(card.secondaryExports!.map(row => row.name)).not.toContain("CardDescription");
    expect(card.outputSha256).toContainEqual({ path: entry, sha256: sha256(files.find(file => file.path === entry)!.content) });
    expect(() => componentSecondaryExports(card, files.filter(file => file.path !== entry))).toThrow(/unsupported secondary export/);
  });

  it("proves native Accordion and Table anatomy without adding a rejected Field candidate", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    for (const [item, leaf, names] of [
      ["accordion", "disclosure", ["AccordionContent", "AccordionItem", "AccordionTrigger"]],
      ["table", "table", ["TableBody", "TableCaption", "TableCell", "TableFooter", "TableHead", "TableHeader", "TableRow"]],
    ] as const) {
      const descriptor = result.fills.map(doc => Object.values(doc.components)[0]!).find(fill => fill.slot === `components.${leaf}`)!;
      expect(componentSecondaryExports(descriptor, materializeShadcnComponent(result, item))).toEqual(names.map(name => ({ name, export: name })));
    }
    expect(result.fills.some(doc => "field" in doc.components)).toBe(false);
    expect(result.receipt.find(row => row.item === "field")).toMatchObject({ status: "rejected", reason: "K2: missing RAC root Label+Text+FieldError" });
  });

  it("keeps the borrowed CommandList as menu provenance without its unused command imports", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const menu = result.fills.map(doc => Object.values(doc.components)[0]!).find(fill => fill.slot === "components.menu")!;
    expect(menu.item).toBe("dropdown-menu");
    expect(menu.pin!.files!.map(file => file.path)).toContain("apps/v4/registry/bases/aria/ui/command.tsx");
    expect(menu.deps.map(dep => dep.registryItem).filter(Boolean)).toEqual([]);
    const emitted = result.rewrites["dropdown-menu"]!.files.map(file => file.content).join("\n");
    expect(emitted).toContain("function InlineMenu<");
    expect(emitted).not.toMatch(/input-group|\/dialog/);
  });
});
