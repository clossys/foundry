import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Item } from "./Item.js";
import { Items } from "./Items.js";
import { Items as ServerItems } from "./Items.server.js";
import type { ItemData, ItemProps } from "./types.js";

const single = { id: "one", heading: "Search", treatment: "plain", size: "standard", ground: "base" } as const;
const data = (count = 3): ItemData[] => Array.from({ length: count }, (_, index) => ({
  id: `state-${index}`, heading: `Service ${index}`, description: "Details", status: { tone: "success", label: `Available ${index}` },
}));

describe("Item status", () => {
  it("renders StatusMark with a visible label in the meta row", () => {
    const { container } = render(<Item {...single} eyebrow="Product" meta="Updated" status={{ tone: "success", label: "Available" }} />);
    const row = container.querySelector("[data-item-meta]")!;
    const status = row.querySelector("[data-item-status]")!;
    expect(row).toHaveTextContent("ProductUpdatedAvailable");
    expect(status).toHaveAttribute("data-tone", "success");
    expect(status.querySelector("[data-part=mark]")).toHaveAttribute("data-shape", "circle");
    expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(status).toContainElement(screen.getByText("Available"));
    expect(screen.getByText("Available")).toBeVisible();
    expect(status.querySelector(".sr-only")).toBeNull();
  });

  it.each([["success", "circle"], ["warning", "triangle"], ["danger", "diamond"], ["info", "open-circle"], ["neutral", "dash"]] as const)("keeps the %s mark's non-colour shape", (tone, shape) => {
    const { container } = render(<Item {...single} status={{ tone, label: "State" }} />);
    expect(container.querySelector("[data-shape]")).toHaveAttribute("data-shape", shape);
    expect(screen.getByText("State")).toBeVisible();
  });

  it.each(["plain", "rule", "plate"] as const)("accepts status in %s treatment", treatment => {
    render(<Item {...single} treatment={treatment} status={{ tone: "info", label: "In progress" }} />);
    expect(screen.getByText("In progress")).toBeVisible();
  });

  it.each(["base", "sunken", "inverse"] as const)("keeps the status on its checked backing on %s", ground => {
    const { container } = render(<Item {...single} ground={ground} status={{ tone: "danger", label: "Unavailable" }} />);
    const status = container.querySelector("[data-item-status]");
    if (ground === "inverse") expect(status).toHaveClass("bg-surface-raised");
    else expect(status).not.toHaveClass("bg-surface-raised");
  });

  it("throws when status and badge share an item", () => {
    expect(() => renderToStaticMarkup(<Item {...single} status={{ tone: "success", label: "Available" }} badge={{ label: "Live" }} />)).toThrow(/status.*badge|badge.*status/i);
    expect(() => renderToStaticMarkup(<ServerItems arrangement="columns" items={data().map(item => ({ ...item, badge: { label: "Live" } }))} />)).toThrow(/status.*badge|badge.*status/i);
  });

  it("places row status at the end from tablet without moving other arrangements", () => {
    const { container, rerender } = render(<ServerItems arrangement="rows" items={data()} />);
    for (const row of container.querySelectorAll("[data-item-meta]")) {
      expect(row).toHaveClass("w-full");
      expect(row.querySelector("[data-item-status]")).toHaveClass("tablet:ms-auto");
    }
    rerender(<ServerItems arrangement="columns" items={data()} />);
    for (const status of container.querySelectorAll("[data-item-status]")) expect(status).not.toHaveClass("tablet:ms-auto");
  });

  it.each([["client", Items], ["server", ServerItems]] as const)("keeps status and visible labels in %s disclosure meta rows", (_entry, Component) => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(<Component arrangement="rows" reveal="disclose" items={data(4)} />);
    const rows = [...root.querySelectorAll("[data-item-meta]")];
    expect(rows).toHaveLength(4);
    rows.forEach((row, index) => {
      expect(row.querySelector("[data-item-status]")).toHaveTextContent(`Available ${index}`);
      expect(row.querySelector("[data-shape]")).toHaveAttribute("data-shape", "circle");
    });
  });

  it("refuses status in statement collections", () => {
    expect(() => renderToStaticMarkup(<ServerItems arrangement="columns" scale="statement" items={data()} />)).toThrow(/statement.*status|status.*statement/i);
  });

  it.each([{ tone: "success", label: " " }, { tone: "other", label: "State" }, null])("rejects incomplete status data %j", status => {
    expect(() => renderToStaticMarkup(<Item {...({ ...single, status } as unknown as ItemProps)} />)).toThrow(/status/i);
  });

  it("keeps authored zero as the visible status label", () => {
    render(<Item {...single} status={{ tone: "neutral", label: 0 }} />);
    expect(screen.getByText("0")).toBeVisible();
  });

  it("rejects controls in linked status and disclosure trigger labels", () => {
    const status = { tone: "success" as const, label: <button>Other</button> };
    expect(() => renderToStaticMarkup(<Item {...single} href="/search" status={status} />)).toThrow(/interactive/i);
    expect(() => renderToStaticMarkup(<ServerItems arrangement="rows" reveal="disclose" items={data(4).map(item => ({ ...item, status }))} />)).toThrow(/phrasing|trigger/i);
  });
});
