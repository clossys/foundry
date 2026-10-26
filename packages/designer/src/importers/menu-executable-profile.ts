import { sha256 } from "../catalog-core/digest.js";
import type { SourceFile } from "./rewrite.js";
import { menuInlineSource } from "./menu-inline-source.js";

/** Closed adaptation of the pinned Menu's one local CVA function and collection props. */
export function menuExecutableSource(file: SourceFile, command: SourceFile): SourceFile {
  if (sha256(file.content) !== "50a583093755eb29800812b189860b10f3aac3f7d48a3be23abe59c73dbb551d") throw new Error("menu-profile: pinned source receipt differs");
  let content = file.content.replace('import { cva } from "class-variance-authority"\n', "");
  const start = content.indexOf("const dropdownMenuItemVariants = cva("), end = content.indexOf("\nfunction DropdownMenuItem(");
  if (start < 0 || end <= start) throw new Error("menu-profile: local variant declaration differs");
  const declaration = content.slice(start, end), strings = [...declaration.matchAll(/"([^"\n]+)"/g)].map(match => match[1]!);
  if (strings.length !== 4) throw new Error("menu-profile: local variant cases differ");
  content = content.slice(0, start) + `function dropdownMenuItemVariants({ selectionMode }: { selectionMode?: "none" | "single" | "multiple" } = {}) {\n  return cn(${JSON.stringify(strings[0])}, selectionMode === "none" ? ${JSON.stringify(strings[1])} : selectionMode === "single" ? ${JSON.stringify(strings[2])} : selectionMode === "multiple" ? ${JSON.stringify(strings[3])} : undefined)\n}\n` + content.slice(end);
  content = content.replace("function DropdownMenu({", "function DropdownMenu<T extends object>({")
    .replace("typeof MenuPrimitive<object>", "typeof MenuPrimitive<T>")
    .replace('    className?: string\n    children?: React.ReactNode', '    className?: MenuProps<T>["className"]\n    children?: MenuProps<T>["children"]')
    .replace('        className\n      )}\n    >\n      <MenuPrimitive', '        typeof className === "function" ? undefined : className\n      )}\n    >\n      <MenuPrimitive')
    .replace('        className="max-h-[inherit] overflow-x-hidden overflow-y-auto outline-hidden"', '        className={composeRenderProps(typeof className === "function" ? className : undefined, (className) => cn("max-h-[inherit] overflow-x-hidden overflow-y-auto outline-hidden", className))}')
    .replace("function DropdownMenuGroup({", "function DropdownMenuGroup<T extends object>({")
    .replace('Omit<MenuSectionPrimitiveProps<object>, "children">', 'Omit<MenuSectionPrimitiveProps<T>, "children">')
    .replace('  children?: React.ReactNode\n}) {\n  return <MenuSectionPrimitive', '  children?: MenuSectionPrimitiveProps<T>["children"]\n}) {\n  return <MenuSectionPrimitive')
    .replace("function DropdownMenuItem({", "function DropdownMenuItem<T extends object>({")
    .replace("}: MenuItemPrimitiveProps<object> & {", "}: MenuItemPrimitiveProps<T> & {")
    .replace("  type MenuItemProps as", "  type MenuProps,\n  type MenuItemProps as");
  content = content.replace("\nexport {", `\n${menuInlineSource(command)}\nexport {\n  InlineMenu,`);
  return { ...file, content };
}

export const menuExecutableMembers: Readonly<Record<string, string>> = Object.freeze({
  "presentation.popup": "DropdownMenu", "presentation.inline": "InlineMenu",
  "selection.none": "DropdownMenu.selectionMode=none", "selection.single": "DropdownMenu.selectionMode=single", "selection.multiple": "DropdownMenu.selectionMode=multiple",
});
