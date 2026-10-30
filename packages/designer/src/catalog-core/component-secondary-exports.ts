/** Closed, opt-in source-value proof. This does not replace the import-closure parser. */
import { CatalogError } from "./api.js";
import type { ComponentCandidate, ComponentFile } from "./resolve-components.js";
import { sha256 } from "./digest.js";
import { componentSourceValues } from "./component-source-values.js";

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

/**
 * Immutable normalized selected modules whose concrete function exports have an
 * independent AST and loaded-runtime proof. Private context/CVA values are not
 * component exports. This registry authenticates bytes, never caller assertions
 * or component qualification; unknown output still uses the bounded parser.
 */
const selectedFunctionSources: Readonly<Record<string, { sha256: string; functions: readonly string[] }>> = {
  "components/button/button.tsx": {
    sha256: "81c519436afe48770064f8b942d58195dcd0133ffbcd18743b60191ff17cfd21",
    functions: ["Button", "LinkButton"],
  },
  "components/tabs/tabs.tsx": {
    sha256: "463fa0a0dfed07c77607a747e163fe4cdf7eccf1d7abf4d1fe34bb992717e5c2",
    functions: ["Tabs", "TabsList", "TabsTrigger", "TabsContent"],
  },
  "components/sidebar/sidebar.tsx": {
    sha256: "e196cce6931a381a3cfe63fecbd019550a960cee62411363ee2d0c85f7d3c8e5",
    functions: ["Sidebar", "SidebarContent", "SidebarFooter", "SidebarGroup", "SidebarGroupAction", "SidebarGroupContent", "SidebarGroupLabel", "SidebarHeader", "SidebarInput", "SidebarInset", "SidebarMenu", "SidebarMenuAction", "SidebarMenuBadge", "SidebarMenuButton", "SidebarMenuItem", "SidebarMenuSkeleton", "SidebarMenuSub", "SidebarMenuSubButton", "SidebarMenuSubItem", "SidebarProvider", "SidebarRail", "SidebarSeparator", "SidebarTrigger"],
  },
  "components/command/command.tsx": {
    sha256: "abefbe8fbd0c0b0958678840b9c6b0e17dc9a90b79774db5e66d23c7d249ccec",
    functions: ["Command", "CommandDialog", "CommandInput", "CommandList", "CommandEmpty", "CommandGroup", "CommandItem", "CommandShortcut", "CommandSeparator"],
  },
  "components/sheet/sheet.tsx": {
    sha256: "3fbf0574ec99a2270805ab964ce3dd6ba95b5282d38284b73624a0b5781e0bdf",
    functions: ["Sheet", "SheetTrigger", "SheetClose", "SheetContent", "SheetHeader", "SheetFooter", "SheetTitle", "SheetDescription"],
  },
  "components/empty/empty.tsx": {
    sha256: "66d76b36441351629fa0f1d9d5729adffccbca1f2067fac8009b8f3b4f95c0b5",
    functions: ["Empty", "EmptyHeader", "EmptyTitle", "EmptyDescription", "EmptyContent", "EmptyMedia"],
  },
  "components/item/item.tsx": {
    sha256: "8e680d7cda2ca581321160a3ebb237274aa7096a60519ce816fc361b0e99a527",
    functions: ["Item", "ItemMedia", "ItemContent", "ItemActions", "ItemGroup", "ItemSeparator", "ItemTitle", "ItemDescription", "ItemHeader", "ItemFooter"],
  },
  "components/dropdown-menu/dropdown-menu.tsx": {
    sha256: "b3cec5d73e72ec7db1573876e7e9fa71eb906cccfd163ca19c46b74de206216f",
    functions: ["DropdownMenu", "DropdownMenuTrigger", "DropdownMenuGroup", "DropdownMenuLabel", "DropdownMenuItem", "DropdownMenuSeparator", "DropdownMenuShortcut", "DropdownMenuSub", "DropdownMenuSubTrigger", "DropdownMenuSubContent"],
  },
  "components/toggle-group/toggle-group.tsx": {
    sha256: "498bbe56c2bdef19944e118cdb915962528c3905ad1b9739a07b04d0232b12a3",
    functions: ["ToggleGroup", "ToggleGroupItem"],
  },
};
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
    : componentSourceValues(entry.content);
  for (const row of rows) if (!proof.exports.has(row.export) || !proof.functions.has(row.export)) return refuse();
  return rows;
}
