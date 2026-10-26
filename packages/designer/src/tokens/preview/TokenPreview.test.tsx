import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKENS, type TokenDefinition } from "../tokens.js";
import { TOKEN_GUIDANCE } from "../guidance.js";
import { contrastRatio } from "../color.js";
import { parseDeclarationsForSelector, parseRootDeclarations } from "../internal/parse-css.js";
import { resolveTokenValue } from "../internal/resolve-token-value.js";
import { TokenPreview } from "./index.js";

vi.mock("../guidance.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../guidance.js")>();
  return { ...actual, TOKEN_GUIDANCE: structuredClone(actual.TOKEN_GUIDANCE) };
});
vi.mock("../tokens.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../tokens.js")>();
  return { ...actual, TOKENS: structuredClone(actual.TOKENS) };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("style"); });
const signatures = {
  surface: ["background-color/color"],
  text: ["color/color", "font-size/length", "letter-spacing/length", "line-height/number"],
  border: ["border-color/color", "border-width/length"],
  control: ["background-color/color", "color/color"],
  status: ["background-color/color", "color/color"],
  chart: ["stroke/color", "fill/color"],
  font: ["font-family/font-family", "font-style/font-style", "font-weight/font-weight", "font-stretch/font-stretch", "transform/number"],
  space: ["gap/length", "padding/length", "padding-inline/length", "translate/length"],
  size: ["inline-size/length", "max-inline-size/length", "min-inline-size/length", "min-block-size/length", "block-size/length", "max-block-size/length"],
  icon: ["inline-size/length", "stroke-width/number"],
  brandmark: ["block-size/length", "gap/length"],
  radius: ["border-radius/length"], shadow: ["box-shadow/shadow"], blur: ["backdrop-filter/length"],
  ring: ["box-shadow/shadow", "outline-color/color", "outline-offset/length"], layer: ["z-index/number"], opacity: ["opacity/number"],
  motion: ["transition-duration/duration", "transition-timing-function/easing"], breakpoint: ["@media (min-width)/length"],
};
const counts = {
  surface: 24, text: 29, border: 9, control: 12, status: 12, chart: 22,
  font: 7, space: 14, size: 29, icon: 4, brandmark: 6, radius: 8,
  shadow: 4, blur: 2, ring: 5, layer: 11, opacity: 4, motion: 18, breakpoint: 6,
};
const interactive = [
  "--ui-duration-instant", "--ui-duration-fast", "--ui-duration-default", "--ui-duration-deliberate", "--ui-duration-flash", "--ui-duration-overlay",
  "--ui-duration-loading-delay", "--ui-duration-loading-min", "--ui-duration-loading-long", "--ui-duration-tooltip-delay", "--ui-duration-tooltip-close", "--ui-duration-confirm-hold",
  "--ease-default", "--ease-decelerate", "--ease-accelerate", "--ease-bounce", "--ease-enter", "--ease-exit",
  "--breakpoint-mobile", "--breakpoint-mobile-lg", "--breakpoint-tablet", "--breakpoint-tablet-lg", "--breakpoint-desktop", "--breakpoint-wide",
];
const examples = [
  ["--color-surface-glass", "background-color", "var(--color-surface-glass, oklch(1 0 0 / 0.6))", "DIV"],
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
  ["--blur-glass", "backdrop-filter", "blur(var(--blur-glass, 20px))", "DIV"],
  ["--ui-ring-on-inverse", "box-shadow", "var(--ui-ring-on-inverse, 0 0 0 2px var(--color-focus-ring-on-inverse, oklch(0.9702 0 0)))", "DIV"],
  ["--ui-z-modal", "z-index", "var(--ui-z-modal, 50)", "DIV"],
  ["--ui-alpha-disabled", "opacity", "var(--ui-alpha-disabled, 0.5)", "DIV"],
];
function specimen(property: string, copy: Omit<Parameters<typeof TokenPreview>[0], "property"> = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<TokenPreview property={property} {...copy} />);
  return host;
}

// Literal current-contract inventory: never rebuilt from either runtime registry by this test.
// Columns are property, authored value, specimen, CSS property, value type.
const supportedProperties = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/supported-properties.json"), "utf8")) as readonly (readonly [string, string, string, string, string])[];
const tokensCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../styles/tokens.css"), "utf8");
const neutralProperties = Object.keys(TOKENS).filter(property => TOKENS[property]!.family === "neutral");
function themeTokens(theme: "light" | "dark"): Record<string, TokenDefinition> {
  const declarations = parseRootDeclarations(tokensCss);
  if (theme === "dark") {
    for (const [property, value] of parseDeclarationsForSelector(tokensCss, ':root[data-theme="dark"]')) declarations.set(property, value);
  }
  return Object.fromEntries(Object.entries(TOKENS).map(([property, definition]) => [property, {
    ...definition, value: declarations.get(property) ?? definition.value,
  }]));
}

// jsdom does not resolve custom properties. Resolve the specimen's actual
// text/nearest painted ground against the shipped CSS, including dark aliases.
function samplePaint(sample: HTMLElement, role: "color" | "background", tokens: Record<string, TokenDefinition>): string {
  for (let node: HTMLElement | null = sample; node; node = node.parentElement) {
    const value = role === "color" ? node.style.color : node.style.backgroundColor || node.style.background;
    if (!value || value === "transparent") continue;
    const property = /^var\((--[\w-]+)/.exec(value)?.[1];
    if (!property) return value;
    const resolved = resolveTokenValue(property, tokens);
    expect(resolved.cycle ?? resolved.missingProperty).toBeUndefined();
    expect(resolved.value).toBeDefined();
    return resolved.value!;
  }
  throw new Error(`Sample has no authored ${role}`);
}

describe("exact-property TokenPreview", () => {
  it("pins the literal 226-property inventory, application bindings and shipped CSS values independently", () => {
    const expected = supportedProperties.map(([property]) => property);
    expect(expected).toHaveLength(226);
    expect(new Set(expected).size).toBe(226);
    expect(Object.keys(TOKENS).sort()).toEqual(expected);
    expect(Object.keys(TOKEN_GUIDANCE).sort()).toEqual(expected);
    const declarations = parseRootDeclarations(tokensCss);
    expect([...declarations.keys()].sort()).toEqual(expected);
    for (const [property, value, specimen, cssProperty, valueType] of supportedProperties) {
      expect(TOKENS[property]?.property, property).toBe(property);
      expect(TOKENS[property]?.value, property).toBe(value);
      expect(declarations.get(property), property).toBe(value);
      expect(TOKEN_GUIDANCE[property]?.specimen, property).toBe(specimen);
      expect(TOKEN_GUIDANCE[property]?.application.cssProperty, property).toBe(cssProperty);
      expect(TOKEN_GUIDANCE[property]?.application.valueType, property).toBe(valueType);
    }
  });

  it("partitions all 226 supported properties bidirectionally with zero unavailable", () => {
    const supported = Object.keys(TOKEN_GUIDANCE);
    expect(Object.keys(TOKEN_GUIDANCE).sort()).toEqual(Object.keys(TOKENS).sort());
    expect(supported).toHaveLength(226);
    expect(new Set(interactive).size).toBe(24);
    expect(supported.sort()).toEqual(Object.keys(TOKENS).sort());
    expect(interactive.slice().sort()).toEqual(supported.filter(property => ["motion", "breakpoint"].includes(TOKEN_GUIDANCE[property]!.specimen)).sort());
    expect(Object.fromEntries(Object.keys(counts).map(kind => [kind, supported.filter(property => TOKEN_GUIDANCE[property]?.specimen === kind).length]))).toEqual(counts);
    expect(new Set(supported.map(property => TOKEN_GUIDANCE[property]?.specimen))).toEqual(new Set(Object.keys(signatures)));
    expect(interactive.filter(property => TOKEN_GUIDANCE[property]?.specimen === "motion")).toHaveLength(18);
    expect(interactive.filter(property => TOKEN_GUIDANCE[property]?.specimen === "breakpoint")).toHaveLength(6);
  });
  it("covers every authored application triple exactly", () => {
    const actual = Object.entries(TOKEN_GUIDANCE)
      .map(([, item]) => `${item.specimen}/${item.application.cssProperty}/${item.application.valueType}`);
    const expected = Object.entries(signatures).flatMap(([kind, applications]) => applications.map(application => `${kind}/${application}`));
    expect([...new Set(actual)].sort()).toEqual(expected.sort());
    expect(expected).toHaveLength(43);
  });
  it("actually renders every supported property through its own cascade variable, without tables", () => {
    for (const property of Object.keys(TOKENS)) {
      const host = specimen(property);
      expect(host.querySelector("figure")?.getAttribute("data-kind"), property).toBe(TOKEN_GUIDANCE[property]?.specimen);
      expect(host.querySelector("figure")?.getAttribute("aria-label")).toBe(property);
      expect(host.querySelector("[role=status], table"), property).toBeNull();
      expect(host.querySelector("figure")?.children.length, property).toBeGreaterThan(0);
      const reference = `var(${property}, ${TOKENS[property]!.value})`;
      expect([...host.querySelectorAll("[style]")].some(node => node.getAttribute("style")?.includes(reference)) || (TOKEN_GUIDANCE[property]!.specimen === "motion" && host.querySelector("code")?.textContent === TOKENS[property]!.value), property).toBe(true);
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
  it.each([
    ["--color-neutral-50", "--color-neutral-900"],
    ["--color-neutral-100", "--color-neutral-900"],
    ["--color-neutral-200", "--color-neutral-900"],
    ["--color-neutral-300", "--color-neutral-900"],
    ["--color-neutral-400", "--color-neutral-900"],
    ["--color-neutral-600", "--color-neutral-50"],
    ["--color-neutral-700", "--color-neutral-50"],
    ["--color-neutral-800", "--color-neutral-50"],
    ["--color-neutral-900", "--color-neutral-50"],
    ["--color-neutral-950", "--color-neutral-50"],
  ])("pairs %s with theme-independent neutral foreground %s", (property, foreground) => {
    expect(specimen(property).querySelector("figure > div")?.getAttribute("style"))
      .toContain(`color:var(${foreground}, ${TOKENS[foreground]!.value});`);
  });
  it.each((["light", "dark"] as const).flatMap(theme => [...neutralProperties, "--color-accent", "--color-accent-hover"].map(property => [theme, property] as const)))(
    "keeps the actual %s %s sample text above normal-text AA contrast", (theme, property) => {
      expect(neutralProperties).toHaveLength(11);
      const plate = specimen(property).querySelector<HTMLElement>("figure > div, figure > button")!;
      const sample = [plate, ...plate.querySelectorAll<HTMLElement>("*")].find(node => node.childElementCount === 0 && node.textContent === "Aa 0123")!;
      expect(sample).toBeDefined();
      const tokens = themeTokens(theme);
      const foreground = samplePaint(sample, "color", tokens);
      const background = samplePaint(sample, "background", tokens);
      expect(contrastRatio(foreground, background), `${property}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      expect(plate.style.backgroundColor).toBe(`var(${property}, ${TOKENS[property]!.value})`);
    },
  );
  it.each(["--color-accent", "--color-accent-hover"])("pairs %s with on-accent ink", property => {
    expect(specimen(property).querySelector("figure > div, figure > button")?.getAttribute("style"))
      .toContain(`color:var(--color-ink-on-accent, ${TOKENS["--color-ink-on-accent"]!.value});`);
  });
  it.each(Object.keys(TOKENS).filter(property => TOKEN_GUIDANCE[property]?.specimen === "layer"))(
    "keeps the %s target and sample inspectable below the transparent reference", property => {
      const plates = specimen(property).querySelectorAll<HTMLElement>("figure > div > div");
      const reference = plates[0]!;
      const target = plates[1]!;
      expect(reference.style.background).toBe("transparent");
      expect(reference.style.padding).toBe("0px");
      expect(reference.style.zIndex).toBe("1");
      const caption = reference.querySelector<HTMLElement>("span")!;
      expect(caption).not.toBeNull();
      expect(caption.style.display).toBe("block");
      // The only opaque reference ground stays above the target, including
      // custom text that would otherwise wrap into its sample area.
      expect(parseFloat(caption.style.blockSize)).toBeLessThanOrEqual(parseFloat(target.style.top));
      expect(caption.style.overflow).toBe("hidden");
      expect(caption.style.whiteSpace).toBe("nowrap");
      expect(target.style.zIndex).toBe(`var(${property}, ${TOKENS[property]!.value})`);
      expect(reference.style.right).toBe("24px");
      expect(reference.style.bottom).toBe("24px");
      expect(target.style.right).toBe("0px");
      expect(target.style.bottom).toBe("0px");
      expect(target.style.left).toBe("24px");
      expect(target.style.top).toBe("24px");
    },
  );
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
      ["--blur-glass", "figure > div > div", "background:var(--color-surface-glass, oklch(1 0 0 / 0.6));"],
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
  function media(reduced = false, breakpointMatches = true) {
    const queries = new Map<string, { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> }>();
    const matchMedia = vi.fn((query: string) => {
      const result = { matches: query.includes("reduced-motion") ? reduced : breakpointMatches, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      queries.set(query, result);
      return result;
    });
    vi.stubGlobal("matchMedia", matchMedia);
    return { queries, matchMedia };
  }
  it.each(interactive.filter(property => TOKEN_GUIDANCE[property]!.specimen === "motion"))("replays %s only on user action through the exact authored application", property => {
    media();
    const { container, getByRole } = render(<TokenPreview property={property} />);
    const moving = container.querySelector<HTMLElement>("[data-token-preview-motion]")!;
    expect(moving).not.toBeNull();
    expect(moving.style.transform).toBe("translateX(0)");
    expect(moving.style.animation).toBe("");
    expect(moving.classList.contains("transition-transform")).toBe(true);
    expect(moving.classList.contains("motion-reduce:transition-none")).toBe(true);
    expect(moving.style.getPropertyValue(TOKEN_GUIDANCE[property]!.application.cssProperty)).toBe(`var(${property}, ${TOKENS[property]!.value})`);
    expect(container.textContent).toContain(TOKENS[property]!.value);
    expect(container.querySelector("code")?.parentElement?.textContent).toBe(`Authored value: ${TOKENS[property]!.value}`);
    const reset = vi.fn(() => {
      expect(moving.style.transitionProperty).toBe("none");
      expect(moving.style.transform).toBe("translateX(0)");
      return 24;
    });
    Object.defineProperty(moving, "offsetWidth", { get: reset });
    fireEvent.click(getByRole("button", { name: "Replay" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(moving.style.transform).toBe("translateX(64px)");
    expect(moving.style.transitionProperty).toBe("");
    fireEvent.click(getByRole("button", { name: "Replay" }));
    expect(reset).toHaveBeenCalledTimes(2);
    expect(moving.style.transform).toBe("translateX(64px)");
    expect(moving.style.transitionProperty).toBe("");
  });
  it.each(interactive.filter(property => TOKEN_GUIDANCE[property]!.specimen === "motion"))("keeps %s static with identical authored information under reduced motion", property => {
    const { queries } = media(true);
    const { container, queryByRole, unmount } = render(<TokenPreview property={property} />);
    expect(container.textContent).toContain(TOKENS[property]!.value);
    expect(container.textContent).toContain("Reduced motion");
    expect(container.querySelector("code")?.parentElement?.textContent).toBe(`Authored value: ${TOKENS[property]!.value}`);
    expect(queryByRole("button")).toBeNull();
    expect(container.querySelector("[class*=transition], [class*=animate]")).toBeNull();
    expect(container.querySelector("[style*=transition], [style*=animation]")).toBeNull();
    const preference = queries.get("(prefers-reduced-motion: reduce)")!;
    expect(preference.addEventListener).toHaveBeenCalledTimes(1);
    unmount();
    expect(preference.removeEventListener).toHaveBeenCalledWith("change", preference.addEventListener.mock.calls[0]![1]);
  });
  it("reacts to a changed motion preference without autoplay", () => {
    const { queries } = media();
    const { container, queryByRole } = render(<TokenPreview property="--ease-enter" />);
    const preference = queries.get("(prefers-reduced-motion: reduce)")!;
    act(() => preference.addEventListener.mock.calls[0]![1]({ matches: true }));
    expect(queryByRole("button")).toBeNull();
    expect(container.querySelector("[class*=transition]")).toBeNull();
    act(() => preference.addEventListener.mock.calls[0]![1]({ matches: false }));
    expect(container.querySelector<HTMLElement>("[data-token-preview-motion]")?.style.transform).toBe("translateX(0)");
  });
  it.each(interactive.filter(property => TOKEN_GUIDANCE[property]!.specimen === "breakpoint"))("resolves %s and tracks its exact query once, cleaning up on unmount", property => {
    const { queries, matchMedia } = media();
    const { container, rerender, unmount } = render(<TokenPreview property={property} />);
    const query = `(min-width: ${TOKENS[property]!.value})`;
    expect(matchMedia).toHaveBeenCalledWith(query);
    expect(container.textContent).toContain(`Threshold: ${TOKENS[property]!.value}`);
    expect(container.textContent).toContain("Match: yes");
    const subscription = queries.get(query)!;
    act(() => subscription.addEventListener.mock.calls[0]![1]({ matches: false }));
    expect(container.textContent).toContain("Match: no");
    rerender(<TokenPreview property={property} />);
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(subscription.addEventListener).toHaveBeenCalledTimes(1);
    unmount();
    expect(subscription.removeEventListener).toHaveBeenCalledTimes(1);
    expect(subscription.removeEventListener).toHaveBeenCalledWith("change", subscription.addEventListener.mock.calls[0]![1]);
  });
  it("resolves the selected breakpoint's cascade rem value against the root font size and replaces subscriptions", () => {
    const { queries, matchMedia } = media();
    document.documentElement.style.fontSize = "20px";
    cascade("--breakpoint-tablet", "40rem");
    const { container, rerender, unmount } = render(<TokenPreview property="--breakpoint-tablet" />);
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 800px)");
    expect(container.textContent).toContain("Threshold: 800px");
    const old = queries.get("(min-width: 800px)")!;
    rerender(<TokenPreview property="--breakpoint-wide" />);
    expect(old.removeEventListener).toHaveBeenCalledTimes(1);
    expect(old.removeEventListener).toHaveBeenCalledWith("change", old.addEventListener.mock.calls[0]![1]);
    expect(matchMedia).toHaveBeenLastCalledWith(`(min-width: ${TOKENS["--breakpoint-wide"]!.value})`);
    const current = queries.get(`(min-width: ${TOKENS["--breakpoint-wide"]!.value})`)!;
    expect(current.addEventListener).toHaveBeenCalledTimes(1);
    unmount();
    expect(current.removeEventListener).toHaveBeenCalledTimes(1);
    expect(current.removeEventListener).toHaveBeenCalledWith("change", current.addEventListener.mock.calls[0]![1]);
  });
  it("uses authored application metadata rather than a token family", () => {
    const token = TOKENS["--ui-duration-fast"]!;
    const original = token.family;
    try {
      (token as { family: string }).family = "color";
      expect(specimen("--ui-duration-fast").querySelector("figure")?.getAttribute("data-kind")).toBe("motion");
    } finally { (token as { family: string }).family = original; }
  });
  function cascade(property: string, value: string | (() => string), width?: string | (() => string)) {
    const nativeComputed = getComputedStyle;
    vi.stubGlobal("getComputedStyle", (node: Element) => {
      const result = nativeComputed(node);
      return node.isConnected && node.tagName === "SPAN" && node.closest("figure")?.getAttribute("aria-label") === property ? new Proxy(result, { get(target, key) {
        if (key === "getPropertyValue") return (name: string) => name === property ? typeof value === "function" ? value() : value : target.getPropertyValue(name);
        if (key === "width" && width !== undefined) return typeof width === "function" ? width() : width;
        return Reflect.get(target, key);
      } }) : result;
    });
  }
  it("does not autoplay while time passes or an identical property rerenders", () => {
    vi.useFakeTimers();
    media();
    const { container, rerender } = render(<TokenPreview property="--ui-duration-instant" />);
    act(() => vi.advanceTimersByTime(60_000));
    rerender(<TokenPreview property="--ui-duration-instant" />);
    expect(container.querySelector<HTMLElement>("[data-token-preview-motion]")?.style.transform).toBe("translateX(0)");
  });
  it("resolves a scoped breakpoint override and browser-resolved calc without using a registry default", () => {
    const { matchMedia } = media();
    cascade("--breakpoint-tablet", "calc(20rem + 8px)", "408px");
    const { container } = render(<TokenPreview property="--breakpoint-tablet" />);
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 408px)");
    expect(container.textContent).toContain("Threshold: 408px");
  });
  function observers() {
    const instances: { notify: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(notify: () => void) { instances.push({ notify, observe: this.observe, disconnect: this.disconnect }); }
    });
    return instances;
  }
  it("refreshes a viewport-dependent cascade threshold and replaces only the changed query", () => {
    vi.stubGlobal("innerWidth", 1200);
    const observation = observers();
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const queries: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> }[] = [];
    const matchMedia = vi.fn((query: string) => {
      const result = { matches: window.innerWidth >= Number(/min-width: ([\d.]+)px/.exec(query)![1]), addEventListener: vi.fn(), removeEventListener: vi.fn() };
      queries.push(result);
      return result;
    });
    vi.stubGlobal("matchMedia", matchMedia);
    cascade("--breakpoint-tablet", "calc(50vw + 100px)", () => `${window.innerWidth / 2 + 100}px`);
    const { container, unmount } = render(<TokenPreview property="--breakpoint-tablet" />);
    expect(container.textContent).toContain("Threshold: 700px; Match: yes");
    const previous = queries[0]!;
    const stale = previous.addEventListener.mock.calls[0]![1];
    act(() => { vi.stubGlobal("innerWidth", 500); fireEvent.resize(window); stale({ matches: false }); });
    expect(container.textContent).toContain("Threshold: 350px; Match: yes");
    expect(matchMedia.mock.calls.map(([query]) => query)).toEqual(["(min-width: 700px)", "(min-width: 350px)"]);
    expect(previous.removeEventListener).toHaveBeenCalledTimes(1);
    expect(previous.removeEventListener).toHaveBeenCalledWith("change", stale);
    expect(queries[1]!.addEventListener).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.resize(window); observation[0]!.notify(); observation[0]!.notify(); });
    expect(matchMedia).toHaveBeenCalledTimes(2);
    const resize = added.mock.calls.find(([type]) => type === "resize")![1];
    expect(added.mock.calls.filter(([type]) => type === "resize")).toHaveLength(1);
    unmount();
    expect(removed).toHaveBeenCalledWith("resize", resize);
    expect(observation[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(queries[1]!.removeEventListener).toHaveBeenCalledTimes(1);
    expect(queries[1]!.removeEventListener).toHaveBeenCalledWith("change", queries[1]!.addEventListener.mock.calls[0]![1]);
    act(() => { vi.stubGlobal("innerWidth", 900); fireEvent.resize(window); observation[0]!.notify(); });
    expect(matchMedia).toHaveBeenCalledTimes(2);
  });
  it("rereads root rem sizing on observed threshold changes without duplicating subscriptions", () => {
    const { queries, matchMedia } = media();
    const observation = observers();
    document.documentElement.style.fontSize = "20px";
    cascade("--breakpoint-tablet", "40rem");
    const { container, unmount } = render(<TokenPreview property="--breakpoint-tablet" />);
    expect(container.textContent).toContain("Threshold: 800px");
    expect(observation).toHaveLength(1);
    expect(observation[0]!.observe).toHaveBeenCalledTimes(1);
    expect(observation[0]!.observe).toHaveBeenCalledWith(container.querySelector("span"));
    const previous = queries.get("(min-width: 800px)")!;
    act(() => { document.documentElement.style.fontSize = "25px"; observation[0]!.notify(); });
    expect(container.textContent).toContain("Threshold: 1000px");
    expect(previous.removeEventListener).toHaveBeenCalledTimes(1);
    expect(previous.removeEventListener).toHaveBeenCalledWith("change", previous.addEventListener.mock.calls[0]![1]);
    act(() => observation[0]!.notify());
    expect(matchMedia).toHaveBeenCalledTimes(2);
    unmount();
    expect(observation[0]!.disconnect).toHaveBeenCalledTimes(1);
  });
  it("observes unresolved cascade values and cleans up stale queries before recovering", () => {
    const { queries, matchMedia } = media();
    const observation = observers();
    let value = "invalid";
    cascade("--breakpoint-tablet", () => value, "auto");
    const { container, unmount } = render(<TokenPreview property="--breakpoint-tablet" />);
    expect(container.textContent).toContain("Threshold: unavailable; Match: unavailable");
    expect(matchMedia).not.toHaveBeenCalled();
    expect(observation).toHaveLength(1);
    act(() => { value = "512px"; observation[0]!.notify(); });
    expect(container.textContent).toContain("Threshold: 512px; Match: yes");
    const previous = queries.get("(min-width: 512px)")!;
    const stale = previous.addEventListener.mock.calls[0]![1];
    act(() => { value = "invalid"; observation[0]!.notify(); stale({ matches: true }); });
    expect(container.textContent).toContain("Threshold: unavailable; Match: unavailable");
    expect(previous.removeEventListener).toHaveBeenCalledTimes(1);
    expect(previous.removeEventListener).toHaveBeenCalledWith("change", stale);
    act(() => { value = "640px"; observation[0]!.notify(); });
    expect(container.textContent).toContain("Threshold: 640px; Match: yes");
    unmount();
    expect(queries.get("(min-width: 640px)")!.removeEventListener).toHaveBeenCalledTimes(1);
  });
  it("contains the absolute breakpoint probe in a positioned, clipped zero-size box", () => {
    media();
    const { container } = render(<TokenPreview property="--breakpoint-wide" />);
    const probe = container.querySelector<HTMLElement>('span[aria-hidden="true"]')!;
    expect(probe.style.position).toBe("absolute");
    expect(probe.style.width).toBe("var(--breakpoint-wide, 1440px)");
    const bounds = probe.parentElement!;
    expect(bounds.style.position).toBe("relative");
    expect(bounds.style.overflow).toBe("hidden");
    expect(bounds.style.inlineSize).toBe("0");
    expect(bounds.style.blockSize).toBe("0");
    expect(bounds.children).toHaveLength(1);
  });
  it.each(["-10px", "-0.5px", "-2rem"])("refuses negative breakpoint %s even when the probe width is clamped to zero", value => {
    const { matchMedia } = media();
    cascade("--breakpoint-tablet", value, "0px");
    vi.stubGlobal("CSS", { supports: () => true });
    const { container } = render(<TokenPreview property="--breakpoint-tablet" />);
    expect(matchMedia).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Threshold: unavailable; Match: unavailable");
  });
  it("does not invent a match when an override cannot resolve", () => {
    const { matchMedia } = media();
    cascade("--breakpoint-tablet", "invalid", "auto");
    const { container } = render(<TokenPreview property="--breakpoint-tablet" />);
    expect(matchMedia).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Threshold: unavailable; Match: unavailable");
  });
  it("uses the authored fallback when a scoped reset clears an inherited root override", () => {
    const { matchMedia } = media();
    document.documentElement.style.setProperty("--breakpoint-tablet", "1234px");
    cascade("--breakpoint-tablet", "", "768px");
    render(<TokenPreview property="--breakpoint-tablet" />);
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 768px)");
  });
  it.each(["auto", "50%"])("rejects non-length breakpoint override %s even if width resolves to pixels", value => {
    const { matchMedia } = media();
    cascade("--breakpoint-tablet", value, "400px");
    vi.stubGlobal("CSS", { supports: (property: string) => property === "width" });
    render(<TokenPreview property="--breakpoint-tablet" />);
    expect(matchMedia).not.toHaveBeenCalled();
  });
  it("reports an initially unmatched breakpoint before reacting to changes", () => {
    const { queries } = media(false, false);
    const { container } = render(<TokenPreview property="--breakpoint-tablet" />);
    expect(container.textContent).toContain("Match: no");
    const subscription = queries.get("(min-width: 768px)")!;
    act(() => subscription.addEventListener.mock.calls[0]![1]({ matches: true }));
    expect(container.textContent).toContain("Match: yes");
  });
  it("uses translated copy for replay, reduced motion and breakpoint states", () => {
    const { queries } = media(false, false);
    const copy = { authoredValueLabel: "Written", replayLabel: "Again", reducedMotionMessage: "Still", thresholdLabel: "Limit", matchLabel: "Fits", unavailableMessage: "Waiting", matchesMessage: "Inside", notMatchesMessage: "Outside" };
    const { container, getByRole } = render(<><TokenPreview property="--ease-enter" {...copy} /><TokenPreview property="--breakpoint-tablet" {...copy} /></>);
    expect(getByRole("button", { name: "Again" })).toBeTruthy();
    expect(container.querySelector("code")?.parentElement?.textContent).toBe(`Written: ${TOKENS["--ease-enter"]!.value}`);
    expect(container.textContent).toContain("Limit: 768px; Fits: Outside");
    const preference = queries.get("(prefers-reduced-motion: reduce)")!;
    act(() => preference.addEventListener.mock.calls[0]![1]({ matches: true }));
    expect(container.textContent).toContain("Still");
    expect(container.querySelector("code")?.parentElement?.textContent).toBe(`Written: ${TOKENS["--ease-enter"]!.value}`);
    const subscription = queries.get("(min-width: 768px)")!;
    act(() => subscription.addEventListener.mock.calls[0]![1]({ matches: true }));
    expect(container.textContent).toContain("Fits: Inside");
    expect(specimen("--breakpoint-tablet", copy).textContent).toContain("Limit: Waiting; Fits: Waiting");
  });
  it.each(["--ui-duration-fast", "--ease-enter", "--breakpoint-tablet"])("refuses unsupported authored metadata for %s", property => {
    const mutable = TOKEN_GUIDANCE as unknown as Record<string, unknown>;
    const original = TOKEN_GUIDANCE[property]!;
    for (const replacement of [undefined, { ...original, specimen: "unknown" }, { ...original, application: undefined },
      { ...original, application: { ...original.application, cssProperty: "fill" } },
      { ...original, application: { ...original.application, valueType: "color" } }]) {
      try {
        mutable[property] = replacement;
        const host = specimen(property);
        expect(host.textContent).toBe("Unsupported token application");
        expect(host.querySelector("figure")).toBeNull();
      } finally { mutable[property] = original; }
    }
  });
  it("hydrates server-rendered motion and breakpoint specimens without mismatches", async () => {
    media(false);
    const content = <><TokenPreview property="--ease-enter" /><TokenPreview property="--breakpoint-tablet" /></>;
    const host = document.createElement("div");
    host.innerHTML = renderToString(content);
    document.body.append(host);
    const recoverable = vi.fn();
    let hydrated: ReturnType<typeof hydrateRoot>;
    await act(async () => { hydrated = hydrateRoot(host, content, { onRecoverableError: recoverable }); });
    expect(recoverable).not.toHaveBeenCalled();
    expect(host.querySelector("button")?.textContent).toBe("Replay");
    expect(host.textContent).toContain("Threshold: 768px; Match: yes");
    act(() => hydrated.unmount());
    host.remove();
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

it("uses the registered NativeAction binding as-is at both authored preview action sites", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.tsx"), "utf8");
  expect(source).toContain('import { NativeAction } from "../../components/NativeAction.js";');
  expect(source.match(/<NativeAction\b/g)).toHaveLength(2);
  expect(source).toContain('<NativeAction type="button" onClick={replay}>{replayLabel}</NativeAction>');
  expect(source).toContain('<NativeAction type="button" style={{ ...plate, ...style }}>{sampleText}</NativeAction>');
  expect(source).not.toMatch(/components\/Button\.js|<button\b|onPress=/);
});
