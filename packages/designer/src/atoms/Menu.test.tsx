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
