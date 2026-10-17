import { describe, expect, it } from "vitest";
import { useId } from "react";
import { createHash } from "node:crypto";
import { Faq } from "../Faq.js";
import { Faq as ServerFaq } from "../Faq.server.js";
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

type DisclosureConsumer = "Faq/client" | "Faq/server" | "Items/client" | "Items/server";
/** Exact legacy HTML, captured before adding the optional question-wrapper class. */
function legacyDisclosureHtml(consumer: DisclosureConsumer): string {
  const records: Record<string, string> = {};
  if (consumer.startsWith("Faq/")) {
    const Component = consumer === "Faq/client" ? Faq : ServerFaq;
    for (const ground of ["base", "sunken", "inverse"] as const) for (const headingLevel of [2, 3, 4, 5, 6] as const) for (const region of [false, true]) {
      const items = [{ id: "first", question: <span>First question</span>, answer: <p>First answer</p> }, { id: "second", question: "Second question", answer: "Second answer" }];
      records[`${consumer}/${ground}/h${headingLevel}/region-${region}`] = renderToStaticMarkup(<Component ground={ground} headingLevel={headingLevel} items={items} {...(region ? { heading: "Questions", eyebrow: "Help", description: "Supporting copy" } : {})} />);
    }
  } else {
    const Component = consumer === "Items/client" ? Items : ServerItems;
    for (const ground of ["base", "sunken", "inverse"] as const) for (const treatment of ["plain", "rule", "plate"] as const) for (const headingLevel of [3, 4] as const) for (const size of ["standard", "display"] as const) for (const rich of [false, true]) {
      const items = Array.from({ length: 4 }, (_, index) => ({ id: `item-${index}`, heading: `Item ${index}`, description: <p>Answer copy</p>, ...(rich ? { eyebrow: "Region", meta: "Updated", badge: { tone: "success" as const, label: "Live" }, icon: <svg width={16} height={16} /> } : {}) }));
      records[`${consumer}/${ground}/${treatment}/h${headingLevel}/${size}/rich-${rich}`] = renderToStaticMarkup(<Component arrangement="rows" reveal="disclose" ground={ground} treatment={treatment} headingLevel={headingLevel} size={size} items={items} />);
    }
  }
  return JSON.stringify(records);
}

function IdProbe({ slot }: { slot: string }) {
  return <span id={useId()}>{slot}</span>;
}
function idSlots(): ItemData {
  return { id: "reference", heading: <IdProbe slot="heading" />, meta: <IdProbe slot="meta" />, description: <IdProbe slot="description" />, icon: <IdProbe slot="icon" /> };
}
function legacyIdSlotHtml(name: string): string {
  const [kind, entry, arrangement, reveal] = name.split("/");
  if (kind === "Item") return renderToStaticMarkup(<Item {...idSlots()} treatment={entry as "plain" | "plate"} size="standard" ground="base" />);
  const Component = entry === "client" ? Items : ServerItems;
  return renderToStaticMarkup(<Component items={Array.from({ length: reveal === "disclose" ? 4 : 3 }, (_, i) => ({ ...idSlots(), id: `reference-${i}` }))} arrangement={arrangement as "columns" | "rows" | "stacked"} reveal={reveal as "all" | "disclose"} />);
}

describe("Item status", () => {
  it.each([
    ["Item/plain", "106c4515e4e5053ec6d4b0c6dd54288dc3f1ba268b2424a370215c550016d889"],
    ["Item/plate", "858eadf71e1db60368d39313add1c3e762c67646c8c5467f28ca94047696e6d2"],
    ["Items/client/columns/all", "e390b9257082d8cc11006b5d92ebcc86bfcfaf4a00af26b194dd335994146b06"],
    ["Items/client/rows/all", "386bb663af3eaab3c7b48617e9b0166becdc873438b26cff70d972dc00d03c9c"],
    ["Items/client/rows/disclose", "c50ae8b29ee0c6154b258696714ddc54530e6905d0245eb4eb2df37c5a3f06d3"],
    ["Items/client/stacked/all", "68adb232a2f1cee1b5ff84d745b6327f409344c2263c2fe82ea17c81656d1499"],
    ["Items/server/columns/all", "e390b9257082d8cc11006b5d92ebcc86bfcfaf4a00af26b194dd335994146b06"],
    ["Items/server/rows/all", "386bb663af3eaab3c7b48617e9b0166becdc873438b26cff70d972dc00d03c9c"],
    ["Items/server/rows/disclose", "53cb06fd4c7c74fcb97c638146de8bcc6e7e6560fd52a124d13409426da327e0"],
    ["Items/server/stacked/all", "68adb232a2f1cee1b5ff84d745b6327f409344c2263c2fe82ea17c81656d1499"],
  ] as const)("preserves legacy useId-bearing slot HTML for %s", (name, expectedSha256) => {
    expect(createHash("sha256").update(legacyIdSlotHtml(name)).digest("hex")).toBe(expectedSha256);
  });

  it.each([
    ["Faq/client", "3cc9e536ab23244c724851fc6460e2e6efaa0d18c4b597a1420a544ee1419d04"],
    ["Faq/server", "846ac0d4e03871cfd77b9ef45bf6799dfaa1bff4de79d839c22e0e0a68a0711f"],
    ["Items/client", "a01cc815a05f5b2395a0dbac62e649637c3ed040a644395071a80cf5b41500a9"],
    ["Items/server", "b353fb23cc06d15a99b1b0b1f025be459dfbad8d43a376e1226e67b433fcb720"],
  ] as const)("preserves byte-identical legacy HTML for %s without status", (consumer, expectedSha256) => {
    expect(createHash("sha256").update(legacyDisclosureHtml(consumer)).digest("hex")).toBe(expectedSha256);
  });

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

  it.each([["client", Items], ["server", ServerItems]] as const)("stretches only status disclosure questions through the %s entry", (_entry, Component) => {
    const root = document.createElement("div");
    const items = data(4).map(item => ({ ...item, eyebrow: "Region", meta: "Updated", icon: <svg /> }));
    root.innerHTML = renderToStaticMarkup(<Component arrangement="rows" reveal="disclose" headingLevel={4} items={items} />);
    const wrappers = () => [...root.querySelectorAll("summary > h4 > span:first-child, button > span:first-child")];
    expect(wrappers()).toHaveLength(4);
    for (const wrapper of wrappers()) {
      expect(wrapper).toHaveClass("tablet:min-w-0", "tablet:flex-1");
      const meta = wrapper.querySelector("[data-item-meta]")!;
      expect(meta).toHaveClass("tablet:w-full");
      expect(meta.parentElement).toHaveClass("tablet:flex-1");
      expect(meta.querySelector(".text-caption")).toHaveClass("tablet:min-w-0", "tablet:flex-1");
      expect(meta).toHaveTextContent("RegionUpdatedAvailable");
    }
    root.innerHTML = renderToStaticMarkup(<Component arrangement="rows" reveal="disclose" headingLevel={4} items={items.map(({ status, ...item }) => item)} />);
    expect(wrappers()).toHaveLength(4);
    for (const wrapper of wrappers()) expect(wrapper).not.toHaveAttribute("class");
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
