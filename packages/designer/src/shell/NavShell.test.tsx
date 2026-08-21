import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavShell } from "./NavShell.js";

function Page() {
  return (
    <div>
      <div data-testid="page-sibling">Rest of the page</div>
      <NavShell>
        <a href="/products">Products</a>
        <a href="/pricing">Pricing</a>
      </NavShell>
    </div>
  );
}

describe("NavShell", () => {
  it("renders an always-present desktop nav with the given links", () => {
    render(<Page />);
    const navs = screen.getAllByRole("navigation", { name: "Primary" });
    // One is the always-in-DOM desktop row; the drawer's own nav only
    // mounts once open (see the closed-by-default assertion below), so
    // exactly one exists before the drawer is ever opened.
    expect(navs).toHaveLength(1);
    expect(navs[0]).toHaveTextContent("Products");
    expect(navs[0]).toHaveTextContent("Pricing");
  });

  it("renders a visible-text drawer trigger, closed by default", () => {
    render(<Page />);
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("exposes the trigger's expanded state to assistive technology", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const trigger = screen.getByRole("button", { name: "Menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    await screen.findByRole("dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the drawer on trigger activation, rendering the same nav content", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Products");
    expect(dialog).toHaveTextContent("Pricing");
  });

  it("moves focus into the drawer on open, and restores it to the trigger on close", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const trigger = screen.getByRole("button", { name: "Menu" });
    trigger.focus();
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(trigger).not.toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("traps focus: Tab cycles only through elements inside the drawer", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    const dialog = await screen.findByRole("dialog");

    // Scoped to the dialog rather than `screen`: the always-in-DOM desktop
    // nav (hidden via CSS at this viewport, not by removal) carries the
    // same link text, so an unscoped query would be ambiguous the moment
    // both copies exist together.
    const closeButton = within(dialog).getByRole("button", { name: "Close menu" });
    const productsLink = within(dialog).getByRole("link", { name: "Products" });
    const pricingLink = within(dialog).getByRole("link", { name: "Pricing" });
    const focusable = [closeButton, productsLink, pricingLink];

    for (let i = 0; i < focusable.length + 1; i++) {
      await user.tab();
    }
    expect(focusable).toContain(document.activeElement);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when the drawer's own close control is activated", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is fully operable by keyboard alone: open, navigate, and close", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const trigger = screen.getByRole("button", { name: "Menu" });
    // Focused directly rather than reached via `Tab` from the top of the
    // document: jsdom applies no real CSS engine, so the always-in-DOM
    // desktop nav's own links (genuinely `display:none`, and so genuinely
    // untabbable, in a real browser at this viewport — see this
    // component's own doc comment on why they're duplicated in the DOM at
    // all) remain in jsdom's naive tab order ahead of this trigger. What
    // this test verifies is that the trigger itself is a real, focusable,
    // Enter-activatable `<button>` and that the drawer it opens is a
    // complete keyboard trap through to Escape — not the surrounding
    // page's own tab order, which is exactly the CSS-dependent behavior
    // this jsdom suite cannot exercise (see this package's PR notes on
    // that gap).
    trigger.focus();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("makes the rest of the page inert to assistive technology while open, and restores it on close", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const sibling = screen.getByTestId("page-sibling");
    expect(sibling).not.toHaveAttribute("aria-hidden");

    await user.click(screen.getByRole("button", { name: "Menu" }));
    await screen.findByRole("dialog");
    expect(sibling.closest('[aria-hidden="true"]')).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sibling.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("honors custom aria-label, triggerLabel, and closeLabel", async () => {
    const user = userEvent.setup();
    render(
      <NavShell aria-label="Site" triggerLabel="Open nav" closeLabel="Dismiss nav">
        <a href="/x">X</a>
      </NavShell>,
    );
    expect(screen.getByRole("navigation", { name: "Site" })).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Open nav" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Site" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss nav" })).toBeInTheDocument();
  });
});
