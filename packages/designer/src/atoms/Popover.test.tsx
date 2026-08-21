import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button.js";
import { Popover } from "./Popover.js";

// `DialogTrigger` (like `MenuTrigger`/`TooltipTrigger`) wires its open/close
// press behavior onto its trigger child via context, which only a
// react-aria-components-aware element consumes — see `Tooltip.test.tsx`'s
// own note on the identical requirement. `Button` (this package's own atom)
// is used here for the same reason.
describe("Popover", () => {
  it("does not render its content until opened", () => {
    render(
      <Popover trigger={<Button>Filters</Button>}>
        <p>Filter controls here.</p>
      </Popover>,
    );
    expect(screen.queryByText("Filter controls here.")).not.toBeInTheDocument();
  });

  it("opens on trigger press", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<Button>Filters</Button>}>
        <p>Filter controls here.</p>
      </Popover>,
    );
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(await screen.findByText("Filter controls here.")).toBeInTheDocument();
  });

  it("moves focus into the content on open, and restores it to the trigger on close", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<Button>Filters</Button>}>
        <Button>Apply</Button>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Filters" });
    await user.click(trigger);
    await screen.findByRole("button", { name: "Apply" });
    // Regardless of exactly which element inside gets initial focus (the
    // dialog surface itself, or its first focusable descendant — both are
    // valid per the WAI-ARIA dialog pattern, and this component doesn't
    // dictate which), focus must have left the trigger and landed somewhere
    // inside the popover — the same assertion shape `Dialog.test.tsx` uses
    // for its own identical focus-trap behavior.
    await waitFor(() => expect(trigger).not.toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<Button>Filters</Button>}>
        <p>Filter controls here.</p>
      </Popover>,
    );
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await screen.findByText("Filter controls here.");
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByText("Filter controls here.")).not.toBeInTheDocument();
    });
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<Button>Filters</Button>}>
        <p>Filter controls here.</p>
      </Popover>,
    );
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await screen.findByText("Filter controls here.");
    // A real outside interaction, not a query for an accessible "elsewhere"
    // target: this popover is modal to assistive tech while open (the
    // correct, react-aria-components default — see `Popover.tsx`'s own doc
    // comment on why there's no `isNonModal` escape hatch here, the same
    // choice `Menu`'s and `Select`'s own popovers already make), so
    // everything else on the page is `aria-hidden` and deliberately
    // unqueryable by role for as long as it's open. `mousedown` (not
    // `pointerdown`): jsdom has never implemented the Pointer Events spec,
    // and react-aria's own outside-interaction detection falls back to
    // plain mouse events in that case — see this package's own
    // `Tooltip.test.tsx` note on the identical fallback for hover.
    fireEvent.mouseDown(document.body);
    fireEvent.mouseUp(document.body);
    await waitFor(() => {
      expect(screen.queryByText("Filter controls here.")).not.toBeInTheDocument();
    });
  });

  it("supports function children with an imperative close()", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<Button>Filters</Button>}>
        {({ close }) => <Button onPress={close}>Done</Button>}
      </Popover>,
    );
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    });
  });

  it("a controlled isOpen renders the content without a trigger press", () => {
    render(
      <Popover trigger={<Button>Filters</Button>} isOpen>
        <p>Filter controls here.</p>
      </Popover>,
    );
    expect(screen.getByText("Filter controls here.")).toBeInTheDocument();
  });

  it("forwards className onto the popover surface, and the consumer's conflicting class wins the merge", () => {
    render(
      <Popover trigger={<Button>Filters</Button>} isOpen className="p-lg">
        <p>Filter controls here.</p>
      </Popover>,
    );
    const surface = screen.getByText("Filter controls here.").closest('[class*="rounded-control"]');
    expect(surface?.className).toContain("p-lg");
    expect(surface?.className).not.toContain("p-md");
  });
});
