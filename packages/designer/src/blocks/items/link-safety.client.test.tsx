import type { ReactElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as client from "../index.js";
import * as server from "../server.js";
import * as linkSafety from "./link-safety.js";
import { hasInteractiveTarget, isSanctionedItemHref } from "./link-safety.js";

afterEach(cleanup);
const renderToStaticMarkup = (node: ReactElement) => render(node).container.innerHTML;

// The client entry repeats link-safety.client.test.tsx case for case.
const UNSAFE = ["javascript:alert(1)", "JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "DATA:text/plain,x",
  "vbscript:msgbox(1)", "file:///etc/hosts", "ftp://example.test/x", "//example.test/path", "https://user:secret@example.test/", "https://user@example.test/",
  "/a\\b", "/a\u0000b", "/a\u007fb", "", " ", " /placeholder/a ", "mailto:", "mailto:  ", "placeholder"];
const SANCTIONED = ["#details", "/placeholder/a", "https://example.test/placeholder", "http://example.test/", "mailto:placeholder@example.test"];
const CONTROLS: [string, ReactElement][] = ([["button", <button type="button">Other</button>], ["anchor", <a href="/other">Other</a>],
  ["input", <input aria-label="Other" />], ["select", <select aria-label="Other" />], ["textarea", <textarea aria-label="Other" />],
  ["summary", <details><summary>Other</summary></details>], ["label", <label>Other</label>], ["iframe", <iframe title="Other" />], ["object", <object />],
  ["embed", <embed />], ["tabIndex", <span tabIndex={-1}>Other</span>], ["contentEditable", <span contentEditable suppressContentEditableWarning>Other</span>],
  ["onClick", <span onClick={() => undefined}>Other</span>], ["video controls", <video controls />], ["svg link", <svg><a href="/other"><text>Other</text></a></svg>]] as [string, ReactElement][])
  .map(([name, control]) => [name, <span>Copy {control}</span>] as [string, ReactElement]);
const SLOTS = ["heading", "description", "eyebrow", "icon", "meta", "visual", "badge"] as const;
const slot = (name: (typeof SLOTS)[number], node: ReactElement) => name === "badge" ? { badge: { label: node } } : { [name]: node };
const HREF = /^Item: href must be an anchor, one-origin path, HTTP\(S\) URL or explicit mail link\.$/;
const NESTED = /^Item: linked item "one" cannot contain another interactive target\.$/;
const pair = (one: Record<string, unknown>) => [{ id: "one", heading: "One", href: "/one", ...one }, { id: "two", heading: "Two", href: "/two" }];
const items = (one: Record<string, unknown>) => renderToStaticMarkup(<client.Items arrangement="rows" items={pair(one)} />);

describe("Item link safety on the client entry", () => {
  it("runs with browser globals", () => { expect(typeof window).toBe("object"); expect(typeof document).toBe("object"); });
  it.each(UNSAFE)("client Items refuse href %j", href => { expect(() => items({ href })).toThrow(HREF); });
  it.each(CONTROLS)("client Items refuse a nested %s in a linked item", (_name, node) => {
    for (const name of SLOTS) expect(() => items(slot(name, node))).toThrow(NESTED);
  });
  it.each(SANCTIONED)("client Items keep sanctioned href %j", href => { expect(items({ href })).toContain(`href="${href.replace(/&/g, "&amp;")}"`); });

  it("shares the one server-safe link-safety helper", () => {
    // The helper ships once, from the server-safe entry; client code imports that same function.
    expect(server.assertItemLink).toBe(linkSafety.assertItemLink);
    expect("assertItemLink" in client).toBe(false);
  });
  it.each(UNSAFE)("the helper refuses href %j with the exact Item text", href => {
    expect(isSanctionedItemHref(href)).toBe(false);
    expect(() => server.assertItemLink({ id: "one", heading: "One", href })).toThrow(HREF);
  });
  it.each(SANCTIONED)("the helper keeps sanctioned href %j", href => {
    expect(isSanctionedItemHref(href)).toBe(true);
    expect(() => server.assertItemLink({ id: "one", heading: "One", href })).not.toThrow();
  });
  it.each(CONTROLS)("the helper refuses a nested %s in every linked slot", (_name, node) => {
    expect(hasInteractiveTarget(node)).toBe(true);
    for (const name of [...SLOTS, "figure", "status"] as const) {
      const extra = name === "figure" ? { figure: { value: node } } : name === "status" ? { status: { tone: "info" as const, label: node } } : slot(name, node);
      expect(() => server.assertItemLink({ id: "one", heading: "One", href: "/one", ...extra })).toThrow(NESTED);
    }
  });
  it("leaves unlinked items and inert slots alone", () => {
    expect(() => server.assertItemLink({ id: "one", heading: <button type="button">Not linked</button> })).not.toThrow();
    expect(hasInteractiveTarget(<span><svg><use href="#mark" /></svg><img src="/x.png" alt="" /><video aria-label="Preview" /></span>)).toBe(false);
  });

  it.each(UNSAFE)("client stock Item refuses href %j", href => {
    expect(() => renderToStaticMarkup(<client.StockItem id="one" heading="One" href={href} />)).toThrow(HREF);
  });
  it.each(CONTROLS)("client stock Item refuses a nested %s", (_name, node) => {
    for (const name of SLOTS) expect(() => renderToStaticMarkup(<client.StockItem id="one" heading="One" href="/one" {...slot(name, node)} />)).toThrow(NESTED);
  });
  it("client stock Item renders the stock anatomy as one link", () => {
    const html = renderToStaticMarkup(<client.StockItem id="one" heading="One" description="Support" href="/one" headingLevel={3} />);
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(html).toMatch(/^<a\b[^>]*data-slot="item"[^>]*>/);
    expect(html).toContain('href="/one"');
    expect(html).toMatch(/data-slot="item-title"[^>]*><h3\b[^>]*>One<\/h3>/);
    expect(html).toMatch(/<p data-slot="item-description"[^"]*"[^"]*" data-item-description="">Support<\/p>/);
  });
});
