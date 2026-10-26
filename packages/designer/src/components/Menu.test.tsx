import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { Button as AriaButton } from "react-aria-components";
import { Menu } from "./Menu.js";

function BasicMenu({ onDelete }: { onDelete?: () => void } = {}) {
  return (
    <Menu trigger={<AriaButton>Actions</AriaButton>}>
      <Menu.Item onAction={vi.fn()}>Edit</Menu.Item>
      <Menu.Item isDisabled onAction={vi.fn()}>
        Duplicate
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item onAction={onDelete} isDestructive>
        Delete
      </Menu.Item>
    </Menu>
  );
}

describe("Menu", () => {
  it("is closed until the trigger is activated", () => {
    render(<BasicMenu />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens on click, listing every item, and closes on an item selection", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<BasicMenu onDelete={onDelete} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens on keyboard (ArrowDown) with the first item focused", async () => {
    const user = userEvent.setup();
    render(<BasicMenu />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });

  it("navigates with the arrow keys and skips disabled items", async () => {
    const user = userEvent.setup();
    render(<BasicMenu />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("menu");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    // Duplicate is disabled and must be skipped entirely.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });

  it("closes on Escape without firing any item's action", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<BasicMenu onDelete={onDelete} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus());
  });

  it("does not fire a disabled item's action", async () => {
    const onDuplicate = vi.fn();
    const user = userEvent.setup();
    render(
      <Menu trigger={<AriaButton>Actions</AriaButton>}>
        <Menu.Item isDisabled onAction={onDuplicate}>
          Duplicate
        </Menu.Item>
      </Menu>,
    );
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");
    const item = screen.getByRole("menuitem", { name: "Duplicate" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    await user.click(item);
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it("renders a separator between item groups", async () => {
    const user = userEvent.setup();
    render(<BasicMenu />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    const menu = await screen.findByRole("menu");
    expect(menu.querySelector("[role='separator']")).not.toBeNull();
  });

  it("applies destructive styling to a destructive item, distinct from a regular item", async () => {
    const user = userEvent.setup();
    render(<BasicMenu />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");
    const edit = screen.getByRole("menuitem", { name: "Edit" });
    const destroy = screen.getByRole("menuitem", { name: "Delete" });
    expect(destroy.className).not.toBe(edit.className);
    expect(destroy.className).toContain("text-status-danger-text");
  });

  it("labels the menu from the trigger's own accessible text by default", async () => {
    const user = userEvent.setup();
    render(<BasicMenu />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByRole("menu", { name: "Actions" })).toBeInTheDocument();
  });

  it("labels the menu from an icon-only trigger's own aria-label, the same way", async () => {
    const user = userEvent.setup();
    render(
      <Menu trigger={<AriaButton aria-label="More actions">⋯</AriaButton>}>
        <Menu.Item onAction={vi.fn()}>Edit</Menu.Item>
      </Menu>,
    );
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menu", { name: "More actions" })).toBeInTheDocument();
  });
});

it("labels real sections and limits checkbox semantics to a preference section", async () => {
  render(<Menu trigger={<AriaButton>Actions</AriaButton>}>
    <Menu.Section heading="Account"><Menu.Item href="/profile">Profile</Menu.Item></Menu.Section>
    <Menu.Section heading="Preferences" selectionMode="multiple" selectedKeys={["compact"]}>
      <Menu.Item id="compact">Compact</Menu.Item><Menu.Item id="contrast">Contrast</Menu.Item>
    </Menu.Section>
    <Menu.Section aria-label="Other"><Menu.Item>Help</Menu.Item></Menu.Section>
  </Menu>);
  await userEvent.setup().click(screen.getByRole("button", { name: "Actions" }));
  for (const name of ["Account", "Preferences"]) {
    const group = screen.getByRole("group", { name });
    const heading = document.getElementById(group.getAttribute("aria-labelledby")!);
    expect(heading).not.toBeNull(); expect(group.contains(heading)).toBe(true);
  }
  expect(screen.getByRole("group", { name: "Other" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveAttribute("href", "/profile");
  expect(screen.getByRole("menuitem", { name: "Profile" })).not.toHaveAttribute("aria-checked");
  expect(screen.getByRole("menuitemcheckbox", { name: "Compact" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("menuitemcheckbox", { name: "Contrast" })).toHaveAttribute("aria-checked", "false");
});

it("rejects an unnamed Menu.Section at runtime and keeps either name valid", () => {
  const section = Menu.Section as unknown as (props: Record<string, unknown>) => unknown;
  const children = <Menu.Item>Help</Menu.Item>;
  for (const props of [{}, { heading: "   " }, { "aria-label": "" }, { heading: null, "aria-label": "  " }]) {
    expect(() => section({ ...props, children })).toThrow("Menu.Section: a non-empty heading or aria-label is required.");
  }
  expect(() => section({ heading: "Account", children })).not.toThrow();
  expect(() => section({ "aria-label": "Account", children })).not.toThrow();
});

it("rejects element headings without usable text when the menu renders", () => {
  function EmptyHeading() { return <span />; }
  for (const heading of [<span>{""}</span>, <><span>{"   "}</span></>,
    <span aria-hidden="true">Account</span>, <span hidden>Account</span>,
    <span style={{ display: "none" }}>Account</span>, <span style={{ visibility: "hidden" }}>Account</span>,
    <EmptyHeading />]) {
    expect(() => render(<Menu defaultOpen trigger={<AriaButton>Actions</AriaButton>}>
      <Menu.Section heading={heading}><Menu.Item>Help</Menu.Item></Menu.Section>
    </Menu>)).toThrow("Menu.Section: a non-empty heading or aria-label is required.");
  }
});

it("names rendered groups from rich text and from a label when the heading is empty", () => {
  function OpaqueHeading() { return <span>Support details</span>; }
  render(<Menu defaultOpen trigger={<AriaButton>Actions</AriaButton>}>
    <Menu.Section heading={<><span hidden>Hidden</span><span>Account <strong>settings</strong></span></>}>
      <Menu.Item>Profile</Menu.Item>
    </Menu.Section>
    <Menu.Section heading={<span>{""}</span>} aria-label="Other">
      <Menu.Item>Help</Menu.Item>
    </Menu.Section>
    <Menu.Section heading={<OpaqueHeading />} aria-label="Support">
      <Menu.Item>Contact</Menu.Item>
    </Menu.Section>
    <Menu.Section heading={<span hidden={false} aria-hidden={false}>{["Count ", 0]}</span>}>
      <Menu.Item>Details</Menu.Item>
    </Menu.Section>
    <Menu.Section heading={<span aria-label="Account tools" />}>
      <Menu.Item>Tools</Menu.Item>
    </Menu.Section>
  </Menu>);
  expect(screen.getByRole("group", { name: "Account settings" })).toHaveAccessibleName("Account settings");
  expect(screen.getByRole("group", { name: "Other" })).toHaveAccessibleName("Other");
  expect(screen.getByRole("group", { name: "Support" })).toHaveAccessibleName("Support");
  expect(screen.getByText("Support details")).toBeVisible();
  expect(screen.getByRole("group", { name: "Count 0" })).toHaveAccessibleName("Count 0");
  expect(screen.getByRole("group", { name: "Account tools" })).toHaveAccessibleName("Account tools");
});

it("updates controlled section selection without closing, with keyboard and typeahead", async () => {
  const changed = vi.fn();
  function Preferences() {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    return <Menu trigger={<AriaButton>Actions</AriaButton>}>
      <Menu.Section heading="Preferences" selectionMode="multiple" selectedKeys={selected} shouldCloseOnSelect={false}
        onSelectionChange={keys => { changed(keys); setSelected(new Set(keys === "all" ? ["compact", "contrast"] : [...keys].map(String))); }}>
        <Menu.Item id="compact" textValue="Compact">Compact</Menu.Item>
        <Menu.Item id="contrast" textValue="Contrast">Contrast</Menu.Item>
      </Menu.Section>
    </Menu>;
  }
  render(<Preferences />);
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Actions" }); trigger.focus();
  await user.keyboard("{ArrowDown}");
  await user.keyboard(" ");
  expect(screen.getByRole("menuitemcheckbox", { name: "Compact" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("menu")).toBeInTheDocument(); expect(changed).toHaveBeenCalledTimes(1);
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitemcheckbox", { name: "Contrast" })).toHaveFocus();
  await user.keyboard("comp");
  expect(screen.getByRole("menuitemcheckbox", { name: "Compact" })).toHaveFocus();
});


it("keeps ordinary Menu hover and keyboard focus free of normal-mode outlines", async () => {
  render(<BasicMenu />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Actions" }));
  const edit = await screen.findByRole("menuitem", { name: "Edit" });
  await user.hover(edit);
  expect(edit).toHaveClass("outline-none", "forced-colors:outline", "forced-colors:outline-solid");
  expect(edit).not.toHaveClass("outline");
  await user.hover(screen.getByRole("menuitem", { name: "Delete" }));
  expect(edit).not.toHaveClass("forced-colors:outline");
  expect(screen.getByRole("menuitem", { name: "Duplicate" })).not.toHaveClass("forced-colors:outline");
  await user.keyboard("{Home}");
  expect(edit).toHaveFocus(); expect(edit).toHaveClass("outline-none", "forced-colors:outline");
});

describe("Menu root selection", () => {
  it("selection none (the default) keeps plain menu items with no check slot", async () => {
    render(<BasicMenu />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Actions" }));
    const edit = await screen.findByRole("menuitem", { name: "Edit" });
    expect(edit).not.toHaveAttribute("aria-checked");
    expect(edit.querySelector("[data-menu-check]")).toBeNull();
  });

  it("selection single exposes radio items, checks exactly one, and reports the change", async () => {
    const changed = vi.fn();
    function Sort() {
      const [selected, setSelected] = useState<Set<string>>(new Set(["newest"]));
      return <Menu trigger={<AriaButton>Sort</AriaButton>} selectionMode="single" selectedKeys={selected}
        onSelectionChange={keys => { changed(keys); setSelected(new Set([...(keys === "all" ? [] : keys)].map(String))); }}>
        <Menu.Item id="newest">Newest</Menu.Item>
        <Menu.Item id="oldest">Oldest</Menu.Item>
      </Menu>;
    }
    render(<Sort />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sort" }));
    const newest = await screen.findByRole("menuitemradio", { name: "Newest" });
    expect(newest).toHaveAttribute("aria-checked", "true");
    expect(newest.querySelector("[data-menu-check]")).not.toHaveClass("invisible");
    const oldest = screen.getByRole("menuitemradio", { name: "Oldest" });
    expect(oldest.querySelector("[data-menu-check]")).toHaveClass("invisible");
    await user.click(oldest);
    expect(changed).toHaveBeenCalledTimes(1);
    expect([...changed.mock.lastCall![0]]).toEqual(["oldest"]);
    await user.click(screen.getByRole("button", { name: "Sort" }));
    expect(await screen.findByRole("menuitemradio", { name: "Oldest" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Newest" })).toHaveAttribute("aria-checked", "false");
  });

  it("selection multiple exposes checkbox items and toggles with Space from the keyboard", async () => {
    const changed = vi.fn();
    render(<Menu trigger={<AriaButton>Columns</AriaButton>} selectionMode="multiple" defaultSelectedKeys={["name"]} onSelectionChange={changed}>
      <Menu.Item id="name">Name</Menu.Item>
      <Menu.Item id="owner">Owner</Menu.Item>
    </Menu>);
    const user = userEvent.setup();
    screen.getByRole("button", { name: "Columns" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("menuitemcheckbox", { name: "Name" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    expect([...changed.mock.lastCall![0]].sort()).toEqual(["name", "owner"]);
  });
  it("keeps typeahead on plain string items now that items render a check slot", async () => {
    render(<Menu.Inline aria-label="Sort" selectionMode="single">
      <Menu.Item id="newest">Newest</Menu.Item>
      <Menu.Item id="oldest">Oldest</Menu.Item>
    </Menu.Inline>);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("old");
    expect(screen.getByRole("menuitemradio", { name: "Oldest" })).toHaveFocus();
  });
});

describe("Menu.Inline", () => {
  it("renders a labelled, always-visible menu with arrow-key navigation and actions, and no trigger", async () => {
    const onAction = vi.fn();
    render(<Menu.Inline aria-label="Workspace" onAction={onAction}>
      <Menu.Item id="rename">Rename</Menu.Item>
      <Menu.Item id="archive">Archive</Menu.Item>
    </Menu.Inline>);
    const menu = screen.getByRole("menu", { name: "Workspace" });
    expect(screen.queryByRole("button")).toBeNull();
    expect(menu.className).toContain("rounded-control");
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Archive" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.lastCall![0]).toBe("archive");
    expect(screen.getByRole("menu", { name: "Workspace" })).toBeInTheDocument();
  });

  it("supports the same root selection inline", async () => {
    render(<Menu.Inline aria-label="Density" selectionMode="single" defaultSelectedKeys={["compact"]}>
      <Menu.Item id="compact">Compact</Menu.Item>
      <Menu.Item id="comfortable">Comfortable</Menu.Item>
    </Menu.Inline>);
    await userEvent.setup().click(screen.getByRole("menuitemradio", { name: "Comfortable" }));
    expect(screen.getByRole("menuitemradio", { name: "Comfortable" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Compact" })).toHaveAttribute("aria-checked", "false");
  });
});
