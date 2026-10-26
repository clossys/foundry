import { act } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GridList, type GridListSelectionCheckboxProps } from "./GridList.js";

describe("GridList", () => {
  it("G1 refuses an unnamed grid and accepts either host naming path", () => {
    expect(() => render(<GridList>{[]}</GridList>)).toThrow(TypeError);
    const { unmount } = render(<><h2 id="records-title">Records</h2><GridList aria-labelledby="records-title">{[]}</GridList></>);
    expect(screen.getByRole("grid", { name: "Records" })).toBeInTheDocument();
    unmount();
    render(<GridList aria-label="Notes">{[]}</GridList>);
    expect(screen.getByRole("grid", { name: "Notes" })).toHaveAttribute("data-layout", "stack");
  });

  it("G2 Space toggles selection while Enter performs one action without changing it", async () => {
    const action = vi.fn();
    const user = userEvent.setup();
    render(<GridList aria-label="Notes" selectionMode="multiple" onAction={action}>
      <GridList.Item id="one" textValue="Planning note">Planning note</GridList.Item>
    </GridList>);
    const row = screen.getByRole("row");
    act(() => row.focus());
    await user.keyboard(" ");
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(action).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(action).toHaveBeenCalledExactlyOnceWith("one");
    expect(row).toHaveAttribute("aria-selected", "true");
    await user.keyboard(" ");
    expect(row).toHaveAttribute("aria-selected", "false");
  });

  it("G3 keeps the host empty state within the grid", () => {
    render(<GridList aria-label="Notes" renderEmptyState={() => <p>No notes yet</p>}>{[]}</GridList>);
    expect(within(screen.getByRole("grid")).getByText("No notes yet")).toBeInTheDocument();
  });

  it("G4 exposes selected state through a checked checkbox and data-selected", async () => {
    const user = userEvent.setup();
    render(<GridList aria-label="Notes" selectionMode="multiple">
      <GridList.Item id="one" textValue="Planning note">
        <GridList.SelectionCheckbox aria-label="Choose planning note" />Planning note
      </GridList.Item>
    </GridList>);
    const checkbox = screen.getByRole("checkbox", { name: "Choose planning note" });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByRole("row")).toHaveAttribute("data-selected");
    expect(screen.getByRole("row")).toHaveClass("bg-surface-selected");
  });

  it("retains selected paint on hover and forced-colour focus before selection", async () => {
    const user = userEvent.setup();
    render(<GridList aria-label="Notes" selectionMode="multiple">
      <GridList.Item id="one" textValue="Planning note">Planning note</GridList.Item>
      <GridList.Item id="two" textValue="Research note">Research note</GridList.Item>
    </GridList>);
    const rows = screen.getAllByRole("row");
    act(() => rows[0]!.focus());
    await user.keyboard("{ArrowDown}");
    expect(rows[1]).toHaveFocus();
    expect(rows[1]).toHaveAttribute("aria-selected", "false");
    expect(rows[1]).toHaveClass("forced-colors:outline-solid", "forced-colors:outline-2", "forced-colors:-outline-offset-2");
    await user.hover(rows[1]!);
    await user.keyboard(" ");
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(rows[1]).toHaveClass("bg-surface-selected");
    expect(rows[1]).not.toHaveClass("hover:bg-surface-sunken");
    expect(rows[1]).toHaveClass("forced-colors:outline-2");
    await user.keyboard("{ArrowUp}");
    expect(rows[0]).toHaveFocus();
    expect(rows[1]).toHaveClass("forced-colors:outline", "forced-colors:outline-solid");
    expect(rows[1]).not.toHaveClass("forced-colors:outline-2");
  });

  it("G5 uses only the supplied selection checkbox name", () => {
    expect(() => render(<GridList aria-label="Notes" selectionMode="multiple">
      <GridList.Item id="one" textValue="Planning note"><GridList.SelectionCheckbox {...{} as GridListSelectionCheckboxProps} />Planning note</GridList.Item>
    </GridList>)).toThrow(TypeError);
    render(<GridList aria-label="Notes" selectionMode="multiple">
      <GridList.Item id="one" textValue="Planning note">
        <GridList.SelectionCheckbox aria-label="Choose this record" />Planning note
      </GridList.Item>
    </GridList>);
    expect(screen.getByRole("checkbox")).toHaveAccessibleName("Choose this record");
    expect(screen.queryByText("Select row")).not.toBeInTheDocument();
  });

  it("delegates arrow navigation, boundaries and typeahead to the collection", async () => {
    const user = userEvent.setup();
    render(<GridList aria-label="Notes">
      <GridList.Item id="one" textValue="Planning">Planning</GridList.Item>
      <GridList.Item id="two" textValue="Research">Research</GridList.Item>
      <GridList.Item id="three" textValue="Summary">Summary</GridList.Item>
    </GridList>);
    const rows = screen.getAllByRole("row");
    act(() => rows[0]!.focus());
    await user.keyboard("{ArrowDown}"); expect(rows[1]).toHaveFocus();
    await user.keyboard("{End}"); expect(rows[2]).toHaveFocus();
    await user.keyboard("{Home}"); expect(rows[0]).toHaveFocus();
    await user.keyboard("r"); expect(rows[1]).toHaveFocus();
  });

  it("activates unselected rows once with empty or nonempty peer selection", async () => {
    const rootAction = vi.fn(); const itemAction = vi.fn(); const user = userEvent.setup();
    const { rerender } = render(<GridList aria-label="Notes" selectionMode="multiple" selectedKeys={new Set()} onAction={rootAction}>
      <GridList.Item id="one" textValue="Planning note" onAction={itemAction} render={props => <div {...props} data-record-render />}>Planning note</GridList.Item>
      <GridList.Item id="two" textValue="Research note">Research note</GridList.Item>
    </GridList>);
    act(() => screen.getAllByRole("row")[0]!.focus()); await user.keyboard("{Enter}");
    expect(screen.getAllByRole("row")[0]).toHaveAttribute("data-record-render");
    expect(rootAction).toHaveBeenCalledExactlyOnceWith("one"); expect(itemAction).toHaveBeenCalledTimes(1);
    expect(itemAction.mock.invocationCallOrder[0]).toBeLessThan(rootAction.mock.invocationCallOrder[0]!);
    rerender(<GridList aria-label="Notes" selectionMode="multiple" selectedKeys={new Set(["two"])} onAction={rootAction}>
      <GridList.Item id="one" textValue="Planning note" onAction={itemAction} render={props => <div {...props} data-record-render />}>Planning note</GridList.Item>
      <GridList.Item id="two" textValue="Research note">Research note</GridList.Item>
    </GridList>);
    act(() => screen.getAllByRole("row")[0]!.focus()); await user.keyboard("{Enter}");
    expect(rootAction).toHaveBeenCalledTimes(2); expect(rootAction).toHaveBeenLastCalledWith("one");
    expect(itemAction).toHaveBeenCalledTimes(2);
    expect(itemAction.mock.invocationCallOrder[1]).toBeLessThan(rootAction.mock.invocationCallOrder[1]!);
    expect(screen.getAllByRole("row")[0]).toHaveAttribute("aria-selected", "false");
    expect(screen.getAllByRole("row")[1]).toHaveAttribute("aria-selected", "true");
  });

  it("leaves disabled rows and nested controls outside the Enter adapter", async () => {
    const rowAction = vi.fn(); const childAction = vi.fn(); const user = userEvent.setup();
    render(<GridList aria-label="Notes" selectionMode="multiple" selectedKeys={new Set(["one"])} onAction={rowAction}>
      <GridList.Item id="one" textValue="Planning note"><button onClick={childAction}>Edit note</button></GridList.Item>
      <GridList.Item id="two" textValue="Archived note" isDisabled>Archived note</GridList.Item>
    </GridList>);
    const button = screen.getByRole("button", { name: "Edit note" });
    act(() => button.focus()); await user.keyboard("{Enter}");
    expect(childAction).toHaveBeenCalledExactlyOnceWith(expect.anything());
    expect(rowAction).not.toHaveBeenCalled();
    const disabled = screen.getByRole("row", { name: "Archived note" });
    act(() => disabled.focus()); await user.keyboard("{Enter}");
    expect(rowAction).not.toHaveBeenCalled();
    expect(disabled).not.toHaveAttribute("aria-selected", "true");
    expect(disabled).not.toHaveAttribute("data-selected");
  });

  it("clears pending Enter on blur and ignores an unpaired keyup", async () => {
    const action = vi.fn(); const user = userEvent.setup();
    render(<GridList aria-label="Notes" selectionMode="multiple" selectedKeys={new Set(["one"])} onAction={action}>
      <GridList.Item id="one" textValue="Planning note">Planning note</GridList.Item>
    </GridList>);
    const row = screen.getByRole("row");
    act(() => row.focus()); fireEvent.keyUp(row, { key: "Enter", code: "Enter" });
    expect(action).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
    act(() => row.blur()); fireEvent.keyUp(row, { key: "Enter", code: "Enter" });
    expect(action).not.toHaveBeenCalled();
    act(() => row.focus()); await user.keyboard("{Enter}");
    expect(action).toHaveBeenCalledExactlyOnceWith("one");
  });

  it.each([
    { name: "selection cleared", selectedKeys: new Set<string>(), disabledKeys: [] as string[] },
    { name: "selection disabled", selectedKeys: new Set(["one"]), disabledKeys: ["one"] },
  ])("rechecks peer Enter ownership when $name before keyup", async ({ selectedKeys, disabledKeys }) => {
    const action = vi.fn(); const user = userEvent.setup();
    const content = (keys: Set<string>, disabled: string[] = []) => <GridList aria-label="Notes"
      selectionMode="multiple" disabledBehavior="selection" selectedKeys={keys} disabledKeys={disabled} onAction={action}>
      <GridList.Item id="one" textValue="Planning note">Planning note</GridList.Item>
    </GridList>;
    const { rerender } = render(content(new Set(["one"])));
    act(() => screen.getByRole("row").focus());
    await user.keyboard("{Enter>}");
    expect(action).not.toHaveBeenCalled();
    rerender(content(selectedKeys, disabledKeys));
    await user.keyboard("{/Enter}");
    expect(action).toHaveBeenCalledExactlyOnceWith("one");
  });

  it("honors caller cancellation before the caller delegates direct-row Enter", async () => {
    const action = vi.fn(); const cancelled = vi.fn(); const user = userEvent.setup();
    render(<GridList aria-label="Notes" selectionMode="multiple" selectedKeys={new Set(["one"])} onAction={action}>
      <GridList.Item id="one" textValue="Planning note" render={props => <div {...props} onKeyDown={event => {
        if (event.key === "Enter") { cancelled(); event.preventDefault(); }
        props.onKeyDown?.(event);
      }} />}>Planning note</GridList.Item>
    </GridList>);
    act(() => screen.getByRole("row").focus()); await user.keyboard("{Enter}");
    expect(cancelled).toHaveBeenCalledExactlyOnceWith();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("row")).toHaveAttribute("aria-selected", "true");
  });

  it.each([
    { selectionMode: "none" as const },
    { selectionMode: "multiple" as const, disabledBehavior: "selection" as const, disabledKeys: ["one"] },
  ])("keeps peer-owned Enter activation singular when the row cannot be selected: %j", async props => {
    const action = vi.fn(); const user = userEvent.setup();
    render(<GridList {...props} aria-label="Notes" selectedKeys={new Set(["two"])} onAction={action}>
      <GridList.Item id="one" textValue="Planning note">Planning note</GridList.Item>
      <GridList.Item id="two" textValue="Research note">Research note</GridList.Item>
    </GridList>);
    act(() => screen.getByRole("row", { name: "Planning note" }).focus()); await user.keyboard("{Enter}");
    expect(action).toHaveBeenCalledExactlyOnceWith("one");
  });
});

 it("SEL2 supports a RAC grid layout while keeping toggle selection", async () => {
  const user = userEvent.setup();
  render(<GridList aria-label="Cards" layout="grid" selectionMode="multiple">
   <GridList.Item id="one" textValue="One">One</GridList.Item>
   <GridList.Item id="two" textValue="Two">Two</GridList.Item>
  </GridList>);
  expect(screen.getByRole("grid")).toHaveAttribute("data-layout", "grid");
  expect(screen.getByRole("grid")).toHaveClass("grid");
  const row=screen.getAllByRole("row")[0]!; act(() => row.focus());
  await user.keyboard(" "); expect(row).toHaveAttribute("aria-selected", "true");
 });
