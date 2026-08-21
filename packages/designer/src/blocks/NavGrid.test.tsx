import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavGrid, type NavGridItem } from "./NavGrid.js";

describe("NavGrid", () => {
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

  it("renders the title, description, and icon inside the single card element (the whole card is the target)", () => {
    render(
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
    const card = screen.getByRole("link", { name: /Billing/ });
    expect(card).toHaveTextContent("Billing");
    expect(card).toHaveTextContent("Manage your plan and invoices.");
    expect(card.querySelector('[data-testid="billing-icon"]')).not.toBeNull();
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
