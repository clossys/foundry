import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button.js";
import { IconButton } from "./IconButton.js";
import { TextField } from "./TextField.js";
import { SearchField } from "./SearchField.js";
import { Select } from "./Select.js";
import { ToggleButton } from "./ToggleButton.js";
import { Toggle } from "./toggle-button/toggle.js";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup.js";
import { Tabs } from "./Tabs.js";
import { Menu } from "./Menu.js";
import { Link } from "./Link.js";
import { Popover } from "./Popover.js";
import { X } from "../icons/X.js";
import { CommandMenu as CommandMenuBase } from "../blocks/CommandMenu.js";
import { withShellCopy } from "../frames/__fixtures__/shell-copy.js";

const CommandMenu = withShellCopy(CommandMenuBase);
afterEach(cleanup);
const name = "Control";
const options = [{ id: "one", label: "One" }];
const cases: [string, (disabled: boolean) => ReactElement, () => HTMLElement][] = [
  ["Button", d => <Button isDisabled={d}>{name}</Button>, () => screen.getByRole("button", { name })],
  ["IconButton", d => <IconButton isDisabled={d} icon={X} label={name} />, () => screen.getByRole("button", { name })],
  ["TextField", d => <TextField isDisabled={d} label={name} placeholder="Type here" />, () => screen.getByRole("textbox", { name })],
  ["SearchField", d => <SearchField isDisabled={d} label={name} placeholder="Search here" />, () => screen.getByRole("searchbox", { name })],
  ["Select", d => <Select isDisabled={d} label={name} options={options} />, () => screen.getByRole("button", { name: /Control/ })],
  ["ToggleButton", d => <ToggleButton isDisabled={d}>{name}</ToggleButton>, () => screen.getByRole("button", { name })],
  ["Toggle", d => <Toggle isDisabled={d}>{name}</Toggle>, () => screen.getByRole("button", { name })],
  ["ToggleGroup", d => <ToggleGroup isDisabled={d} aria-label="Format" selectionMode="multiple"><ToggleGroupItem id="one">{name}</ToggleGroupItem></ToggleGroup>, () => screen.getByRole("button", { name })],
  ["Tabs", d => <Tabs><Tabs.List aria-label="Sections"><Tabs.Tab id="one" isDisabled={d}>{name}</Tabs.Tab></Tabs.List><Tabs.Panel id="one">Panel</Tabs.Panel></Tabs>, () => screen.getByRole("tab", { name })],
  ["Menu", d => <Menu.Inline aria-label="Actions"><Menu.Item id="one" isDisabled={d}>{name}</Menu.Item></Menu.Inline>, () => screen.getByRole("menuitem", { name })],
  ["Link", d => <Link href="#destination" isDisabled={d}>{name}</Link>, () => screen.getByRole("link", { name })],
  ["Popover trigger", d => <Popover trigger={<Button isDisabled={d}>{name}</Button>} aria-label="Details">Details</Popover>, () => screen.getByRole("button", { name })],
];
const layer = (control: HTMLElement) => control.style.backgroundImage;

describe("control fill conformance", () => {
  it.each(cases)("%s: rest, hover, pressed and release bind independent state-alpha tokens", async (_name, make, get) => {
    const user = userEvent.setup();
    render(make(false));
    const control = get();
    expect(layer(control)).toBe("");
    await user.hover(control);
    expect(layer(control)).toContain("--ui-state-hover-alpha");
    const hover = layer(control);
    await user.pointer({ target: control, keys: "[MouseLeft>]" });
    expect(layer(control)).toContain("--ui-state-pressed-alpha");
    expect(layer(control)).not.toBe(hover);
    await user.pointer({ keys: "[/MouseLeft]" });
    // Some peers open a popup on release; the trigger still owns its state.
    expect(layer(control)).not.toContain("--ui-state-pressed-alpha");
  });

  it.each(cases)("%s: disabled has token ink and no hover or pressed layer", async (_name, make, get) => {
    const user = userEvent.setup();
    render(make(true));
    const control = get();
    expect(control.getAttribute("disabled") !== null || control.getAttribute("aria-disabled") === "true").toBe(true);
    expect(control.style.color).toContain("--color-ink-muted");
    await user.hover(control);
    fireEvent.pointerDown(control);
    expect(layer(control)).toBe("");
  });

  it.each(cases)("%s: keyboard focus has one offset accent outline; pointer focus has none", async (_name, make, get) => {
    const user = userEvent.setup();
    render(<><button>Before</button>{make(false)}</>);
    await user.tab();
    await user.tab();
    const control = get();
    expect(control).toHaveFocus();
    expect(control.style.outline).toContain("--color-focus-ring");
    expect(control.style.outlineOffset).toContain("--ui-focus-offset");
    expect(control.style.boxShadow).toBe("");
    expect(control.className).not.toMatch(/focus-visible:ring-/);
    await user.click(screen.getByRole("button", { name: "Before" }));
    await user.pointer({ target: control, keys: "[MouseLeft>]" });
    expect(control.style.outline).toBe("");
    await user.pointer({ keys: "[/MouseLeft]" });
  });

  it.each(["sm", "md", "lg"] as const)("%s uses the control-height token, including square icon controls", size => {
    render(<><Button size={size}>Action</Button><Button variant="ghost" size={size}>Ghost action</Button><TextField label="Field" size={size}/><Select label="Choice" size={size} options={options}/><IconButton size={size} icon={X} label="Icon"/></>);
    for (const control of [screen.getByRole("button", { name: "Action" }), screen.getByRole("button", { name: "Ghost action" }), screen.getByRole("textbox"), screen.getByRole("button", { name: /Choice/ }), screen.getByRole("button", { name: "Icon" })]) {
      if (control.style.blockSize) expect(control.style.blockSize).toContain(`--ui-control-h-${size}`);
      else expect(control).toHaveClass(`control-h-${size}`);
    }
    const quiet = screen.getByRole("button", { name: "Ghost action" });
    expect(quiet.style.blockSize).toBe("");
    expect(quiet.style.minBlockSize).toBe("");
    const compiled = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");
    expect(compiled).toContain(`&.control-h-${size} {\n      min-block-size: var(--ui-control-h-${size}, ${size === "sm" ? 28 : size === "md" ? 32 : 36}px);`);
    const icon = screen.getByRole("button", { name: "Icon" });
    expect(icon.style.inlineSize).toBe(icon.style.blockSize);
  });

  it("search and select suppress native appearance, search chrome, and use token placeholder ink", () => {
    render(<><SearchField label="Search"/><Select label="Choice" options={options}/></>);
    const search = screen.getByRole("searchbox");
    expect(search.style.appearance).toBe("none");
    expect(screen.getByRole("button", { name: /Choice/ }).style.appearance).toBe("none");
    expect(search).toHaveClass("placeholder:text-ink-muted");
    expect(document.head.querySelector('style[data-href="designer-native-search"]')?.textContent).toContain("::-webkit-search-cancel-button");
    expect(document.head.querySelector('style[data-href="designer-native-search"]')?.textContent).toContain("appearance: none");
  });

  it("selected toggles retain action fill under hover and pressed layers", async () => {
    const user = userEvent.setup();
    render(<ToggleButton isSelected>Selected</ToggleButton>);
    const toggle = screen.getByRole("button");
    await user.hover(toggle);
    expect(toggle).toHaveClass("bg-action");
    expect(layer(toggle)).toContain("--ui-state-hover-alpha");
    await user.pointer({ target: toggle, keys: "[MouseLeft>]" });
    expect(toggle).toHaveClass("bg-action");
    expect(layer(toggle)).toContain("--ui-state-pressed-alpha");
    await user.pointer({ keys: "[/MouseLeft]" });
  });

  it.each(["horizontal", "vertical"] as const)("%s tabs have a separate indicator only on the selected tab", orientation => {
    render(<Tabs orientation={orientation}><Tabs.List aria-label="Sections"><Tabs.Tab id="a">A</Tabs.Tab><Tabs.Tab id="b">B</Tabs.Tab></Tabs.List><Tabs.Panel id="a">A panel</Tabs.Panel><Tabs.Panel id="b">B panel</Tabs.Panel></Tabs>);
    expect(screen.getByRole("tab", { name: "A" }).querySelector("[data-tab-indicator]")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "B" }).querySelector("[data-tab-indicator]")).toBeNull();
    for (const tab of screen.getAllByRole("tab")) expect(tab).not.toHaveClass("border-b-2", "border-s-2");
  });

  it("command results compose states, use disabled ink and suppress descriptions repeating the group", async () => {
    const user = userEvent.setup();
    render(<CommandMenu heading="Commands" searchLabel="Search commands" closeLabel="Close" emptyMessage="Empty" isOpen onOpenChange={vi.fn()} query="" onQueryChange={vi.fn()} groups={[{ id: "group", label: "Actions", items: [
      { id: "one", label: "Enabled", description: "Actions", onAction: vi.fn() },
      { id: "two", label: "Disabled", disabled: true, onAction: vi.fn() },
    ] }]}/>);
    const result = screen.getByRole("option", { name: "Enabled" });
    expect(layer(result)).toBe("");
    await user.hover(result);
    expect(layer(result)).toContain("--ui-state-hover-alpha");
    await user.pointer({ target: result, keys: "[MouseLeft>]" });
    expect(layer(result)).toContain("--ui-state-pressed-alpha");
    await user.pointer({ keys: "[/MouseLeft]" });
    expect(screen.getByRole("option", { name: "Disabled" }).style.color).toContain("--color-ink-muted");
    expect(screen.getAllByText("Actions")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("rounded-control");
  });

  it("command result layers reset across a query change and reopen", async () => {
    const user = userEvent.setup();
    const menu = (isOpen: boolean, query = "") => <CommandMenu heading="Commands" searchLabel="Search commands" closeLabel="Close" emptyMessage="Empty" isOpen={isOpen} onOpenChange={vi.fn()} query={query} onQueryChange={vi.fn()} groups={[{ id: "group", label: "Actions", items: [{ id: "one", label: "Enabled", onAction: vi.fn() }] }]}/>;
    const view = render(menu(true));
    await user.hover(screen.getByRole("option", { name: "Enabled" }));
    view.rerender(menu(true, "Enabled"));
    expect(layer(screen.getByRole("option", { name: "Enabled" }))).toBe("");
    fireEvent.pointerDown(screen.getByRole("option", { name: "Enabled" }));
    expect(layer(screen.getByRole("option", { name: "Enabled" }))).toContain("--ui-state-pressed-alpha");
    view.rerender(menu(false));
    view.rerender(menu(true));
    expect(layer(screen.getByRole("option", { name: "Enabled" }))).toBe("");
  });

  it("a disabled action can expose its explicit reason without changing the enabled default", () => {
    render(<Button isDisabled disabledReason="Complete the required fields">Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAccessibleDescription("Complete the required fields");
  });

  it("primary rest remains action-filled and does not imply an unexplained unavailable state", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveClass("bg-action", "text-ink-on-action");
    expect(button).not.toBeDisabled();
    expect(button.style.opacity).toBe("");
    expect(button.style.backgroundColor).toBe("");
  });
});
