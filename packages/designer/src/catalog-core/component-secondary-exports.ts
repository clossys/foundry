/** Closed, opt-in source-value proof. This does not replace the import-closure parser. */
import { CatalogError } from "./api.js";
import type { ComponentCandidate, ComponentFile } from "./resolve-components.js";
import { sha256 } from "./digest.js";

type Secondary = NonNullable<ComponentCandidate["secondaryExports"]>[number];
const refuse = (): never => { throw new CatalogError("components: unsupported secondary export source or inventory"); };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Z][A-Za-z0-9]*$/.test(value);
function inventory(fill: ComponentCandidate): Secondary[] {
  const value = fill.secondaryExports;
  if (value === undefined) return [];
  if (fill.impl.kind !== "source" || !Array.isArray(value) || !value.length) return refuse();
  const primary = fill.slot.slice(11).split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
  const reserved = new Set([primary, fill.impl.export, "LibraryProvider", "__proto__", "prototype", "constructor"]);
  const names = new Set<string>(), targets = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object" || Object.keys(row).sort().join(",") !== "export,name" || !identifier(row.name) || !identifier(row.export)) return refuse();
    if (reserved.has(row.name) || reserved.has(row.export) || names.has(row.name) || targets.has(row.export)) return refuse();
    names.add(row.name); targets.add(row.export);
  }
  return value.map(row => ({ name: row.name, export: row.export })).sort((a, b) => a.name < b.name ? -1 : 1);
}
export function assertComponentSecondaryExports(fill: ComponentCandidate): void { inventory(fill); }

interface Token { text: string; quoted?: true }
/**
 * Immutable normalized selected modules whose concrete function exports have an
 * independent AST and loaded-runtime proof. Private context/CVA values are not
 * component exports. This registry authenticates bytes, never caller assertions
 * or component qualification; unknown output still uses the bounded parser.
 */
const selectedFunctionSources: Readonly<Record<string, { sha256: string; functions: readonly string[] }>> = {
  "components/field/field.tsx": {
    sha256: "153fe2aa79b8a926fa80400f8fe2cddeaf9344e0334393b8e8ee9169b8a4a881",
    functions: ["Field","FieldGroup","FieldSet"],
  },
  "components/date-field/date-field.tsx": {
    sha256: "151662155d65727ad390522a54688530c0b79191ad7f406857dd3199b6e1f3f9",
    functions: ["DateField","TimeField"],
  },
  "components/date-picker/date-picker.tsx": {
    sha256: "7ad649d639366e3b6879ae223bdb2ffd437076f397baf1921c3255fd7a36b11a",
    functions: ["DatePicker","DateRangePicker"],
  },

  "components/sidebar/sidebar.tsx": {
    sha256: "50e6d8e099bfdd64393ea6141fe84a89ce580b77756d8773f9c1be8130f2339f",
    functions: ["Sidebar", "SidebarContent", "SidebarFooter", "SidebarGroup", "SidebarGroupAction", "SidebarGroupContent", "SidebarGroupLabel", "SidebarHeader", "SidebarInput", "SidebarInset", "SidebarMenu", "SidebarMenuAction", "SidebarMenuBadge", "SidebarMenuButton", "SidebarMenuItem", "SidebarMenuSkeleton", "SidebarMenuSub", "SidebarMenuSubButton", "SidebarMenuSubItem", "SidebarProvider", "SidebarRail", "SidebarSeparator", "SidebarTrigger"],
  },
  "components/command/command.tsx": {
    sha256: "87cca9baf632341de02972eb118885cd42b52c29c78f374dd7d40c572bec3881",
    functions: ["Command", "CommandDialog", "CommandInput", "CommandList", "CommandEmpty", "CommandGroup", "CommandItem", "CommandShortcut", "CommandSeparator"],
  },
  "components/sheet/sheet.tsx": {
    sha256: "3a13c49425b6eb264bde5743c5e4c7f2a5cbd1e3ca909594f48ce27895ce13f4",
    functions: ["Sheet", "SheetTrigger", "SheetClose", "SheetContent", "SheetHeader", "SheetFooter", "SheetTitle", "SheetDescription"],
  },
  "components/empty/empty.tsx": {
    sha256: "100765c44ff5006352e4650ca9f4e508761caf41bdc66eb0350ea9c450b62e3e",
    functions: ["Empty", "EmptyHeader", "EmptyTitle", "EmptyDescription", "EmptyContent", "EmptyMedia"],
  },
  "components/item/item.tsx": {
    sha256: "2c8376d52356f7afe95f66a4439c8a33f3a356ac3b01483f85125783698e35b1",
    functions: ["Item", "ItemMedia", "ItemContent", "ItemActions", "ItemGroup", "ItemSeparator", "ItemTitle", "ItemDescription", "ItemHeader", "ItemFooter"],
  },
  "components/dropdown-menu/dropdown-menu.tsx": {
    sha256: "c49285f31ee71390240116bf572e43fe918849cd6b47ff1b2108635d48e89060",
    functions: ["DropdownMenu", "DropdownMenuTrigger", "DropdownMenuGroup", "DropdownMenuLabel", "DropdownMenuItem", "DropdownMenuSeparator", "DropdownMenuShortcut", "DropdownMenuSub", "DropdownMenuSubTrigger", "DropdownMenuSubContent"],
  },
  "components/toggle-group/toggle-group.tsx": {
    sha256: "56f69f2968acbd448637ea5c84cc6d4808563231e6b9825c380bcb82a9e24fb9",
    functions: ["ToggleGroup", "ToggleGroupItem"],
  },
};
/**
 * Only directives, named imports, concrete named functions and local identity
 * export lists are admitted. Templates, regexes, ambient/overloaded functions,
 * source aliases and other top-level declarations are deliberately unsupported.
 * Function bodies are balanced lexically, with JSX text kept out of JS tokens.
 */
function sourceValues(source: string) {
  let cursor = 0;
  const functions = new Set<string>(), exports = new Set<string>(), types = new Set<string>();
  const next = (): Token | undefined => {
    while (cursor < source.length) {
      const rest = source.slice(cursor);
      const whitespace = /^\s+/.exec(rest);
      if (whitespace) { cursor += whitespace[0].length; continue; }
      if (rest.startsWith("//")) { const end = source.indexOf("\n", cursor + 2); cursor = end < 0 ? source.length : end + 1; continue; }
      if (rest.startsWith("/*")) { const end = source.indexOf("*/", cursor + 2); if (end < 0) return refuse(); cursor = end + 2; continue; }
      const character = source[cursor++]!;
      if (character === "`") return refuse();
      if (character === '"' || character === "'") {
        while (cursor < source.length) {
          const item = source[cursor++]!;
          if (item === character) return { text: "quoted", quoted: true };
          if (item === "\n" || item === "\r") return refuse();
          if (item === "\\") cursor++;
        }
        return refuse();
      }
      if (/[A-Za-z_$]/.test(character)) {
        const tail = /^[\w$-]*/.exec(source.slice(cursor))![0]; cursor += tail.length;
        return { text: character + tail };
      }
      return { text: character };
    }
    return undefined;
  };
  const take = (text: string): void => { if (next()?.text !== text) refuse(); };
  const localName = (): string => { const token = next(); if (!token || token.quoted || !/^[A-Za-z_$][\w$]*$/.test(token.text)) return refuse(); return token.text; };
  const group = (open: string, jsx: boolean): void => {
    const close = ({ "(": ")", "[": "]", "{": "}" } as Record<string, string>)[open]!;
    for (let token = next(); token; token = next()) {
      if (token.quoted) continue;
      if (token.text === close) return;
      if ([")", "]", "}"].includes(token.text) || token.text === "/") return refuse();
      if (["(", "[", "{"].includes(token.text)) group(token.text, jsx);
      else if (jsx && token.text === "<" && /^[A-Za-z>]/.test(source[cursor] ?? "")) element();
    }
    refuse();
  };
  const element = (): void => {
    const tag = source[cursor] === ">" ? "" : /^[A-Za-z][A-Za-z0-9]*/.exec(source.slice(cursor))?.[0];
    if (tag === undefined) return refuse();
    cursor += tag.length;
    for (let token = next(); token; token = next()) {
      if (token.quoted) continue;
      if (token.text === ">") break;
      if (token.text === "/") { take(">"); return; }
      if (token.text === "{") group("{", true);
      else if (!["="].includes(token.text) && !/^[A-Za-z_$][\w$-]*$/.test(token.text)) return refuse();
    }
    while (cursor < source.length) {
      const character = source[cursor++]!;
      if (character === "}") return refuse();
      if (character === "{") group("{", true);
      if (character !== "<") continue;
      if (source[cursor] !== "/") { element(); continue; }
      cursor++;
      if (tag && localName() !== tag) return refuse();
      take(">"); return;
    }
    refuse();
  };
  const concreteFunction = (exported: boolean): void => {
    const name = localName();
    if (functions.has(name)) return refuse();
    let token = next();
    if (token?.text === "<") {
      let depth = 1;
      while (depth) {
        token = next(); if (!token) return refuse();
        if (!token.quoted && token.text === "<") depth++;
        if (!token.quoted && token.text === ">") depth--;
        if (!token.quoted && ["{", "}", ";", "/"].includes(token.text)) return refuse();
      }
      token = next();
    }
    if (token?.text !== "(") return refuse();
    group("(", false);
    take("{"); group("{", true);
    functions.add(name); if (exported) exports.add(name);
  };
  for (let token = next(); token; token = next()) {
    if (token.quoted || token.text === ";") continue;
    if (token.text === "import") {
      let binding = next(); if (binding?.text === "type") binding = next();
      if (binding?.text !== "{") return refuse();
      group("{", false); take("from"); if (!next()?.quoted) return refuse();
    } else if (token.text === "function") concreteFunction(false);
    else if (token.text === "export") {
      let item = next();
      if (item?.text === "function") { concreteFunction(true); continue; }
      const typeOnly = item?.text === "type"; if (typeOnly) item = next();
      if (item?.text !== "{") return refuse();
      item = next();
      while (item?.text !== "}") {
        let erased = typeOnly;
        if (item?.text === "type") { erased = true; item = next(); }
        if (!item || item.quoted || !/^[A-Za-z_$][\w$]*$/.test(item.text)) return refuse();
        if (exports.has(item.text) || types.has(item.text)) return refuse();
        (erased ? types : exports).add(item.text);
        item = next();
        if (item?.text !== ",") { if (item?.text !== "}") return refuse(); }
        else item = next();
      }
    } else return refuse();
  }
  return { functions, exports, types };
}

/** Caller authenticates the source output receipts before invoking value proof. */
export function componentSecondaryExports(fill: ComponentCandidate, files: readonly ComponentFile[]): readonly Secondary[] {
  const rows = inventory(fill);
  if (!rows.length) return rows;
  if (fill.impl.kind !== "source") return refuse();
  const path = fill.impl.entry;
  const entry = files.find(file => file.path === path);
  if (!entry) return refuse();
  const selected = selectedFunctionSources[path];
  const proof = selected && sha256(entry.content) === selected.sha256
    ? { functions: new Set(selected.functions), exports: new Set(selected.functions), types: new Set<string>() }
    : sourceValues(entry.content);
  for (const row of rows) if (!proof.exports.has(row.export) || !proof.functions.has(row.export)) return refuse();
  return rows;
}
