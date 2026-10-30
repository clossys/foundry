// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ModuleFrame } from "./ModuleFrame.js";

afterEach(cleanup);

it("delegates header keyboard collapse and panel relationships to the disclosure leaf", async () => {
  const user = userEvent.setup();
  const { container } = render(<ModuleFrame id="notes" label="Notes"><p>Section content</p></ModuleFrame>);
  const trigger = screen.getByRole("button", { name: "Notes" });
  expect(container.querySelector('[data-module-id="notes"]')).toHaveAttribute("aria-label", "Notes");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const panel = document.getElementById(trigger.getAttribute("aria-controls")!);
  expect(panel).toHaveTextContent("Section content");
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.keyboard(" ");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
});

it("retains a controlled body state and reports the requested change", async () => {
  const user = userEvent.setup(), onExpandedChange = vi.fn();
  render(<ModuleFrame id="notes" label="Notes" expanded={false} onExpandedChange={onExpandedChange}><p>Notes content</p></ModuleFrame>);
  const trigger = screen.getByRole("button", { name: "Notes" });
  await user.click(trigger);
  expect(onExpandedChange).toHaveBeenCalledWith(true);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});
