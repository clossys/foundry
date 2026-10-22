import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableOfContents as ClientTableOfContents, type TableOfContentsItem } from "./TableOfContents.js";
import { TableOfContents } from "./TableOfContents.server.js";

const LABEL = "On this page";
const ITEMS: readonly TableOfContentsItem[] = [
  { id: "a", label: "Overview" },
  { id: "b", label: "Getting started" },
  { id: "c", label: "Configuration", level: 3 },
];

function host(html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

describe("server TableOfContents", () => {
  it("renders the same markup as the client variant for the sidebar and the inline presentations before any observation", () => {
    const sidebar = { label: LABEL, items: ITEMS, currentId: "b", className: "mt-lg" };
    expect(renderToStaticMarkup(<TableOfContents {...sidebar} />)).toBe(renderToStaticMarkup(<ClientTableOfContents {...sidebar} />));
    const unmarked = { label: LABEL, items: ITEMS };
    expect(renderToStaticMarkup(<TableOfContents {...unmarked} />)).toBe(renderToStaticMarkup(<ClientTableOfContents {...unmarked} />));
  });

  it("names the navigation by the label and marks only the controlled current item", () => {
    const root = host(renderToStaticMarkup(<TableOfContents label={LABEL} items={ITEMS} currentId="b" />));
    const navs = root.querySelectorAll("nav");
    expect(navs).toHaveLength(1);
    expect(navs[0]).toHaveAttribute("aria-label", LABEL);
    const links = [...root.querySelectorAll("a")];
    expect(links.map(link => link.getAttribute("href"))).toEqual(["#a", "#b", "#c"]);
    expect(links.filter(link => link.hasAttribute("aria-current")).map(link => link.textContent)).toEqual(["Getting started"]);
    expect(links[1]).toHaveAttribute("aria-current", "location");
  });

  it("ignores trackCurrent and marks nothing without a currentId", () => {
    const root = host(renderToStaticMarkup(<TableOfContents label={LABEL} items={ITEMS} trackCurrent />));
    expect(root.querySelectorAll("[aria-current]")).toHaveLength(0);
  });

  it("indents level 3 further than level 2", () => {
    const links = [...host(renderToStaticMarkup(<TableOfContents label={LABEL} items={ITEMS} />)).querySelectorAll("a")];
    expect(links[0]).toHaveClass("ps-md");
    expect(links[2]).toHaveClass("ps-xl");
    expect(links[2]).not.toHaveClass("ps-md");
  });

  it("renders the inline presentation as a native open details element with a summary and no button", () => {
    const root = host(renderToStaticMarkup(<TableOfContents label={LABEL} items={ITEMS} presentation="inline" />));
    const details = root.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).toHaveAttribute("open");
    expect(details).toHaveClass("rounded-panel", "border", "border-line-base", "p-md");
    expect(root.querySelector("summary")).toHaveTextContent(LABEL);
    expect(root.querySelector("button")).toBeNull();
    expect(root.querySelectorAll("a")).toHaveLength(3);
    expect(root.querySelector("nav")).toHaveAttribute("aria-label", LABEL);
  });

  it("renders the sidebar presentation as a plain captioned list with no button", () => {
    const root = host(renderToStaticMarkup(<TableOfContents label={LABEL} items={ITEMS} />));
    expect(root.querySelector("details")).toBeNull();
    expect(root.querySelector("button")).toBeNull();
    expect(root.querySelector("nav > p")).toHaveTextContent(LABEL);
  });

  it.each([
    ["one item", { items: ITEMS.slice(0, 1) }],
    ["a duplicate id", { items: [{ id: "a", label: "One" }, { id: "a", label: "Two" }] }],
    ["an id with a space", { items: [{ id: "a b", label: "One" }, { id: "c", label: "Two" }] }],
    ["a currentId outside the items", { currentId: "z" }],
    ["an empty label", { label: "" }],
  ])("throws a prefixed TypeError for %s", (_name, props) => {
    expect(() => renderToStaticMarkup(<TableOfContents label={LABEL} items={ITEMS} {...props} />)).toThrow(/^TableOfContents: /);
  });

  it("keeps the client file, hooks and react-aria-components out of the server module graph", () => {
    const source = readFileSync(resolve(import.meta.dirname, "TableOfContents.server.tsx"), "utf8");
    const runtimeImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*from\s+"([^"]+)"/gm)].map(match => match[1]);
    expect(runtimeImports.sort()).toEqual(["../atoms/internal/cx.js", "../atoms/internal/ui-vars.js", "../internal/brandmark.js"]);
    expect(source).not.toMatch(/react-aria-components|IntersectionObserver|useEffect|useState|"use client"/);
  });
});
