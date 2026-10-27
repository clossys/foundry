// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import * as webServer from "../server.js";
import type { ItemData } from "@clossys/designer/blocks/server";
import type { StatusViewProps } from "./StatusView.js";

type Routes = { label: string; items: readonly (ItemData & { href: string })[] };
describe("StatusView routes through the server entry", () => {
  it("renders a named destination region without browser globals", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    const routes: Routes = { label: "Next destinations", items: Object.freeze([{ id: "home", heading: "Home", href: "/" }, { id: "help", heading: "Help", href: "/help" }]) };
    const props = { status: "404", routes } as StatusViewProps & { routes: Routes };
    const html = renderToStaticMarkup(<webServer.StatusView {...props} />);
    const region = /<section\b(?![^>]*data-designer-section-frame)([^>]*)>([\s\S]*?)<\/section>/.exec(html)!;
    const labelId = /aria-labelledby="([^"]+)"/.exec(region[1]!)?.[1];
    expect(labelId).toBeTruthy();
    expect(region[2]).toContain(`id="${labelId}"`);
    expect(region[1]).not.toContain('aria-label=');
    expect(html).toMatch(/<h2\b[^>]*>Next destinations<\/h2>/);
    expect(html).toContain('data-arrangement="rows"');
    expect(html).toContain('data-treatment="plain"');
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html.indexOf('href="/"')).toBeLessThan(html.indexOf('href="/help"'));
    expect(html).not.toMatch(/<main\b|<header\b|<footer\b| routes=/);
    const rootTag = /^<section\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(rootTag).toContain('data-designer-section-frame=""');
    expect(rootTag).toContain('data-ds-leaf="sections.band"');
    const fragment = JSDOM.fragment(html);
    const hiddenSpaces = fragment.querySelectorAll('span[aria-hidden="true"]');
    expect(Array.from(hiddenSpaces, span => span.textContent)).toEqual(["\u00a0", "\u00a0"]);
    expect(html.match(/\u00a0/g)).toHaveLength(2);
    expect(html).not.toMatch(/[^\x00-\x7f\u00a0]/);
    expect(Array.from(fragment.querySelectorAll('svg[aria-hidden="true"] > path'), path => path.getAttribute("d"))).toEqual(["m9 18 6-6-6-6", "m9 18 6-6-6-6"]);
    expect(fragment.querySelector("script")).toBeNull();
    expect(fragment.textContent).toBe("404Next destinationsHome\u00a0Help\u00a0");
  });
});
