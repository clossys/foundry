import assert from "node:assert/strict";
import { test } from "node:test";
import { staticSingleOptionRow } from "./adaptations.mjs";
const menu = '<DropdownMenu><DropdownMenuTrigger asChild><Button className="flex gap-2"><span>Workspace</span></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Workspace</DropdownMenuItem></DropdownMenuContent></DropdownMenu>';
const source = `export const Row = () => ${menu}`;
const adaptation = { operation: "single-option-static-row", optionCount: 1, menu, reason: "One workspace option has no choice" };
test("data-fit keeps the stock trigger body verbatim, and cannot carry replacement code", () => {
  const result = staticSingleOptionRow(source, "row.tsx", adaptation);
  assert.equal(result, 'export const Row = () => <Button className="flex gap-2"><span>Workspace</span></Button>');
  assert.throws(() => staticSingleOptionRow(source, "row.tsx", { ...adaptation, reason: " " }));
  assert.throws(() => staticSingleOptionRow(source, "row.tsx", { ...adaptation, menu: menu.replace("gap-2", "gap-8") }));
});
test("data-fit refuses multi-option, dynamic-option and invented operations", () => {
  const multiple = menu.replace("</DropdownMenuContent>", "<DropdownMenuItem>Other</DropdownMenuItem></DropdownMenuContent>");
  assert.throws(() => staticSingleOptionRow(`export const Row = () => ${multiple}`, "row.tsx", { ...adaptation, menu: multiple }), /exactly one/);
  const dynamic = menu.replace("<DropdownMenuItem>Workspace</DropdownMenuItem>", "{options.map(option => <DropdownMenuItem>{option.label}</DropdownMenuItem>)}");
  assert.throws(() => staticSingleOptionRow(`export const Row = () => ${dynamic}`, "row.tsx", { ...adaptation, menu: dynamic }), /dynamic/);
  assert.throws(() => staticSingleOptionRow(source, "row.tsx", { ...adaptation, operation: "rewrite-layout" }));
});
