import type { AccessCellValue, AccessMatrixProps, AccessMatrixValue } from "../AccessMatrix.js";

export function accessCell(value: AccessMatrixValue, roleId: string, permissionId: string): AccessCellValue | undefined {
  const cells = Object.hasOwn(value, roleId) ? value[roleId] : undefined;
  return cells && Object.hasOwn(cells, permissionId) ? cells[permissionId] : undefined;
}

export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function copy(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function assertValue(value: unknown, roles: Set<string>, permissions: Set<string>): asserts value is AccessMatrixValue {
  if (!record(value)) throw new TypeError("AccessMatrix: value must be a record.");
  for (const [role, cells] of Object.entries(value)) {
    if (!roles.has(role) || !record(cells)) throw new TypeError("AccessMatrix: value must name declared roles with cell records.");
    for (const [permission, cell] of Object.entries(cells)) {
      if (!permissions.has(permission)) throw new TypeError("AccessMatrix: value must name declared permissions.");
      if (!record(cell) || (cell.state !== "granted" && cell.state !== "denied" && cell.state !== "inherited")) throw new TypeError("AccessMatrix: unknown cell value.");
      if (cell.state === "inherited" && !copy(cell.reason)) throw new TypeError("AccessMatrix: inherited cells require a reason.");
    }
  }
}

export function assertAccessMatrix(props: AccessMatrixProps): void {
  if (!copy(props["aria-label"]) || !Array.isArray(props.roles) || !Array.isArray(props.groups)) throw new TypeError("AccessMatrix: a label, roles array and groups array are required.");
  const roleIds = new Set<string>(), groupIds = new Set<string>(), permissionIds = new Set<string>();
  for (const role of props.roles) {
    if (!record(role) || !copy(role.id) || !copy(role.label) || roleIds.has(role.id) || (role.isLocked !== undefined && typeof role.isLocked !== "boolean") || (role.lockedReason !== undefined && !copy(role.lockedReason))) throw new TypeError("AccessMatrix: roles need distinct ids and labels.");
    roleIds.add(role.id);
  }
  for (const group of props.groups) {
    if (!record(group) || !copy(group.id) || !copy(group.label) || groupIds.has(group.id) || !Array.isArray(group.permissions)) throw new TypeError("AccessMatrix: groups need distinct ids, labels and permission arrays.");
    groupIds.add(group.id);
    for (const permission of group.permissions) {
      if (!record(permission) || !copy(permission.id) || !copy(permission.label) || permissionIds.has(permission.id) || (permission.description !== undefined && !copy(permission.description))) throw new TypeError("AccessMatrix: permissions need distinct ids and labels.");
      permissionIds.add(permission.id);
    }
  }
  assertValue(props.value, roleIds, permissionIds);
  if (props.baseline !== undefined) assertValue(props.baseline, roleIds, permissionIds);
  if (!record(props.labels) || ![props.labels.permissionHeader, props.labels.inherited, props.labels.locked].every(copy) || ![props.labels.cell, props.labels.groupAll, props.labels.changeSummary].every(value => typeof value === "function")) throw new TypeError("AccessMatrix: labels must supply all display copy.");
  if (props.onChange !== undefined && typeof props.onChange !== "function") throw new TypeError("AccessMatrix: onChange must be a function.");
}
