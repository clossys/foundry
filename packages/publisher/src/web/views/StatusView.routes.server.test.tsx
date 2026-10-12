// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
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
    const region = /<section\b([^>]*)>([\s\S]*?)<\/section>/.exec(html)!;
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
    // Remove only the canonical hidden NBSP and decorative ChevronRight SVG.
    // Caller text and all other markup remain subject to the ASCII assertion.
    const callerMarkup = html
      .replace(/<span aria-hidden="true">\u00a0<\/span>/g, "")
      .replace(/<svg\b(?=[^>]*\baria-hidden="true")[^>]*><path d="m9 18 6-6-6-6"><\/path><\/svg>/g, "");
    expect(callerMarkup).not.toMatch(/[^\x00-\x7f]/);
    expect(callerMarkup.replace(/<[^>]*>/g, "")).toBe("404Next destinationsHomeHelp");
  });
});
