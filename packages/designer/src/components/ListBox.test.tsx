import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ListBox, ListBoxSection, ListBoxHeader, ListBoxItem } from "./ListBox.js";

it("keeps collection grouping, disabled-item skipping, keyboard wrapping and activation with React Aria", async () => {
  const action = vi.fn();
  render(<ListBox aria-label="Choices" selectionMode="single" shouldFocusWrap autoFocus="first" disabledKeys={["disabled"]} onAction={action}>
    <ListBoxSection><ListBoxHeader>Actions</ListBoxHeader>
      <ListBoxItem id="first">First</ListBoxItem>
      <ListBoxItem id="disabled">Unavailable</ListBoxItem>
      <ListBoxItem id="last">Last</ListBoxItem>
    </ListBoxSection>
  </ListBox>);
  expect(screen.getByRole("group", { name: "Actions" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Unavailable" })).toHaveAttribute("aria-disabled", "true");
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByRole("option", { name: "Last" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(action).toHaveBeenCalledWith("first");
});
