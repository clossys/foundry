import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Disclosure } from "./Disclosure.js";

describe("Disclosure", () => {
  it("renders collapsed by default: the trigger reports aria-expanded=false and the panel is hidden", () => {
    render(<Disclosure title="Advanced options">Extra content here.</Disclosure>);
    const trigger = screen.getByRole("button", { name: "Advanced options" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Extra content here.")).not.toBeVisible();
  });

  it("expands on click, updating aria-expanded and aria-controls, and shows the panel", async () => {
    const user = userEvent.setup();
    render(<Disclosure title="Advanced options">Extra content here.</Disclosure>);
    const trigger = screen.getByRole("button", { name: "Advanced options" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = screen.getByText("Extra content here.").closest(`#${panelId}`);
    expect(panel).not.toBeNull();
    expect(screen.getByText("Extra content here.")).toBeVisible();
  });

  it("collapses again on a second click, restoring aria-expanded=false", async () => {
    const user = userEvent.setup();
    render(<Disclosure title="Advanced options">Extra content here.</Disclosure>);
    const trigger = screen.getByRole("button", { name: "Advanced options" });
    await user.click(trigger);
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Extra content here.")).not.toBeVisible();
  });

  it("toggles via the keyboard (Enter) exactly like a click", async () => {
    const user = userEvent.setup();
    render(<Disclosure title="Advanced options">Extra content here.</Disclosure>);
    const trigger = screen.getByRole("button", { name: "Advanced options" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("starts expanded when defaultExpanded is set", () => {
    render(
      <Disclosure title="Advanced options" defaultExpanded>
        Extra content here.
      </Disclosure>,
    );
    expect(screen.getByRole("button", { name: "Advanced options" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Extra content here.")).toBeVisible();
  });

  it("forwards className onto the outer wrapper, and the consumer's conflicting class wins the merge", () => {
    render(
      <Disclosure title="Advanced options" className="flex-row">
        Extra content here.
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Advanced options" });
    const wrapper = trigger.parentElement as HTMLElement;
    expect(wrapper.className).toContain("flex-row");
    expect(wrapper.className).not.toContain("flex-col");
  });

  it("forwards a consumer style prop, and the consumer's conflicting property wins the merge", () => {
    render(
      <Disclosure title="Advanced options" style={{ marginTop: "8px" }}>
        Extra content here.
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Advanced options" });
    const wrapper = trigger.parentElement as HTMLElement;
    expect(wrapper.style.marginTop).toBe("8px");
  });

  it("accepts distinct trigger and panel foreground classes for grounded block composition", () => {
    render(
      <Disclosure title="Advanced options" triggerClassName="text-ink-on-inverse" panelClassName="text-ink-on-inverse-muted">
        Extra content here.
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Advanced options" });
    expect(trigger).toHaveClass("text-ink-on-inverse");
    expect(trigger).not.toHaveClass("text-ink-primary");
    expect(document.getElementById(trigger.getAttribute("aria-controls") as string)).toHaveClass("text-ink-on-inverse-muted");
  });

  it("disabled: the trigger is disabled and does not toggle", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure title="Advanced options" isDisabled>
        Extra content here.
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Advanced options" });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
