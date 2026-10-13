import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Items } from "./Items.js";
import { Items as ServerItems } from "./Items.server.js";
import type { ItemData } from "./types.js";

const items: ItemData[] = [
  { id: "search", heading: "Search", description: "Find a record.", badge: { label: "Live", tone: "success" } },
  { id: "imports", heading: "Imports", description: "Bring records together.", badge: { label: "In progress", tone: "info" } },
  { id: "exports", heading: "Exports", description: "Take a copy with you.", badge: { label: "Planned", tone: "neutral" } },
];

afterEach(() => document.body.replaceChildren());

describe.each([["client", Items], ["server", ServerItems]] as const)("%s Index status-list configuration", (_entry, Component) => {
  it.each(["base", "sunken", "inverse"] as const)("keeps each status readable with its item on %s", ground => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(<>
      <h2 id="service-status">Service status</h2>
      <Component aria-labelledby="service-status" arrangement="rows" columns={1} order="none" reveal="all" treatment="rule" scale="item" ground={ground} items={items} />
    </>);
    document.body.append(root);
    const list = root.querySelector("ul")!;
    expect(list).toHaveAccessibleName("Service status");
    const rows = [...list.querySelectorAll("li")];
    expect(rows).toHaveLength(3);
    rows.forEach((row, index) => {
      expect(row.querySelector("[data-item-heading]")).toHaveTextContent(String(items[index]!.heading));
      expect(row.querySelector("[data-item-heading]")).toHaveClass("text-body", "font-medium");
      expect(row.querySelector("[data-item-meta]")).toHaveTextContent(String(items[index]!.badge!.label));
      expect(row.querySelector("[data-item-description]")).toHaveTextContent(String(items[index]!.description));
    });
    expect(root.querySelector(".bg-status-success-tint")).toHaveClass("text-status-success-text");
    expect(root.querySelector(".bg-status-info-tint")).toHaveClass("text-status-info-text");
    expect(root.querySelector(".bg-status-success-tint")?.parentElement).toHaveClass("bg-surface-base");
    expect(root.querySelector("ol, details, [role=status], [aria-live], [data-item-ordinal], [aria-hidden=true]")).toBeNull();
  });

  it("names optional groups while keeping each status in its own row", () => {
    const grouped = [...items, { id: "alerts", heading: "Alerts", badge: { label: "Live", tone: "success" as const } }];
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(<Component arrangement="rows" columns={1} order="none" reveal="all" treatment="rule" scale="item" headingLevel={4} items={grouped} groups={[
      { id: "records", label: "Records", items: ["search", "imports"] },
      { id: "updates", label: "Updates", items: ["exports", "alerts"] },
    ]} />);
    document.body.append(root);
    const lists = [...root.querySelectorAll("ul")];
    expect(lists).toHaveLength(2);
    expect(lists[0]).toHaveAccessibleName("Records");
    expect(lists[1]).toHaveAccessibleName("Updates");
    expect(root.querySelectorAll("h4")).toHaveLength(4);
    expect([...root.querySelectorAll("[data-item-meta]")].map(node => node.textContent)).toEqual(["Live", "In progress", "Planned", "Live"]);
  });
});
