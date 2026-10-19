import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TOKENS } from "../tokens.js";
import { TOKEN_GUIDANCE } from "../guidance.js";
import { TokenPreview } from "./index.js";

vi.mock("../guidance.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../guidance.js")>();
  return { ...actual, TOKEN_GUIDANCE: structuredClone(actual.TOKEN_GUIDANCE) };
});
const signatures = {
  surface: ["background-color/color"],
  text: ["color/color", "font-size/length", "letter-spacing/length", "line-height/number"],
  border: ["border-color/color", "border-width/length"],
  control: ["background-color/color", "color/color"],
  status: ["background-color/color", "color/color"],
  chart: ["stroke/color", "fill/color"],
  font: ["font-family/font-family", "font-style/font-style", "font-weight/font-weight", "font-stretch/font-stretch", "transform/number"],
  space: ["gap/length", "padding/length", "padding-inline/length"],
  size: ["inline-size/length", "max-inline-size/length", "min-inline-size/length", "min-block-size/length"],
  icon: ["inline-size/length", "stroke-width/number"],
  brandmark: ["block-size/length", "gap/length"],
  radius: ["border-radius/length"], shadow: ["box-shadow/shadow"], blur: ["backdrop-filter/length"],
  ring: ["box-shadow/shadow"], layer: ["z-index/number"], opacity: ["opacity/number"],
};
const counts = {
  surface: 24, text: 28, border: 8, control: 7, status: 12, chart: 22,
  font: 7, space: 13, size: 13, icon: 4, brandmark: 6, radius: 7,
  shadow: 4, blur: 1, ring: 2, layer: 9, opacity: 1,
};
const pending = [
  "--ui-duration-instant", "--ui-duration-fast", "--ui-duration-default", "--ui-duration-deliberate", "--ui-duration-flash", "--ui-duration-overlay",
  "--ease-default", "--ease-decelerate", "--ease-accelerate", "--ease-bounce", "--ease-enter", "--ease-exit",
  "--breakpoint-mobile", "--breakpoint-mobile-lg", "--breakpoint-tablet", "--breakpoint-tablet-lg", "--breakpoint-desktop", "--breakpoint-wide",
];
const examples = [
  ["--color-surface-glass", "background-color", "var(--color-surface-glass, oklch(1 0 0 / 0.88))", "DIV"],
  ["--text-body", "font-size", "var(--text-body, 15px)", "P"],
  ["--ui-border-rule", "border-width", "var(--ui-border-rule, 2px)", "DIV"],
  ["--color-control-quiet", "color", "var(--color-control-quiet, var(--color-ink-primary, oklch(0.2178 0 0)))", "BUTTON"],
  ["--color-status-info-text", "color", "var(--color-status-info-text, oklch(0.52 0 0))", "SPAN"],
  ["--color-chart-surface", "stroke", "var(--color-chart-surface, var(--color-surface-raised, oklch(1 0 0)))", "rect"],
  ["--font-display-scale-x", "transform", "scaleX(var(--font-display-scale-x, 1))", "P"],
  ["--ui-width-page-padding-x", "padding-inline", "var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))", "DIV"],
  ["--ui-density-row", "min-block-size", "var(--ui-density-row, var(--spacing-3xl, 48px))", "DIV"],
  ["--ui-icon-stroke", "stroke-width", "var(--ui-icon-stroke, 2)", "svg"],
  ["--ui-brandmark-height-md", "block-size", "var(--ui-brandmark-height-md, 36px)", "DIV"],
  ["--radius-panel", "border-radius", "var(--radius-panel, var(--radius-surface, var(--radius-default, 3px)))", "DIV"],
  ["--ui-elevation-none", "box-shadow", "var(--ui-elevation-none, none)", "DIV"],
  ["--blur-glass", "backdrop-filter", "blur(var(--blur-glass, 16px))", "DIV"],
  ["--ui-ring-on-inverse", "box-shadow", "var(--ui-ring-on-inverse, 0 0 0 1px rgba(245, 245, 245, 0.12))", "DIV"],
  ["--ui-z-modal", "z-index", "var(--ui-z-modal, 50)", "DIV"],
  ["--ui-alpha-disabled", "opacity", "var(--ui-alpha-disabled, 0.5)", "DIV"],
];
function specimen(property: string, copy: { sampleText?: string; unsupportedMessage?: string; pendingMessage?: string } = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<TokenPreview property={property} {...copy} />);
  return host;
}

describe("exact-property TokenPreview", () => {
  it("partitions all 186 properties bidirectionally into 168 static and 18 pending", () => {
    const supported = Object.keys(TOKEN_GUIDANCE).filter(property => !pending.includes(property));
    expect(Object.keys(TOKEN_GUIDANCE).sort()).toEqual(Object.keys(TOKENS).sort());
    expect(supported).toHaveLength(168);
    expect(new Set([...supported, ...pending]).size).toBe(186);
    expect([...supported, ...pending].sort()).toEqual(Object.keys(TOKENS).sort());
    expect(Object.fromEntries(Object.keys(counts).map(kind => [kind, supported.filter(property => TOKEN_GUIDANCE[property]?.specimen === kind).length]))).toEqual(counts);
    expect(new Set(supported.map(property => TOKEN_GUIDANCE[property]?.specimen))).toEqual(new Set(Object.keys(signatures)));
    expect(pending.filter(property => TOKEN_GUIDANCE[property]?.specimen === "motion")).toHaveLength(12);
    expect(pending.filter(property => TOKEN_GUIDANCE[property]?.specimen === "breakpoint")).toHaveLength(6);
  });
  it("covers every authored static application triple exactly", () => {
    const actual = Object.entries(TOKEN_GUIDANCE)
      .filter(([property]) => !pending.includes(property))
      .map(([, item]) => `${item.specimen}/${item.application.cssProperty}/${item.application.valueType}`);
    const expected = Object.entries(signatures).flatMap(([kind, applications]) => applications.map(application => `${kind}/${application}`));
    expect([...new Set(actual)].sort()).toEqual(expected.sort());
    expect(expected).toHaveLength(35);
  });
  it("actually renders every supported property through its own cascade variable, without tables", () => {
    for (const property of Object.keys(TOKENS).filter(property => !pending.includes(property))) {
      const host = specimen(property);
      expect(host.querySelector("figure")?.getAttribute("data-kind"), property).toBe(TOKEN_GUIDANCE[property]?.specimen);
      expect(host.querySelector("figure")?.getAttribute("aria-label")).toBe(property);
      expect(host.querySelector("[role=status], table"), property).toBeNull();
      expect(host.querySelector("figure")?.children.length, property).toBeGreaterThan(0);
      const reference = `var(${property}, ${TOKENS[property]!.value})`;
      expect([...host.querySelectorAll("[style]")].some(node => node.getAttribute("style")?.includes(reference)), property).toBe(true);
    }
  });
  it.each(examples)("applies an independent %s specimen style", (property, css, value, tag) => {
    const nodes = [...specimen(property!).querySelectorAll<HTMLElement>("[style]")];
    expect(nodes.some(node => node.tagName === tag && node.getAttribute("style")?.split(";").includes(`${css}:${value}`))).toBe(true);
  });
  it("keeps chart surface transparent and icon stroke visible", () => {
    const plot = specimen("--color-chart-surface").querySelector("rect")!;
    expect(plot.style.stroke).toBe("var(--color-chart-surface, var(--color-surface-raised, oklch(1 0 0)))");
    expect(plot.getAttribute("fill")).toBe("none");
    expect(plot.style.fill).toBe("");
    expect(specimen("--color-chart-axis-label").querySelector("text")?.textContent).toBe("Aa 0123");
    expect(specimen("--ui-icon-stroke").querySelector("svg")?.style.stroke).toBe("var(--color-ink-primary, oklch(0.2178 0 0))");
  });
  it("provides real backings for inverse, accent and alpha applications", () => {
    for (const property of ["--color-ink-on-inverse", "--color-line-on-inverse", "--color-control-tonal-inverse", "--ui-ring-on-inverse"]) {
      expect(specimen(property).querySelector("figure")?.getAttribute("style")).toContain("background:var(--color-surface-inverse, oklch(0.2178 0 0));");
    }
    expect(specimen("--color-ink-on-accent").querySelector("figure")?.getAttribute("style")).toContain("background:var(--color-accent, oklch(0.4748 0 0));");
    for (const property of ["--color-surface-glass", "--color-overlay-scrim", "--ui-alpha-disabled"]) {
      expect(specimen(property).querySelector("figure")?.getAttribute("style")).toContain("background-image:repeating-conic-gradient(var(--color-surface-base, oklch(0.9702 0 0)) 0% 25%, var(--color-surface-inverse, oklch(0.2178 0 0)) 0% 50%);");
    }
  });
  it("pairs inverse plate grounds and ink", () => {
    for (const property of ["--color-line-on-inverse", "--ui-ring-on-inverse"]) {
      const style = specimen(property).querySelector("figure")?.firstElementChild?.getAttribute("style");
      expect(style).toContain("background:var(--color-surface-inverse, oklch(0.2178 0 0));");
      expect(style).toContain("color:var(--color-ink-on-inverse, oklch(0.9702 0 0));");
    }
  });
  it("pins authored fallbacks for unselected scaffold roles", () => {
    const cases = [
      ["--radius-panel", "figure > div", "background:var(--color-surface-raised, oklch(1 0 0));"],
      ["--radius-panel", "figure > div", "color:var(--color-ink-primary, oklch(0.2178 0 0));"],
      ["--ui-border-rule", "figure > div", "border:2px solid var(--color-line-strong, oklch(0.7763 0 0));"],
      ["--spacing-sm", "span", "background:var(--color-accent, oklch(0.4748 0 0))"],
      ["--blur-glass", "figure > div > div", "background:var(--color-surface-glass, oklch(1 0 0 / 0.88));"],
    ];
    for (const [property, selector, declaration] of cases) {
      expect(specimen(property!).querySelector(selector!)?.getAttribute("style"), property).toContain(declaration);
    }
  });
  it("bounds the mark for gap specimens while retaining authored height specimens", () => {
    const gap = specimen("--ui-brandmark-gap-md");
    expect(gap.querySelector("figure > div")?.getAttribute("style")).toContain("gap:var(--ui-brandmark-gap-md, 6px)");
    expect(gap.querySelector("svg")?.getAttribute("style")).toContain("block-size:24px;");
    expect(gap.querySelector("svg")?.getAttribute("style")).toContain("aspect-ratio:1;");
    expect(specimen("--ui-brandmark-height-md").querySelector("svg")?.getAttribute("style")).toContain("block-size:100%;");
  });
  it("supports default and custom sample text at every text-bearing kind and layer site", () => {
    const sites = [
      ["--color-surface-glass", "figure > div"], ["--text-body", "p"],
      ["--ui-border-rule", "figure > div"], ["--color-control-quiet", "button"],
      ["--color-status-info-text", "span"], ["--color-chart-axis-label", "text"],
      ["--font-display-scale-x", "p"], ["--ui-density-row", "figure > div"],
      ["--ui-brandmark-height-md", "span"], ["--radius-panel", "figure > div"],
      ["--ui-elevation-none", "figure > div"], ["--blur-glass", "figure > div > div"],
      ["--ui-ring-on-inverse", "figure > div"], ["--ui-alpha-disabled", "figure > div"],
      ["--ui-z-modal", "figure > div > div:first-child"], ["--ui-z-modal", "figure > div > div:last-child"],
    ];
    for (const [property, selector] of sites) {
      const ordinary = specimen(property!).querySelector(selector!)!;
      const custom = specimen(property!, { sampleText: "Custom specimen" }).querySelector(selector!)!;
      expect(ordinary.textContent, property).toBe("Aa 0123");
      expect(custom.textContent, property).toBe("Custom specimen");
      expect(custom.getAttribute("style"), property).toBe(ordinary.getAttribute("style"));
    }
  });
  it("reports each pending property with its true kind and explicit pending status", () => {
    for (const property of pending) {
      const host = specimen(property);
      expect(host.querySelector("figure, table")).toBeNull();
      expect(host.querySelector("[role=status]")?.getAttribute("data-kind")).toBe(TOKEN_GUIDANCE[property]?.specimen);
      expect(host.textContent).toContain(`${TOKEN_GUIDANCE[property]?.specimen}: interactive support pending`);
      const custom = specimen(property, { pendingMessage: "Custom pending message" });
      expect(custom.textContent).toBe(`${TOKEN_GUIDANCE[property]?.specimen}: Custom pending message`);
      expect(custom.querySelector("[role=status]")?.getAttribute("data-kind")).toBe(TOKEN_GUIDANCE[property]?.specimen);
    }
  });
  it("refuses unknown properties and missing, malformed or unsupported authored applications", () => {
    for (const property of ["--not-a-token", "toString", ""]) expect(specimen(property).textContent).toBe("Unsupported token application");
    expect(specimen("--not-a-token", { unsupportedMessage: "Custom refusal" }).textContent).toBe("Custom refusal");
    const mutable = TOKEN_GUIDANCE as unknown as Record<string, unknown>;
    const original = TOKEN_GUIDANCE["--color-accent"]!;
    const replacements = [
      undefined,
      { ...original, application: undefined },
      { ...original, application: {} },
      { ...original, application: { ...original.application, valueType: "length" } },
      { ...original, application: { ...original.application, cssProperty: "fill" } },
      ...["unknown", "toString", "constructor"].map(specimen => ({ ...original, specimen })),
    ];
    for (const replacement of replacements) {
      try {
        mutable["--color-accent"] = replacement;
        const host = specimen("--color-accent");
        expect(host.textContent).toBe("Unsupported token application");
        expect(host.querySelector("figure, table")).toBeNull();
      } finally { mutable["--color-accent"] = original; }
    }
  });
});
