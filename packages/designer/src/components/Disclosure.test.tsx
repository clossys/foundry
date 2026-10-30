import { describe, expect, it, vi } from "vitest";
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

describe("Disclosure.Group (scope.group)", () => {
  const faq = (props: Partial<Parameters<typeof Disclosure.Group>[0]> = {}) => (
    <Disclosure.Group {...props}>
      <Disclosure id="plans" title="Which plans exist?">Three plans.</Disclosure>
      <Disclosure id="refunds" title="Can I get a refund?">Within 30 days.</Disclosure>
    </Disclosure.Group>
  );
  const trigger = (name: string) => screen.getByRole("button", { name });

  it("coordinates its sections: expanding one collapses the other by default", async () => {
    const user = userEvent.setup();
    render(faq());
    await user.click(trigger("Which plans exist?"));
    expect(trigger("Which plans exist?")).toHaveAttribute("aria-expanded", "true");
    await user.click(trigger("Can I get a refund?"));
    expect(trigger("Can I get a refund?")).toHaveAttribute("aria-expanded", "true");
    expect(trigger("Which plans exist?")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Three plans.")).not.toBeVisible();
  });

  it("keeps several sections open when allowsMultipleExpanded is set", async () => {
    const user = userEvent.setup();
    render(faq({ allowsMultipleExpanded: true }));
    await user.click(trigger("Which plans exist?"));
    await user.click(trigger("Can I get a refund?"));
    expect(trigger("Which plans exist?")).toHaveAttribute("aria-expanded", "true");
    expect(trigger("Can I get a refund?")).toHaveAttribute("aria-expanded", "true");
  });

  it("starts from defaultExpandedKeys and reports changes as the expanded key set, from the keyboard too", async () => {
    const onExpandedChange = vi.fn();
    const user = userEvent.setup();
    render(faq({ defaultExpandedKeys: ["refunds"], onExpandedChange }));
    expect(screen.getByText("Within 30 days.")).toBeVisible();
    trigger("Which plans exist?").focus();
    await user.keyboard("{Enter}");
    expect([...onExpandedChange.mock.lastCall![0]]).toEqual(["plans"]);
  });

  it("disables every section when the group is disabled", () => {
    render(faq({ isDisabled: true }));
    expect(trigger("Which plans exist?")).toBeDisabled();
    expect(trigger("Can I get a refund?")).toBeDisabled();
  });

  it("separates sections with a token rule and merges the consumer's class onto the group root", () => {
    render(faq({ className: "gap-md" }));
    const root = trigger("Which plans exist?").closest('[data-part="disclosure-group"]') as HTMLElement;
    expect(root).not.toBeNull();
    for (const name of ["flex", "flex-col", "divide-y", "divide-line-base", "gap-md"]) expect(root).toHaveClass(name);
  });
});

