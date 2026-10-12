import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { NavGrid, type NavGridItem } from "./NavGrid.js";
import { Item } from "./items/Item.js";
import { Items } from "./items/Items.js";

const linked = (count: number, description: NavGridItem["description"]): NavGridItem[] =>
  Array.from({ length: count }, (_, index) => ({ id: String(index), title: `Topic ${index}`, href: `/topics/${index}`, description: index === 0 ? description : "Ordinary supporting copy" }));

describe("published NavGrid interactive descriptions", () => {
  it.each([1, 2, 6, 7])("keeps an inline link independent in a %s-item collection", count => {
    render(<NavGrid items={linked(count, <a href="/help">Help</a>)} />);
    const primary = screen.getByRole("link", { name: "Topic 0" });
    const help = screen.getByRole("link", { name: "Help" });
    expect(primary).toHaveAttribute("href", "/topics/0");
    expect(help).toHaveAttribute("href", "/help");
    expect(primary).not.toContainElement(help);
    expect(primary.className).not.toMatch(/(?:^|\s)after:/);
    expect(screen.getAllByRole("link")).toHaveLength(count + 1);
  });
  it.each([1, 2, 6, 7])("keeps a description button operable in a %s-item collection", async count => {
    const activate = vi.fn();
    const user = userEvent.setup();
    render(<NavGrid items={linked(count, <button onClick={activate}>Details</button>)} />);
    const primary = screen.getByRole("link", { name: "Topic 0" });
    const details = screen.getByRole("button", { name: "Details" });
    expect(primary).not.toContainElement(details);
    expect(primary.className).not.toMatch(/(?:^|\s)after:/);
    await user.click(details);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(primary).toHaveAttribute("href", "/topics/0");
  });
  it.each(["link", "button"] as const)("renders a separate %s control during ordinary SSR", kind => {
    const description = kind === "link" ? <a href="/help">Help</a> : <button>Details</button>;
    const html = renderToStaticMarkup(<NavGrid items={linked(2, description)} />);
    const doc = new JSDOM(html).window.document;
    const primary = doc.querySelector('a[href="/topics/0"]')!;
    const control = kind === "link" ? doc.querySelector('a[href="/help"]')! : doc.querySelector("button")!;
    expect(primary).not.toBeNull();
    expect(control).not.toBeNull();
    expect(primary.contains(control)).toBe(false);
    expect(primary.textContent).toBe("Topic 0");
    expect(primary.className).not.toMatch(/(?:^|\s)after:/);
    expect([...doc.querySelectorAll('a[href^="/topics/"]')].map(a => a.getAttribute("href"))).toEqual(["/topics/0", "/topics/1"]);
  });
  it("tabs through nested description controls and activates the button with Enter", async () => {
    const activate = vi.fn();
    const user = userEvent.setup();
    render(<NavGrid items={linked(2, <span>Read <a href="/help">Help</a> <button onClick={activate}>Details</button></span>)} />);
    const primary = screen.getByRole("link", { name: "Topic 0" });
    const help = screen.getByRole("link", { name: "Help" });
    const details = screen.getByRole("button", { name: "Details" });
    const next = screen.getByRole("link", { name: "Topic 1" });
    expect(primary).not.toContainElement(help);
    expect(primary).not.toContainElement(details);
    expect(primary.className).not.toMatch(/(?:^|\s)after:/);
    expect(primary.className).not.toMatch(/(?:^|\s)outline-none(?:\s|$)/);
    expect(primary).toHaveClass("focus-visible:outline-solid", "focus-visible:outline-2");
    expect(primary.style.minBlockSize).toBe("var(--ui-layout-tap-target, 44px)");
    expect(primary.style.minInlineSize).toBe("var(--ui-layout-tap-target, 44px)");
    await user.tab();
    expect(primary).toHaveFocus();
    await user.tab();
    expect(help).toHaveFocus();
    expect(help).toHaveAttribute("href", "/help");
    await user.tab();
    expect(details).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(activate).toHaveBeenCalledTimes(1);
    expect(primary).toHaveAttribute("href", "/topics/0");
    await user.tab();
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute("href", "/topics/1");
  });
  it("keeps canonical Item and Items refusals for the same interactive description", () => {
    const description = <button>Details</button>;
    expect(() => renderToStaticMarkup(<Item id="one" heading="Topic" href="/topic" description={description} treatment="plain" size="standard" ground="base" />)).toThrow(TypeError);
    expect(() => renderToStaticMarkup(<Items arrangement="rows" columns={1} treatment="plain" size="standard" scale="item" ground="base" items={[{ id: "one", heading: "Topic", href: "/topic", description }, { id: "two", heading: "Other", href: "/other" }]} />)).toThrow(TypeError);
  });
});
