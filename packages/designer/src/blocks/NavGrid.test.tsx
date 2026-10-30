import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavGrid, type NavGridItem } from "./NavGrid.js";

describe("NavGrid", () => {
  it("delegates eligible all-linked grids to shared item plate anatomy", () => {
    const { container } = render(<NavGrid items={[{ id: "a", title: "Topic A", href: "/a" }, { id: "b", title: "Topic B", href: "/b" }]} />);
    expect(container.querySelector("ul[data-link-grid][data-surface='plate']")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Topic A" })).toHaveClass("after:rounded-panel");
  });

  it("preserves empty and more-than-six legacy collections", () => {
    const { rerender } = render(<NavGrid items={[]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    rerender(<NavGrid items={Array.from({ length: 7 }, (_, index) => ({ id: String(index), title: `Topic ${index}`, href: `/topics/${index}` }))} />);
    expect(screen.getAllByRole("link")).toHaveLength(7);
  });

  it("preserves linked tiles with mixed icons without loosening canonical Items' contract", () => {
    const { container } = render(<NavGrid items={[{ id: "a", title: "Topic A", href: "/a", icon: <svg /> }, { id: "b", title: "Topic B", href: "/b" }]} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(container.querySelector("[data-link-grid]")).toBeNull();
  });

  it("preserves mixed link/button item order and the raised bordered control tile", () => {
    const { container } = render(<NavGrid items={[{ id: "a", title: "Topic A", href: "/a" }, { id: "b", title: "Open B", onSelect: vi.fn() }, { id: "c", title: "Topic C", href: "/c" }]} />);
    expect([...container.querySelectorAll("a,button")].map((element) => element.textContent?.replace(/\u00a0/g, "").trim())).toEqual(["Topic A", "Open B", "Topic C"]);
    expect(screen.getByRole("button", { name: "Open B" })).toHaveClass("rounded-control", "border", "bg-surface-raised", "hover:border-line-strong", "hover:bg-surface-sunken");
    expect(screen.getByRole("link", { name: "Topic A" })).not.toHaveClass("active:decoration-current", "link-grid-active");
  });

  it("renders an optional heading above the grid", () => {
    render(
      <NavGrid
        heading="Settings"
        items={[{ id: "billing", title: "Billing", href: "/billing" }]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders no heading region when heading is omitted", () => {
    render(<NavGrid items={[{ id: "billing", title: "Billing", href: "/billing" }]} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders an href item as a real <a href>, not a <div> with an onClick", () => {
    render(<NavGrid items={[{ id: "billing", title: "Billing", href: "/billing" }]} />);
    const card = screen.getByRole("link", { name: /Billing/ });
    expect(card.tagName).toBe("A");
    expect(card).toHaveAttribute("href", "/billing");
  });

  it("renders an onSelect item as a real <button>, and fires onSelect when activated", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <NavGrid items={[{ id: "invite", title: "Invite teammates", onSelect }]} />,
    );
    const card = screen.getByRole("button", { name: /Invite teammates/ });
    expect(card.tagName).toBe("BUTTON");
    await user.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("lets an onSelect card's title and description wrap instead of inheriting the button label's nowrap", () => {
    render(<NavGrid items={[{ id: "invite", title: "Invite teammates", description: "Send invitations to everyone on the workspace", onSelect: vi.fn() }]} />);
    const card = screen.getByRole("button", { name: /Invite teammates/ });
    expect(card).toHaveClass("whitespace-normal");
    expect(card).not.toHaveClass("whitespace-nowrap");
  });

  it("an href card: one anchor on the title alone (its name), the icon and description outside it, the hit area stretched over the tile", () => {
    const { container } = render(
      <NavGrid
        items={[
          {
            id: "billing",
            title: "Billing",
            description: "Manage your plan and invoices.",
            icon: <svg data-testid="billing-icon" />,
            href: "/billing",
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: "Billing" });
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(link).toHaveAttribute("data-card-link");
    expect(link).not.toHaveTextContent("Manage your plan and invoices.");
    expect(link.querySelector('[data-testid="billing-icon"]')).toBeNull();
    expect(link).toHaveClass("after:absolute", "after:inset-0", "after:rounded-control", "focus-visible:after:outline-2", "focus-visible:after:outline-accent");
    const tile = container.querySelector("[data-nav-grid-card]") as HTMLElement;
    expect(tile).toHaveClass("relative", "isolate");
    expect(tile).toHaveTextContent("Manage your plan and invoices.");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps a previously accepted inline description link separate from the primary destination", () => {
    render(<NavGrid items={[{ id: "billing", title: "Billing", description: <a href="/help">Help</a>, href: "/billing" }]} />);
    const primary = screen.getByRole("link", { name: "Billing" });
    const help = screen.getByRole("link", { name: "Help" });
    expect(primary).toHaveAttribute("href", "/billing");
    expect(help).toHaveAttribute("href", "/help");
    expect(primary).not.toContainElement(help);
    expect(primary.className).not.toMatch(/(?:^|\s)after:/);
  });

  it("renders the title, description, and icon inside the single button of an onSelect card (the whole card is the target)", () => {
    render(
      <NavGrid
        items={[
          {
            id: "invite",
            title: "Invite teammates",
            description: "Bring your team on board.",
            icon: <svg data-testid="invite-icon" />,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );
    const card = screen.getByRole("button", { name: /Invite teammates/ });
    expect(card).toHaveTextContent("Bring your team on board.");
    expect(card.querySelector('[data-testid="invite-icon"]')).not.toBeNull();
  });

  it("clicking the description text (not just the title) still activates the card", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <NavGrid
        items={[
          {
            id: "invite",
            title: "Invite teammates",
            description: "Bring your team on board.",
            onSelect,
          },
        ]}
      />,
    );
    await user.click(screen.getByText("Bring your team on board."));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("the icon is aria-hidden — decorative, not a second accessible name source", () => {
    render(
      <NavGrid
        items={[
          { id: "billing", title: "Billing", icon: <svg data-testid="billing-icon" />, href: "/billing" },
        ]}
      />,
    );
    const icon = screen.getByTestId("billing-icon");
    expect(icon.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("is keyboard reachable: Tab moves focus onto the card element itself", async () => {
    const user = userEvent.setup();
    render(
      <NavGrid
        items={[
          { id: "billing", title: "Billing", href: "/billing" },
          { id: "invite", title: "Invite teammates", onSelect: vi.fn() },
        ]}
      />,
    );
    await user.tab();
    expect(screen.getByRole("link", { name: /Billing/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: /Invite teammates/ })).toHaveFocus();
  });

  it("activates an onSelect card with the keyboard (Enter)", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<NavGrid items={[{ id: "invite", title: "Invite teammates", onSelect }]} />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders one card per item, as data", () => {
    const items: NavGridItem[] = [
      { id: "billing", title: "Billing", href: "/billing" },
      { id: "usage", title: "Usage", href: "/usage" },
      { id: "invite", title: "Invite teammates", onSelect: vi.fn() },
    ];
    render(<NavGrid items={items} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("forwards className onto the root, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(
      <NavGrid className="gap-2xl" items={[{ id: "billing", title: "Billing", href: "/billing" }]} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("gap-2xl");
    expect(root.className).not.toContain("gap-md");
  });

  it("forwards a consumer style prop onto the root", () => {
    const { container } = render(
      <NavGrid
        style={{ marginTop: "8px" }}
        items={[{ id: "billing", title: "Billing", href: "/billing" }]}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.marginTop).toBe("8px");
  });
});
