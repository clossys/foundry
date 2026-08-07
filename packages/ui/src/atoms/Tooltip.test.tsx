import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button.js";
import { Tooltip } from "./Tooltip.js";

// react-aria-components' `TooltipTrigger` (like `MenuTrigger`/`DialogTrigger`)
// wires its hover/focus/press behavior onto its trigger child via CONTEXT,
// which only a react-aria-components-aware element (this package's own
// `Button`, or react-aria-components' own) consumes — a bare native
// `<button>` never receives any of it, the same reason every `trigger` slot
// example elsewhere in this package's README uses `Button`, never a plain
// element. `Button` is used here for exactly that reason, not because
// `Tooltip` requires this package's own atom specifically (react-aria-components'
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
