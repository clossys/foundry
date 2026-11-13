// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertItemLink } from "@clossys/designer/blocks/server";
import { StatusView, type StatusViewProps } from "./StatusView.js";

// Wrap, never replace: the shared helper keeps refusing while the probe counts ViewLinks' own calls.
vi.mock("@clossys/designer/blocks/server", async importOriginal => {
  const actual = await importOriginal<typeof import("@clossys/designer/blocks/server")>();
  return { ...actual, assertItemLink: vi.fn(actual.assertItemLink) };
});
afterEach(cleanup);

// The client path; ViewLinks.safety.server.test.tsx holds the same cases on the server path.
const UNSAFE = ["javascript:alert(1)", "JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)",
  "file:///etc/hosts", "//example.test/path", "https://user:secret@example.test/", "/a\\b", "/a\u0000b", "", " /placeholder/a ", "mailto:", "placeholder"];
const SANCTIONED = ["#details", "/placeholder/a", "https://example.test/placeholder", "mailto:placeholder@example.test"];
const CONTROLS: [string, ReactElement][] = [["button", <span>Copy <button type="button">Other</button></span>], ["anchor", <span>Copy <a href="/other">Other</a></span>],
  ["input", <span>Copy <input aria-label="Other" /></span>], ["tabIndex", <span tabIndex={0}>Copy</span>], ["onClick", <span onClick={() => undefined}>Copy</span>],
  ["contentEditable", <span contentEditable suppressContentEditableWarning>Copy</span>], ["video controls", <span>Copy <video controls /></span>]];
const SLOTS = ["heading", "description", "eyebrow", "icon", "meta", "visual", "badge"] as const;
const HREF = /^Item: href must be an anchor, one-origin path, HTTP\(S\) URL or explicit mail link\.$/;
const NESTED = /^Item: linked item "one" cannot contain another interactive target\.$/;
const routes = (count: 1 | 2, one: Record<string, unknown>) => ({ label: "Next destinations",
  items: [{ id: "one", heading: "One", href: "/one", ...one }, { id: "two", heading: "Two", href: "/two" }].slice(0, count) });
const view = (count: 1 | 2, one: Record<string, unknown>) => render(<StatusView {...({ status: "404", routes: routes(count, one) } as unknown as StatusViewProps)} />).container.innerHTML;

describe("ViewLinks link safety on the client path", () => {
  for (const count of [1, 2] as const) {
    it.each(UNSAFE)(`refuses href %j on the ${count}-item route`, href => { expect(() => view(count, { href })).toThrow(HREF); });
    it.each(CONTROLS)(`refuses a nested %s on the ${count}-item route`, (_name, node) => {
      for (const slot of SLOTS) expect(() => view(count, slot === "badge" ? { badge: { label: node } } : { [slot]: node })).toThrow(NESTED);
    });
    it.each(SANCTIONED)(`keeps sanctioned href %j on the ${count}-item route`, href => { expect(view(count, { href })).toContain(`href="${href}"`); });
  }
});

describe("ViewLinks calls the shared Designer helper", () => {
  for (const count of [1, 2] as const) it(`checks every item of the ${count}-item route before rendering`, () => {
    vi.mocked(assertItemLink).mockClear();
    view(count, {});
    expect(vi.mocked(assertItemLink).mock.calls.map(([item]) => item.id)).toEqual(["one", "two"].slice(0, count));
  });
});
