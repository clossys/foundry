import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CallToAction } from "./CallToAction.js";
import { FeatureGrid } from "./FeatureGrid.js";
import { MediaFigure } from "./MediaFigure.js";
import { TestimonialSet } from "./TestimonialSet.js";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("MR-7a evidence section composition", () => {
  it("composes supported content elements through the canonical primitive [mutant: restore raw styled attribution]", () => {
    for (const name of ["CallToAction.tsx", "TestimonialSet.tsx", "Testimonial.server.tsx", "MediaFigure.tsx", "items/compat-features.tsx"]) {
      const text = source(name);
      expect(text, name).toContain("SemanticContent");
      expect(text, name).not.toMatch(/<(?:p|span)\b[^>]*className/);
      expect(text, name).not.toMatch(/<(?:a|button|input)\b/);
    }
  });

  it("keeps feature order, rich content and host attributes across all layouts", () => {
    for (const layout of ["grid", "list", "split"] as const) {
      const html = renderToStaticMarkup(<FeatureGrid layout={layout} id="features" heading="Capabilities" items={[
        { id: "one", heading: "First", description: <em>Details</em> },
        { id: "two", heading: "Second" },
      ]} />);
      expect(html).toContain('id="features"');
      expect(html.indexOf("First")).toBeLessThan(html.indexOf("Second"));
      expect(html).toContain("<em>Details</em>");
    }
  });

  it("preserves CTA heading linkage and both authored action slots", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<CallToAction title="Continue" headingLevel={3} primaryAction={<a href="/start">Start</a>} secondaryAction={<a href="/details">Details</a>} />);
    expect(host.querySelector("h3")?.textContent).toBe("Continue");
    expect(host.querySelector("section")?.getAttribute("aria-labelledby")).toBe(host.querySelector("h3 span")?.id);
    expect(Array.from(host.querySelectorAll("a"), link => link.getAttribute("href"))).toEqual(["/start", "/details"]);
  });

  it("keeps quote attribution, decorative portrait and caption semantics", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<TestimonialSet items={[{ id: "quote", quote: <em>Clear</em>, attributorName: "Example", attributorRole: "Reviewer", portrait: <svg /> }]} />);
    expect(host.querySelectorAll("ul > li > figure")).toHaveLength(1);
    expect(host.querySelector("blockquote em")?.textContent).toBe("Clear");
    expect(host.querySelector("figcaption > span")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("figcaption")?.textContent).toBe("ExampleReviewer");
    host.innerHTML = renderToStaticMarkup(<MediaFigure caption={<em>Caption</em>} framed><img src="/image.png" alt="Example" /></MediaFigure>);
    expect(host.querySelector("figure > figcaption em")?.textContent).toBe("Caption");
    expect(host.querySelector("figure > div > img")?.getAttribute("alt")).toBe("Example");
  });
});
