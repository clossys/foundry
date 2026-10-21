import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccessMatrix, type AccessMatrixProps, type AccessMatrixValue } from "./AccessMatrix.js";
import { accessMatrixSample } from "./access-matrix/sample.js";

afterEach(() => vi.useRealTimers());
const props = () => ({ ...accessMatrixSample, onChange: vi.fn() });

describe("AccessMatrix", () => {
  it("renders the sample as one native table, grouped bodies, and exact role-permission checkbox names (MA5, MA8)", () => {
    render(<AccessMatrix {...props()} />);
    const table = screen.getByRole("table", { name: accessMatrixSample["aria-label"] });
    expect(table.tagName).toBe("TABLE");
    expect(table.querySelectorAll("tbody")).toHaveLength(3);
    expect(screen.getAllByRole("rowgroup")).toHaveLength(4);
    for (const group of accessMatrixSample.groups) {
      expect(screen.getByRole("rowheader", { name: group.label })).toHaveAttribute("scope", "rowgroup");
      for (const permission of group.permissions) for (const role of accessMatrixSample.roles) {
        expect(screen.getByRole("checkbox", { name: accessMatrixSample.labels.cell(role.label, permission.label), exact: true })).toBeInTheDocument();
      }
    }
    const cells = accessMatrixSample.roles.flatMap(role => accessMatrixSample.groups.flatMap(group => group.permissions.map(permission => screen.getByRole("checkbox", { name: accessMatrixSample.labels.cell(role.label, permission.label), exact: true }) as HTMLInputElement)));
    expect(cells.filter(cell => cell.checked)).toHaveLength(12);
    expect(screen.getByRole("checkbox", { name: "Viewer: Create projects" })).not.toBeChecked();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("grants a mixed group's editable cells and preserves inherited and locked state (MA5, MA6)", async () => {
    const user = userEvent.setup();
    const original = props();
    const value: AccessMatrixValue = { ...original.value, editor: { ...original.value.editor, "delete-projects": { state: "inherited", reason: "Included with Viewer access to reports." }, "create-projects": { state: "denied" } } };
    const nextProps = { ...original, value };
    const { rerender } = render(<AccessMatrix {...nextProps} />);
    const all = screen.getByRole("checkbox", { name: "Editor: all of Projects" }) as HTMLInputElement;
    expect(screen.getByRole("checkbox", { name: "Admin: all of Projects" })).toHaveAttribute("aria-readonly", "true");
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
    await user.click(all);
    const [next, change] = original.onChange.mock.calls[0]!;
    expect(change).toEqual({ roleId: "editor", permissionIds: ["view-projects", "create-projects"], state: "granted" });
    expect(next.editor["create-projects"]).toEqual({ state: "granted" });
    expect(next.editor["delete-projects"]).toEqual(value.editor!["delete-projects"]);
    expect(next.admin).toEqual(value.admin);
    expect(value.editor!["create-projects"]).toEqual({ state: "denied" });
    rerender(<AccessMatrix {...nextProps} value={next} />);
    expect(all.indeterminate).toBe(false);
    expect(all).toBeChecked();
    await user.click(all);
    expect(original.onChange.mock.calls[1]![1]).toEqual({ roleId: "editor", permissionIds: ["view-projects", "create-projects"], state: "denied" });
  });

  it("emits a controlled single-cell intent without modifying the supplied value", async () => {
    const user = userEvent.setup(), original = props();
    render(<AccessMatrix {...original} />);
    await user.click(screen.getByRole("checkbox", { name: "Viewer: Create projects" }));
    const [next, change] = original.onChange.mock.calls[0]!;
    expect(next.viewer["create-projects"]).toEqual({ state: "granted" });
    expect(change).toEqual({ roleId: "viewer", permissionIds: ["create-projects"], state: "granted" });
    expect(original.value.viewer?.["create-projects"]).toBeUndefined();
  });

  it.each([["viewer", "__proto__"], ["__proto__", "constructor"], ["constructor", "__proto__"]])("round-trips declared prototype-shaped identities safely: %s / %s", async (roleId, permissionId) => {
    const user = userEvent.setup(), changed = vi.fn();
    const value: AccessMatrixValue = Object.assign(Object.create(null), { [roleId]: Object.create(null) });
    const original: AccessMatrixProps = { ...accessMatrixSample, roles: [{ id: roleId!, label: "Editor" }], groups: [{ id: "projects", label: "Projects", permissions: [{ id: permissionId!, label: "Create projects" }] }], value, baseline: undefined, onChange: changed };
    const { rerender } = render(<AccessMatrix {...original} />);
    const checkbox = screen.getByRole("checkbox", { name: "Editor: Create projects" });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    const next = changed.mock.calls[0]![0] as AccessMatrixValue;
    expect(Object.hasOwn(next, roleId!)).toBe(true);
    expect(Object.hasOwn(next[roleId!]!, permissionId!)).toBe(true);
    expect(next[roleId!]![permissionId!]).toEqual({ state: "granted" });
    expect(Object.getPrototypeOf(next[roleId!]!)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(value[roleId!]!)).toBeNull();
    expect(Object.hasOwn(value[roleId!]!, permissionId!)).toBe(false);
    rerender(<AccessMatrix {...original} value={next} />);
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    const denied = changed.mock.calls[1]![0] as AccessMatrixValue;
    expect(Object.hasOwn(denied[roleId!]!, permissionId!)).toBe(true);
    expect(denied[roleId!]![permissionId!]).toEqual({ state: "denied" });
  });

  it("keeps inherited and locked controls read-only, focusable, and described by their reasons", async () => {
    const user = userEvent.setup(), original = props();
    render(<AccessMatrix {...original} />);
    const inherited = screen.getByRole("checkbox", { name: "Editor: Export reports" });
    expect(inherited).not.toBeDisabled();
    expect(inherited).toHaveAttribute("aria-readonly", "true");
    expect(inherited).toHaveAccessibleDescription(/Included with Viewer access to reports/);
    expect(within(inherited.closest("td")!).getByText("Inherited")).toBeVisible();
    expect(inherited.closest("td")!.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    await user.tab();
    act(() => inherited.focus());
    expect(inherited).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Included with Viewer access to reports.");
    await user.keyboard(" ");
    expect(original.onChange).not.toHaveBeenCalled();
    const admin = screen.getByRole("columnheader", { name: /Admin/ });
    expect(within(admin).getByText("Locked")).toBeVisible();
    expect(admin.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(within(admin).getByRole("button", { name: "Locked" })).toHaveAccessibleDescription(/Admin always has every permission/);
    const locked = screen.getByRole("checkbox", { name: "Admin: View projects" });
    expect(locked).toHaveAttribute("aria-readonly", "true");
    expect(locked).not.toBeDisabled();
    expect(locked).toHaveAccessibleDescription(/Admin always has every permission/);
    await user.click(locked);
    expect(original.onChange).not.toHaveBeenCalled();
  });

  it("makes every checkbox read-only without onChange (MA7)", async () => {
    const user = userEvent.setup();
    render(<AccessMatrix {...accessMatrixSample} />);
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toHaveAttribute("aria-readonly", "true");
      expect(checkbox).not.toBeDisabled();
    }
    const target = screen.getByRole("checkbox", { name: "Viewer: Create projects" });
    await user.click(target);
    expect(target).not.toBeChecked();
    act(() => target.focus());
    expect(target).toHaveFocus();
  });

  it("makes group-all read-only when its only permission is inherited", () => {
    const original = props();
    render(<AccessMatrix {...original} groups={[{ id: "reports", label: "Reports", permissions: [{ id: "export-reports", label: "Export reports" }] }]} value={{ editor: { "export-reports": original.value.editor!["export-reports"]! } }} baseline={undefined} />);
    expect(screen.getByRole("checkbox", { name: "Editor: all of Reports" })).toHaveAttribute("aria-readonly", "true");
  });

  it("debounces baseline grants and revokes for 500ms and excludes inherited transitions (MA9)", () => {
    vi.useFakeTimers();
    const original = props();
    const { rerender } = render(<AccessMatrix {...original} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("1 added, 0 removed");
    const value: AccessMatrixValue = { ...original.value, viewer: { ...original.value.viewer, "view-projects": { state: "denied" }, "create-projects": { state: "granted" } }, editor: { ...original.value.editor, "export-reports": { state: "granted" } } };
    rerender(<AccessMatrix {...original} value={value} />);
    expect(screen.getByRole("status")).toBe(status);
    act(() => { vi.advanceTimersByTime(499); });
    expect(status).toHaveTextContent("1 added, 0 removed");
    act(() => { vi.advanceTimersByTime(1); });
    expect(status).toHaveTextContent("2 added, 1 removed");
  });

  it("omits the change summary when baseline is absent", () => {
    render(<AccessMatrix {...props()} baseline={undefined} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    ["role", (p: AccessMatrixProps) => ({ ...p, value: { ...p.value, unknown: {} } })],
    ["permission", (p: AccessMatrixProps) => ({ ...p, value: { ...p.value, viewer: { unknown: { state: "denied" } } } })],
    ["duplicate roles", (p: AccessMatrixProps) => ({ ...p, roles: [...p.roles, p.roles[0]] })],
    ["duplicate groups", (p: AccessMatrixProps) => ({ ...p, groups: [...p.groups, p.groups[0]] })],
    ["duplicate permissions", (p: AccessMatrixProps) => ({ ...p, groups: [...p.groups, { id: "other", label: "Other", permissions: [p.groups[0]!.permissions[0]] }] })],
  ] as const)("rejects undeclared and duplicate identities: %s (MA10)", (_name, change) => {
    expect(() => render(<AccessMatrix {...change(props()) as AccessMatrixProps} />)).toThrow(TypeError);
  });
});
