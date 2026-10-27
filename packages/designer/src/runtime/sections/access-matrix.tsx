import { useState } from "react";
import { AccessMatrix, type AccessCellValue, type AccessGroup, type AccessMatrixValue, type AccessPermission, type AccessRole } from "../../blocks/AccessMatrix.js";
import { recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

/** One permission record: the block's permission plus the role cells it already holds. */
export interface AccessPermissionRecord extends AccessPermission { readonly grants?: Readonly<Record<string, AccessCellValue>> }
/** One permissions record: a permission group, as the importer's `groups[].permissions` pointer reads it. */
export interface AccessGroupRecord extends Omit<AccessGroup, "permissions"> { readonly permissions: readonly AccessPermissionRecord[] }

function valueFrom(groups: readonly AccessGroupRecord[]): AccessMatrixValue {
  const value: Record<string, Record<string, AccessCellValue>> = {};
  for (const group of groups) for (const permission of group.permissions) for (const [role, cell] of Object.entries(permission.grants ?? {})) (value[role] ??= {})[permission.id] = cell;
  return value;
}

function AccessMatrixFill({ roles, groups }: { readonly roles: readonly AccessRole[]; readonly groups: readonly AccessGroupRecord[] }) {
  const [value, setValue] = useState(() => valueFrom(groups));
  return <AccessMatrix
    aria-label="Workspace access"
    roles={roles}
    groups={groups.map(({ permissions, ...group }) => ({ ...group, permissions: permissions.map(({ grants: _grants, ...permission }) => permission) }))}
    value={value}
    onChange={setValue}
    labels={{
      permissionHeader: "Permission", cell: (role, permission) => `${role}: ${permission}`, groupAll: (role, group) => `${role}: all of ${group}`,
      inherited: "Inherited", locked: "Locked", changeSummary: (grants, revokes) => `${grants} added, ${revokes} removed`,
    }}
  />;
}

/** sections.access-matrix: roles are columns, permission groups are rows, cells are Checkbox toggles. */
export function renderAccessMatrix(input: SectionRenderInput) {
  return <AccessMatrixFill roles={recordsOf<AccessRole>(input, "roles")} groups={recordsOf<AccessGroupRecord>(input, "permissions")} />;
}

export const accessMatrixSection: GroupBSection = { leaf: "sections.access-matrix", slots: ["permissions", "roles"], render: renderAccessMatrix };
