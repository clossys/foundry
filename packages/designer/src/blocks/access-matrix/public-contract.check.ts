import type { AccessCellValue, AccessMatrixChange, ColumnMapping } from "../../index.js";
import type { AccessCellValue as BlockCell, AccessMatrixChange as BlockChange, ColumnMapping as BlockMapping } from "../index.js";

// Compile-time consumer contracts for both public client barrels. This file is
// included by the package compiler and is never imported by runtime modules.
function checkRoot(change: AccessMatrixChange) {
  // @ts-expect-error inherited reasons are required.
  const noReason: AccessCellValue = { state: "inherited" };
  // @ts-expect-error mixed is presentation, not a cell state.
  const mixed: AccessCellValue = { state: "mixed" };
  // @ts-expect-error mapping values must be source ids or null.
  const wrongMapping: ColumnMapping = { email: false };
  // @ts-expect-error permission ids are readonly.
  change.permissionIds.push("edit");
  return [noReason, mixed, wrongMapping];
}

function checkBlocks(change: BlockChange) {
  // @ts-expect-error inherited reasons are required.
  const noReason: BlockCell = { state: "inherited" };
  // @ts-expect-error mixed is presentation, not a cell state.
  const mixed: BlockCell = { state: "mixed" };
  // @ts-expect-error mapping values must be source ids or null.
  const wrongMapping: BlockMapping = { email: false };
  // @ts-expect-error permission ids are readonly.
  change.permissionIds.push("edit");
  return [noReason, mixed, wrongMapping];
}

void checkRoot;
void checkBlocks;
