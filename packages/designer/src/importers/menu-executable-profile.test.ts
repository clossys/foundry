// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { clsx } from "clsx";
import { cva } from "class-variance-authority";
import { twMerge } from "tailwind-merge";
import { describe, expect, it } from "vitest";
import slots from "../catalog/slots/components.json" with { type: "json" };
import { menuExecutableSource, menuExecutableMembers } from "./menu-executable-profile.js";
import { menuInlineSource } from "./menu-inline-source.js";
import { normalizeSelectedSource } from "./normalize-selected-source.js";
const fixture = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `__fixtures__/shadcn-aria/${name}.json`), "utf8")).files[0] as { path: string; content: string };
describe("selected Menu executable source", () => {
  it("derives a generic inline collection from the exact pinned CommandList without a Popover", () => {
    const code = menuInlineSource(fixture("command"));
    expect(code).toContain("function InlineMenu<T extends object>");
    expect(code).toContain("MenuProps<T>");
    expect(code).toContain("<MenuPrimitive");
    expect(code).toContain("{...props}");
    expect(code).toContain("composeRenderProps(className");
    expect(code).not.toMatch(/Popover|MenuTrigger|useState|createContext/);
    expect(() => menuInlineSource({ ...fixture("command"), content: fixture("command").content + " " })).toThrow(/receipt differs/);
  });
  it("preserves popup anchoring and forwards the actual collection protocols without CVA", () => {
    const transformed = menuExecutableSource(fixture("dropdown-menu"), fixture("command"));
    const code = normalizeSelectedSource({ ...transformed, path: "components/menu/dropdown-menu.tsx" }).content;
    expect(code).not.toContain("class-variance-authority");
    expect(code).not.toContain("React.");
    expect(code).toContain('placement = "bottom start"');
    expect(code).toContain("placement={placement}");
    expect(code).toContain("MenuSectionPrimitiveProps<T>");
    expect(code).toContain("MenuItemPrimitiveProps<T>");
    expect(code).toContain('MenuProps<T>["children"]');
    expect(code).toContain('MenuProps<T>["className"]');
    const parsed = ts.createSourceFile("menu.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect((parsed as unknown as {parseDiagnostics: unknown[]}).parseDiagnostics).toEqual([]);
    const fn = parsed.statements.find(row => ts.isFunctionDeclaration(row) && row.name?.text === "dropdownMenuItemVariants")!;
    const js = ts.transpileModule(fn.getText(parsed), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const variant = new Function("cn", `${js};return dropdownMenuItemVariants`)((...values: unknown[]) => twMerge(clsx(values))) as (props:{selectionMode?:string})=>string;
    for (const [selectionMode, expected] of [["none","cn-dropdown-menu-item"],["single","cn-dropdown-menu-radio-item"],["multiple","cn-dropdown-menu-checkbox-item"]]) {
      const result = variant({selectionMode});
      expect(result).toContain(expected);
      expect(result).toContain("group/dropdown-menu-item");
    }
    expect(variant({})).not.toContain("cn-dropdown-menu-");
    expect(() => menuExecutableSource({...fixture("dropdown-menu"),content:fixture("dropdown-menu").content+" "},fixture("command"))).toThrow(/receipt differs/);
  });
  it("matches the original CVA output for no arguments, undefined, and all three actual selection modes", () => {
    const raw=fixture("dropdown-menu").content;
    const originalDeclaration=raw.slice(raw.indexOf("const dropdownMenuItemVariants = cva("),raw.indexOf("\nfunction DropdownMenuItem("));
    const originalJs=ts.transpileModule(originalDeclaration,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const original=new Function("cva",`${originalJs};return dropdownMenuItemVariants`)(cva) as (props?:{selectionMode?:"none"|"single"|"multiple"})=>string;
    const code=menuExecutableSource(fixture("dropdown-menu"),fixture("command")).content;
    const parsed=ts.createSourceFile("menu.tsx",code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const declaration=parsed.statements.find(row=>ts.isFunctionDeclaration(row)&&row.name?.text==="dropdownMenuItemVariants")!;
    const adaptedJs=ts.transpileModule(declaration.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const adapted=new Function("cn",`${adaptedJs};return dropdownMenuItemVariants`)((...values:unknown[])=>twMerge(clsx(values))) as typeof original;
    expect(adapted()).toBe(original());
    for(const props of [undefined,{}, {selectionMode:undefined},{selectionMode:"none"},{selectionMode:"single"},{selectionMode:"multiple"}] as const) expect(adapted(props)).toBe(original(props));
  });
  it("migrates only the draft Menu execution members and targets one Menu for every selection", () => {
    const menu = slots.find(row => row.id === "components.menu")!;
    expect(menu.contract.members.names).toEqual(["presentation.popup","presentation.inline","selection.none","selection.single","selection.multiple"]);
    expect(menu.contract.apg).toBe("menu");
    expect(menu.contract.memberRoots).toEqual({"presentation.popup":"rac:Menu","presentation.inline":"rac:Menu"});
    expect(menuExecutableMembers).toEqual({"presentation.popup":"DropdownMenu","presentation.inline":"InlineMenu","selection.none":"DropdownMenu.selectionMode=none","selection.single":"DropdownMenu.selectionMode=single","selection.multiple":"DropdownMenu.selectionMode=multiple"});
  });
});
