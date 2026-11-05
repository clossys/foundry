import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button.js";
import { Tooltip } from "./Tooltip.js";
import { Tooltip as Surface } from "react-aria-components";

// react-aria-components' `TooltipTrigger` (like `MenuTrigger`/`DialogTrigger`)
// wires its hover/focus/press behavior onto its trigger child via CONTEXT,
// which only a react-aria-components-aware element (this package's own
// `Button`, or react-aria-components' own) consumes — a bare native
// `<button>` never receives any of it, the same reason every `trigger` slot
// example elsewhere in this package's README uses `Button`, never a plain
// element. `Button` is used here for exactly that reason, not because
// `Tooltip` requires this package's own component specifically (react-aria-components'
// own `Button` works identically).
//
// A real browser always has SOME prior pointer activity by the time a user
// hovers anything; this test file is often the first mouse-shaped event in
// the whole test, so react-aria's own pointer-vs-keyboard "interaction
// modality" tracking (which gates whether a hover is treated as a real
// pointer hover at all) starts unset. One throwaway `fireEvent.mouseMove`
// before each hover-based assertion primes it, matching what every real
// page already has by the time a tooltip trigger is hovered.
function primePointerModality() {
  fireEvent.mouseMove(document.body);
}

describe("Tooltip", () => {
  it("does not render its content until opened", () => {
    render(
      <Tooltip trigger={<Button>Info</Button>} delay={0} closeDelay={0}>
        More detail here.
      </Tooltip>,
    );
    expect(screen.queryByText("More detail here.")).not.toBeInTheDocument();
  });

  it("opens on hover, and links the trigger to it via aria-describedby", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip trigger={<Button>Info</Button>} delay={0} closeDelay={0}>
        More detail here.
      </Tooltip>,
    );
    primePointerModality();
    const trigger = screen.getByRole("button", { name: "Info" });
    await user.hover(trigger);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("More detail here.");
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("opens on keyboard focus, not just hover", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip trigger={<Button>Info</Button>} delay={0} closeDelay={0}>
        More detail here.
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Info" })).toHaveFocus();
    await screen.findByRole("tooltip");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip trigger={<Button>Info</Button>} delay={0} closeDelay={0}>
        More detail here.
      </Tooltip>,
    );
    primePointerModality();
    const trigger = screen.getByRole("button", { name: "Info" });
    await user.hover(trigger);
    await screen.findByRole("tooltip");
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("closes when the pointer leaves the trigger", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip trigger={<Button>Info</Button>} delay={0} closeDelay={0}>
        More detail here.
      </Tooltip>,
    );
    primePointerModality();
    const trigger = screen.getByRole("button", { name: "Info" });
    await user.hover(trigger);
    await screen.findByRole("tooltip");
    await user.unhover(trigger);
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("forwards className onto the tooltip surface, and the consumer's conflicting class wins the merge", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip trigger={<Button>Info</Button>} delay={0} closeDelay={0} className="px-lg">
        More detail here.
      </Tooltip>,
    );
    primePointerModality();
    await user.hover(screen.getByRole("button", { name: "Info" }));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.className).toContain("px-lg");
    expect(tooltip.className).not.toContain("px-sm");
  });

  it("triggerAction='focus' opens only on focus, not on hover", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip trigger={<Button>Info</Button>} delay={0} closeDelay={0} triggerAction="focus">
        More detail here.
      </Tooltip>,
    );
    primePointerModality();
    await user.hover(screen.getByRole("button", { name: "Info" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.tab();
    await screen.findByRole("tooltip");
  });
});


describe("manual controlled Tooltip", () => {
  it("keeps its anchor description connected while leaving Escape to the page", async () => {
    const user = userEvent.setup();
    const open = <Tooltip manual isOpen trigger={<Button aria-describedby="existing">Info</Button>}>Manual detail</Tooltip>;
    const view = render(open);
    const tooltip = await screen.findByRole("tooltip");
    const trigger = screen.getByRole("button", { name: "Info" });
    expect(trigger).toHaveAttribute("aria-describedby", `existing ${tooltip.id}`);
    expect(tooltip.closest("[data-tooltip-host]")).not.toBeNull();
    const reached: string[] = [];
    const listen = (event: KeyboardEvent) => { reached.push(event.key); };
    window.addEventListener("keydown", listen);
    try {
      trigger.focus();
      await user.keyboard("{Escape}");
      expect(reached).toEqual(["Escape"]);
      expect(screen.getByRole("tooltip")).toBe(tooltip);
    } finally { window.removeEventListener("keydown", listen); }
    view.rerender(<Tooltip manual isOpen={false} trigger={<Button aria-describedby="existing">Info</Button>}>Manual detail</Tooltip>);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByRole("button", { name: "Info" })).toHaveAttribute("aria-describedby", "existing");
  });

  it("renders the actual custom surface with its owned id, anchor, placement and portal", async () => {
    render(<Tooltip manual isOpen placement="right" trigger={<Button>Custom</Button>}
      renderSurface={({ id, triggerRef, portalContainer, placement, children }) =>
        <Surface {...{ id, triggerRef, UNSTABLE_portalContainer: portalContainer, placement }} data-selected-tooltip="yes">{children}</Surface>}>
      Selected detail
    </Tooltip>);
    const user = userEvent.setup();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveAttribute("data-selected-tooltip", "yes");
    expect(tooltip).toHaveTextContent("Selected detail");
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-describedby", tooltip.id);
    expect(tooltip.closest("[data-tooltip-host]")).not.toBeNull();
    await waitFor(() => expect(tooltip).toHaveAttribute("data-placement", "right"));
    const reached: string[] = [];
    const listen = (event: KeyboardEvent) => { reached.push(event.key); };
    window.addEventListener("keydown", listen);
    try {
      screen.getByRole("button", { name: "Custom" }).focus();
      await user.keyboard("{Escape}");
      expect(reached).toEqual(["Escape"]);
      expect(screen.getByRole("tooltip")).toBe(tooltip);
    } finally { window.removeEventListener("keydown", listen); }
  });

  it("requires controlled state and refuses a custom surface outside manual mode", () => {
    expect(() => render(<Tooltip manual trigger={<Button>Info</Button>}>Detail</Tooltip>)).toThrow("requires controlled isOpen");
    expect(() => render(<Tooltip renderSurface={() => null} trigger={<Button>Info</Button>}>Detail</Tooltip>)).toThrow("requires manual mode");
  });
  it("gives a disabled trigger one named, disabled, focusable control that the tooltip describes", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip disabledTrigger trigger={<Button isDisabled>Publish</Button>} delay={0} closeDelay={0}>
        Publishing is locked.
      </Tooltip>,
    );
    await user.tab();
    const control = screen.getByRole("button", { name: "Publish" });
    expect(control).toHaveFocus();
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("data-tooltip-disabled-trigger");
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Publishing is locked.");
    expect(control).toHaveAccessibleDescription("Publishing is locked.");
    // The natively disabled control stays disabled, takes no focus and is not a second button in the tree.
    const native = control.querySelector("button")!;
    expect(native).toBeDisabled();
    expect(screen.getAllByRole("button")).toEqual([control]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    primePointerModality();
    await user.hover(control);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Publishing is locked.");
  });

  it("forwards an icon-only disabled control's external aria-labelledby onto its focus target", async () => {
    const user = userEvent.setup();
    render(
      <>
        <span id="external-label">Archive project</span>
        <Tooltip disabledTrigger trigger={<Button isDisabled aria-labelledby="external-label"><svg aria-hidden="true" /></Button>} delay={0} closeDelay={0}>
          Archiving is locked.
        </Tooltip>
      </>,
    );
    await user.tab();
    const control = screen.getByRole("button", { name: "Archive project" });
    expect(control).toHaveFocus();
    expect(control).toHaveAttribute("aria-labelledby", "external-label");
    expect(control).toHaveAttribute("aria-disabled", "true");
    await screen.findByRole("tooltip");
    expect(control).toHaveAccessibleDescription("Archiving is locked.");
  });

  it("forwards an icon-only disabled control's aria-label onto its focus target", async () => {
    const user = userEvent.setup();
    render(<Tooltip disabledTrigger trigger={<Button isDisabled aria-label="Delete draft" />} delay={0} closeDelay={0}>Drafts are locked.</Tooltip>);
    await user.tab();
    const control = screen.getByRole("button", { name: "Delete draft" });
    expect(control).toHaveFocus();
    expect(control).toHaveAttribute("aria-label", "Delete draft");
    expect(control).not.toHaveAttribute("aria-labelledby");
  });

  it("takes the wrapped control's role from disabledTriggerRole and its name from an icon-only aria-label", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip disabledTrigger disabledTriggerRole="link" trigger={<Button isDisabled aria-label="Open report" />} delay={0} closeDelay={0}>
        Reports are building.
      </Tooltip>,
    );
    await user.tab();
    const control = screen.getByRole("link", { name: "Open report" });
    expect(control).toHaveFocus();
    expect(control).toHaveAttribute("aria-disabled", "true");
    await screen.findByRole("tooltip");
    expect(control).toHaveAccessibleDescription("Reports are building.");
  });

  it("refuses a disabled trigger that is not one element", () => {
    expect(() => render(<Tooltip disabledTrigger trigger="Publish">Locked</Tooltip>)).toThrow("Tooltip disabledTrigger requires one trigger element.");
  });

  it("leaves an enabled trigger unwrapped", () => {
    render(<Tooltip trigger={<Button>Info</Button>}>Detail</Tooltip>);
    expect(document.querySelector("[data-tooltip-disabled-trigger]")).toBeNull();
  });
});
