import { useId } from "react";
import { Button } from "../components/Button.js";
import { Checkbox } from "../components/Checkbox.js";
import { Icon } from "../components/Icon.js";
import { Tooltip } from "../components/Tooltip.js";
import { cx } from "../components/internal/cx.js";
import { Lock } from "../icons/Lock.js";
import { accessCell, assertAccessMatrix } from "./access-matrix/validate.js";
import { accessSummary, useDebouncedSummary } from "./access-matrix/summary.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.access-matrix", "foundry/sections.access-matrix");

export type AccessCellValue = { readonly state: "granted" | "denied" } | { readonly state: "inherited"; readonly reason: string };
export interface AccessRole { readonly id: string; readonly label: string; readonly isLocked?: boolean; readonly lockedReason?: string }
export interface AccessPermission { readonly id: string; readonly label: string; readonly description?: string }
export interface AccessGroup { readonly id: string; readonly label: string; readonly permissions: readonly AccessPermission[] }
/** Missing cells mean denied. The host owns validation and enforcement. */
export type AccessMatrixValue = Readonly<Record<string, Readonly<Record<string, AccessCellValue>>>>;
export interface AccessMatrixChange { readonly roleId: string; readonly permissionIds: readonly string[]; readonly state: "granted" | "denied" }
export interface AccessMatrixLabels {
  permissionHeader: string;
  cell: (role: string, permission: string) => string;
  groupAll: (role: string, group: string) => string;
  inherited: string;
  locked: string;
  changeSummary: (grants: number, revokes: number) => string;
}
export interface AccessMatrixProps {
  "aria-label": string;
  roles: readonly AccessRole[];
  groups: readonly AccessGroup[];
  value: AccessMatrixValue;
  labels: AccessMatrixLabels;
  onChange?: (next: AccessMatrixValue, change: AccessMatrixChange) => void;
  baseline?: AccessMatrixValue;
  className?: string;
}

const FIRST = "min-w-0 bg-surface-raised border-e border-line-strong tablet:sticky tablet:start-0";
const CELL = "flex min-w-0 items-start justify-between gap-md px-md py-sm tablet:table-cell tablet:align-top";

/** Displays and edits host-supplied state; the host validates and enforces every change. */
export function AccessMatrix(props: AccessMatrixProps) {
  assertAccessMatrix(props);
  const { roles, groups, value, labels, onChange, baseline, className } = props;
  const id = useId();
  const summary = baseline ? accessSummary(roles, groups, value, baseline) : { grants: 0, revokes: 0 };
  const announced = useDebouncedSummary(baseline ? labels.changeSummary(summary.grants, summary.revokes) : "");
  const emit = (role: AccessRole, permissionIds: readonly string[], state: "granted" | "denied") => {
    if (!onChange || role.isLocked || permissionIds.length === 0) return;
    let cells = { ...(Object.hasOwn(value, role.id) ? value[role.id] : undefined) };
    for (const permission of permissionIds) {
      if (accessCell(value, role.id, permission)?.state === "inherited") continue;
      cells = { ...cells, [permission]: { state } };
    }
    onChange({ ...value, [role.id]: cells }, { roleId: role.id, permissionIds, state });
  };
  return <div {...SECTION_STAMP} className={cx("min-w-0 space-y-md text-body text-ink-primary", className)}>
    <div className="max-w-full overflow-x-auto">
      <table aria-label={props["aria-label"]} role="table" className="block w-full border-separate border-spacing-0 tablet:table tablet:table-fixed">
        <thead className="sr-only focus-within:not-sr-only focus-within:block focus-within:w-full focus-within:overflow-x-auto tablet:not-sr-only tablet:table-header-group tablet:focus-within:table-header-group tablet:focus-within:w-auto tablet:focus-within:overflow-visible">
          <tr role="row">
            <th scope="col" role="columnheader" className={cx(FIRST, "px-md py-sm text-start text-body-s font-medium")}>{labels.permissionHeader}</th>
            {roles.map((role, roleIndex) => {
              const reasonId = `${id}-role-${roleIndex}`;
              return <th key={role.id} scope="col" role="columnheader" className="px-md py-sm text-start align-top text-body-s font-medium">
              <span className="flex min-w-0 flex-col gap-xs"><span className="wrap-anywhere">{role.label}</span>{role.isLocked ? <>
                {role.lockedReason ? <Tooltip trigger={<Button variant="ghost" aria-describedby={reasonId} className="justify-start px-0">
                  <Icon glyph={Lock} decorative size="sm" /><span>{labels.locked}</span>
                </Button>}>{role.lockedReason}</Tooltip> : <span className="inline-flex items-center gap-xs"><Icon glyph={Lock} decorative size="sm" />{labels.locked}</span>}
                {role.lockedReason ? <span id={reasonId} className="sr-only">{role.lockedReason}</span> : null}
              </> : null}</span>
            </th>;
            })}
          </tr>
        </thead>
        {groups.map((group, groupIndex) => <tbody key={group.id} role="rowgroup" className="flex min-w-0 flex-col gap-md tablet:table-row-group">
          <tr role="row" className="flex min-w-0 flex-col gap-sm border-b border-line-strong tablet:table-row">
            <th scope="rowgroup" role="rowheader" className={cx(FIRST, "px-md py-sm text-start text-body-s font-medium")}>{group.label}</th>
            {roles.map(role => {
              const editable = role.isLocked ? [] : group.permissions.filter(permission => accessCell(value, role.id, permission.id)?.state !== "inherited");
              const granted = editable.filter(permission => accessCell(value, role.id, permission.id)?.state === "granted").length;
              const all = editable.length > 0 && granted === editable.length;
              return <td key={role.id} role="cell" className={CELL}>
                <span aria-hidden="true" className="min-w-0 wrap-anywhere text-body-s text-ink-secondary tablet:hidden">{role.label}</span>
                <Checkbox isSelected={all} isIndeterminate={granted > 0 && !all} isReadOnly={!onChange || editable.length === 0}
                  onChange={() => emit(role, editable.map(permission => permission.id), all ? "denied" : "granted")}>
                  <span className="sr-only">{labels.groupAll(role.label, group.label)}</span>
                </Checkbox>
              </td>;
            })}
          </tr>
          {group.permissions.map((permission, permissionIndex) => <tr key={permission.id} role="row" className="flex min-w-0 flex-col gap-sm rounded-panel border-b border-line-base bg-surface-raised p-sm tablet:table-row tablet:rounded-none tablet:p-0">
            <th scope="row" role="rowheader" className={cx(FIRST, "flex min-w-0 flex-col gap-xs px-md py-sm text-start font-normal tablet:table-cell")}>
              <span className="wrap-anywhere text-body-s font-medium">{permission.label}</span>
              {permission.description ? <span className="wrap-anywhere text-caption text-ink-secondary">{permission.description}</span> : null}
            </th>
            {roles.map((role, roleIndex) => {
              const cell = accessCell(value, role.id, permission.id);
              const inherited = cell?.state === "inherited";
              const reason = inherited ? cell.reason : role.isLocked ? role.lockedReason : undefined;
              const reasonId = `${id}-cell-${groupIndex}-${permissionIndex}-${roleIndex}`;
              const control = <Checkbox isSelected={cell?.state === "granted"} isReadOnly={!onChange || !!role.isLocked || inherited}
                aria-describedby={reason ? reasonId : undefined} onChange={selected => emit(role, [permission.id], selected ? "granted" : "denied")}>
                <span className="sr-only">{labels.cell(role.label, permission.label)}</span>
              </Checkbox>;
              return <td key={role.id} role="cell" className={CELL}>
                <span aria-hidden="true" className="min-w-0 wrap-anywhere text-body-s text-ink-secondary tablet:hidden">{role.label}</span>
                <span className="inline-flex min-w-0 flex-wrap items-center gap-xs">
                  {reason ? <Tooltip trigger={control}>{reason}</Tooltip> : control}
                  {inherited ? <span className="inline-flex min-w-0 items-center gap-xs text-caption text-ink-secondary"><Icon glyph={Lock} decorative size="sm" /><span className="wrap-anywhere">{labels.inherited}</span></span> : null}
                  {reason ? <span id={reasonId} className="sr-only">{reason}</span> : null}
                </span>
              </td>;
            })}
          </tr>)}
        </tbody>)}
      </table>
    </div>
    {baseline ? <span role="status" aria-live="polite" className="block text-body-s text-ink-secondary">{announced}</span> : null}
  </div>;
}
