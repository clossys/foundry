import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./preview-runtime/components/button/button.js";
import { IconButton } from "./IconButton.js";
import { SearchField, SearchInput } from "./intent/search-field.js";
import { Label } from "./intent/field.js";
import { StockSelect as Select } from "../blocks/stock-select.js";
import { Toggle } from "./toggle-button/toggle.js";
import { Toggle as StockToggle } from "./preview-runtime/components/toggle-button/toggle.js";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup.js";
import { Popover, PopoverTrigger } from "./preview-runtime/components/popover/popover.js";
import { X } from "../icons/X.js";
import { CommandMenu as CommandMenuBase } from "../blocks/CommandMenu.js";
import { withShellCopy } from "../frames/__fixtures__/shell-copy.js";

const CommandMenu = withShellCopy(CommandMenuBase);
afterEach(cleanup);
const name = "Control";
const options = [{ id: "one", label: "One" }];
// R2F-33d1: the text field is the stock shadcn@aria input; its states are stock classes, pinned in control-boundary and field-focus.
const cases: [string, (disabled: boolean) => ReactElement, () => HTMLElement][] = [
  ["IconButton", d => <IconButton isDisabled={d} icon={X} label={name} />, () => screen.getByRole("button", { name })],
  ["Toggle", d => <Toggle isDisabled={d}>{name}</Toggle>, () => screen.getByRole("button", { name })],
  ["ToggleGroup", d => <ToggleGroup isDisabled={d} aria-label="Format" selectionMode="multiple"><ToggleGroupItem id="one">{name}</ToggleGroupItem></ToggleGroup>, () => screen.getByRole("button", { name })],
  ["Popover trigger", d => <PopoverTrigger><IconButton isDisabled={d} icon={X} label={name} /><Popover aria-label="Details">Details</Popover></PopoverTrigger>, () => screen.getByRole("button", { name })],
];
const layer = (control: HTMLElement) => control.style.backgroundImage;

describe("control fill conformance", () => {
  // R2F-51: SearchField is the Intent UI search field; it paints hover, focus and disabled through its own classes, not the
  // Foundry state-alpha layer, so its states are pinned here instead of in the state-alpha table above.
  it("SearchField: hover tints the input line, focus draws the ring, disabled mutes the fill and blocks entry", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SearchField><Label>{name}</Label><SearchInput placeholder="Search here" /></SearchField>);
    const search = screen.getByRole("searchbox", { name });
    expect(search).toHaveClass("border-input", "enabled:hover:border-muted-foreground/30", "focus:ring-3", "focus:ring-ring/20", "disabled:bg-muted");
    await user.hover(search);
    expect(search).toHaveAttribute("data-hovered", "true");
    expect(layer(search)).toBe("");
    rerender(<SearchField isDisabled><Label>{name}</Label><SearchInput placeholder="Search here" /></SearchField>);
    const disabled = screen.getByRole("searchbox", { name });
    expect(disabled).toBeDisabled();
    await user.type(disabled, "x");
    expect(disabled).toHaveValue("");
  });

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

  // R2F-33d1 D-b: the text field is the stock one-size input; only the icon control keeps the size axis.
  it.each(["sm", "md", "lg"] as const)("%s uses the control-height token on square icon controls", size => {
    render(<IconButton size={size} icon={X} label="Icon"/>);
    for (const control of [screen.getByRole("button", { name: "Icon" })]) {
      if (control.style.blockSize) expect(control.style.blockSize).toContain(`--ui-control-h-${size}`);
      else expect(control).toHaveClass(`control-h-${size}`);
    }
    const compiled = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");
    expect(compiled).toContain(`&.control-h-${size} {\n      min-block-size: var(--ui-control-h-${size}, ${size === "sm" ? 28 : size === "md" ? 32 : 36}px);`);
    const icon = screen.getByRole("button", { name: "Icon" });
    expect(icon.style.inlineSize).toBe(icon.style.blockSize);
  });

  // R2F-51: the Intent input suppresses native appearance and the WebKit cancel button by class (no injected style tag).
  it("search suppresses native appearance and search chrome, and uses token placeholder ink", () => {
    render(<SearchField><Label>Search</Label><SearchInput /></SearchField>);
    const search = screen.getByRole("searchbox");
    expect(search).toHaveClass("appearance-none", "[&::-webkit-search-cancel-button]:hidden", "placeholder:text-muted-foreground");
  });

  it("the stock toggle keeps its selected state and action fill through hover and press", async () => {
    const user = userEvent.setup(), onChange = vi.fn();
    render(<StockToggle defaultSelected onChange={onChange}>Selected</StockToggle>);
    const toggle = screen.getByRole("button", { name: "Selected" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle.className.split(" ")).toContain("data-selected:bg-(--color-action)");
    await user.hover(toggle);
    expect(toggle).toHaveAttribute("data-hovered", "true");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("the stock button presses once, exposes hover and keyboard focus, and refuses presses when disabled", async () => {
    const user = userEvent.setup(), onPress = vi.fn();
    const view = render(<><button>Before</button><Button size="sm" onPress={onPress}>Act</Button></>);
    const button = screen.getByRole("button", { name: "Act" });
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button.className).toContain("--ui-control-h-sm");
    await user.hover(button);
    expect(button).toHaveAttribute("data-hovered", "true");
    await user.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Before" }));
    await user.tab();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("data-focus-visible", "true");
    view.rerender(<><button>Before</button><Button size="sm" isDisabled onPress={onPress}>Act</Button></>);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each(["sm", "md", "lg"] as const)("the stock select sizes its trigger to the %s control-height token through the selected size axis", size => {
    render(<Select label="Choice" size={size} options={options}/>);
    const trigger = screen.getByRole("button", { name: /Choice/ });
    expect(trigger.closest("[data-slot=select]")).toHaveAttribute("data-size", size);
    // The trigger carries no size of its own, so the root's size axis picks its height rule.
    expect(trigger).not.toHaveAttribute("data-size");
    expect(trigger.className).toContain(size === "md" ? "h-(--ui-control-h-md," : `group-data-[size=${size}]/select:not-data-[size]:h-(--ui-control-h-${size},`);
  });

  it("the stock select opens and picks from the keyboard, shows keyboard focus, and refuses to open when disabled", async () => {
    const user = userEvent.setup(), onSelectionChange = vi.fn();
    const view = render(<><button>Before</button><Select label="Choice" placeholder="Pick one" options={options} onSelectionChange={onSelectionChange}/></>);
    const trigger = screen.getByRole("button", { name: /Choice/ });
    await user.hover(trigger);
    expect(trigger).toHaveAttribute("data-hovered", "true");
    await user.click(screen.getByRole("button", { name: "Before" }));
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("data-focus-visible", "true");
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("option", { name: "One" }));
    expect(onSelectionChange).toHaveBeenCalledWith("one");
    expect(trigger).toHaveTextContent("One");
    view.rerender(<><button>Before</button><Select label="Choice" isDisabled options={options} onSelectionChange={onSelectionChange}/></>);
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
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
    render(<><Button isDisabled aria-describedby="save-reason">Save</Button><span id="save-reason">Complete the required fields</span></>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAccessibleDescription("Complete the required fields");
  });

  it("primary rest remains action-filled and does not imply an unexplained unavailable state", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveClass("bg-(--color-action)", "text-(--color-ink-on-action)");
    expect(button).not.toBeDisabled();
    expect(button.style.opacity).toBe("");
    expect(button.style.backgroundColor).toBe("");
  });
});
