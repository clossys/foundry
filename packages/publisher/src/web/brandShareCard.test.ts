import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BADGE_INSET_SHARE, BADGE_RADIUS_SHARE } from "@clossys/designer/shell/server";
import { LOCKUP_GAP_RATIO, LOCKUP_WORDMARK_SIZE_RATIO } from "@clossys/designer/tokens";
import { buildFlatTokenMap } from "../image/engine.js";
import { OG_SHARE_CARD_SPEC } from "../templates/channelSpecs.js";
import {
  BRAND_SHARE_CARD_DEFAULT_ROLES,
  BRAND_SHARE_CARD_PLATE_PX,
  ShareCardError,
  buildBrandShareCard,
  type BrandShareCardInput,
  type ShareCardErrorReason,
} from "./shareCard.js";
import * as webIndex from "./index.js";
import * as webServer from "./server.js";
import { buildSiteMetadata } from "./siteMetadata.js";

const PNG_MARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==";

function input(overrides: Partial<BrandShareCardInput> = {}): BrandShareCardInput {
  return {
    markSrc: PNG_MARK,
    wordmark: "Example Studio",
    kicker: "Small tools",
    headline: "Made well, made to last",
    supporting: "A fictional studio for tests.",
    alt: "Example Studio share card",
    ...overrides,
  };
}

function reasonOf(fn: () => unknown): ShareCardErrorReason | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ShareCardError) return error.reason;
    throw error;
  }
  return undefined;
}

type Props = { style?: Record<string, unknown>; children?: ReactNode; className?: unknown; src?: unknown };

interface Walked {
  element: ReactElement<Props>;
  childCount: number;
}

function walk(node: ReactNode, visit: (w: Walked) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isValidElement(node)) return;
  const element = node as Walked["element"];
  const children = element.props.children;
  const list = (Array.isArray(children) ? children : children === undefined ? [] : [children]).filter(
    (child) => child !== null && child !== undefined && child !== false,
  );
  visit({ element, childCount: list.length });
  for (const child of list) walk(child as ReactNode, visit);
}

function collect(node: ReactNode, predicate: (w: Walked) => boolean): Walked[] {
  const found: Walked[] = [];
  walk(node, (w) => {
    if (predicate(w)) found.push(w);
  });
  return found;
}

function collectColours(node: ReactNode): string[] {
  const colours: string[] = [];
  walk(node, ({ element }) => {
    const style = element.props.style ?? {};
    for (const [key, value] of Object.entries(style)) {
      if (/color/i.test(key)) colours.push(String(value));
    }
  });
  return colours;
}

function textOf(node: ReactNode): string {
  return typeof node === "string" ? node : "";
}

function plateOf(node: ReactNode): Walked {
  const plates = collect(node, ({ element }) => element.props.style?.["width"] === BRAND_SHARE_CARD_PLATE_PX && element.props.style?.["height"] === BRAND_SHARE_CARD_PLATE_PX);
  expect(plates).toHaveLength(1);
  return plates[0]!;
}

function wordmarkNodes(node: ReactNode, text: string): Walked[] {
  return collect(node, ({ element }) => textOf(element.props.children) === text);
}

describe("plate geometry from Designer", () => {
  it("draws a 96 by 96 plate with the radius and image side computed from the Designer constants", () => {
    expect(BRAND_SHARE_CARD_PLATE_PX).toBe(96);
    const card = buildBrandShareCard(input());
    const plate = plateOf(card.element);
    expect(plate.element.props.style?.["width"]).toBe(96);
    expect(plate.element.props.style?.["height"]).toBe(96);
    expect(plate.element.props.style?.["borderRadius"]).toBe(96 * BADGE_RADIUS_SHARE);

    const images = collect(plate.element, ({ element }) => element.type === "img");
    expect(images).toHaveLength(1);
    const image = images[0]!.element;
    const side = 96 * (1 - 2 * BADGE_INSET_SHARE);
    expect(image.props.style?.["width"]).toBe(side);
    expect(image.props.style?.["height"]).toBe(side);
    expect(image.props.src).toBe(PNG_MARK);
    expect(plate.element.props.style?.["alignItems"]).toBe("center");
    expect(plate.element.props.style?.["justifyContent"]).toBe("center");
  });
});

describe("lockup and plate-only", () => {
  it("renders the wordmark once at the ratio size and gap beside the plate", () => {
    const card = buildBrandShareCard(input());
    const nodes = wordmarkNodes(card.element, "Example Studio");
    expect(nodes).toHaveLength(1);
    const style = nodes[0]!.element.props.style ?? {};
    expect(style["fontSize"]).toBe(96 * LOCKUP_WORDMARK_SIZE_RATIO);
    expect(style["marginLeft"]).toBe(96 * LOCKUP_GAP_RATIO);
    expect(collect(card.element, ({ element }) => element.type === "img")).toHaveLength(1);
  });

  it("renders the plate alone, with no wordmark node, when wordmark is omitted", () => {
    const { wordmark: _omitted, ...rest } = input();
    const card = buildBrandShareCard(rest);
    expect(wordmarkNodes(card.element, "Example Studio")).toHaveLength(0);
    expect(plateOf(card.element)).toBeDefined();
    expect(collect(card.element, ({ element }) => element.type === "img")).toHaveLength(1);
    expect(renderToStaticMarkup(card.element)).not.toContain("Example Studio</");
    expect(renderToStaticMarkup(card.element)).toContain("Small tools");
  });

  it("puts the kicker after a 2px rule in its own colour", () => {
    const card = buildBrandShareCard(input());
    const flat = buildFlatTokenMap();
    const kickerColour = flat.get(BRAND_SHARE_CARD_DEFAULT_ROLES.kicker);
    const rules = collect(card.element, ({ element }) => element.props.style?.["width"] === 2);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.element.props.style?.["backgroundColor"]).toBe(kickerColour);
    const kickers = wordmarkNodes(card.element, "Small tools");
    expect(kickers).toHaveLength(1);
    expect(kickers[0]!.element.props.style?.["color"]).toBe(kickerColour);
  });

  it("omits the kicker and its rule when kicker is omitted, and omits supporting likewise", () => {
    const { kicker: _k, supporting: _s, ...rest } = input();
    const card = buildBrandShareCard(rest);
    expect(collect(card.element, ({ element }) => element.props.style?.["width"] === 2)).toHaveLength(0);
    expect(renderToStaticMarkup(card.element)).not.toContain("A fictional studio");
    expect(renderToStaticMarkup(card.element)).toContain("Made well, made to last");
  });

  it("applies displayFontFamily to the wordmark and headline only", () => {
    const card = buildBrandShareCard(input({ displayFontFamily: "Example Display-2" }));
    const withFamily = collect(card.element, ({ element }) => element.props.style?.["fontFamily"] !== undefined);
    expect(withFamily.map((w) => textOf(w.element.props.children)).sort()).toEqual(["Example Studio", "Made well, made to last"]);
    for (const w of withFamily) expect(w.element.props.style?.["fontFamily"]).toBe("Example Display-2");
    const plain = buildBrandShareCard(input());
    expect(collect(plain.element, ({ element }) => element.props.style?.["fontFamily"] !== undefined)).toHaveLength(0);
  });
});

describe("colours and structure", () => {
  it("uses only resolved role colours, never a literal, class name or CSS variable", () => {
    const flat = buildFlatTokenMap();
    const allowed = new Set(Object.values(BRAND_SHARE_CARD_DEFAULT_ROLES).map((role) => flat.get(role)));
    const card = buildBrandShareCard(input());
    const colours = collectColours(card.element);
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) {
      expect(colour).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
      expect(allowed.has(colour)).toBe(true);
    }
    expect(collect(card.element, ({ element }) => element.props.className !== undefined)).toHaveLength(0);
    expect(renderToStaticMarkup(card.element)).not.toContain("var(");
    expect(renderToStaticMarkup(card.element)).not.toContain("class=");
  });

  it("is 1200 by 630 with display flex on every element that has more than one child", () => {
    const card = buildBrandShareCard(input());
    const root = card.element as ReactElement<{ style: Record<string, unknown> }>;
    expect(root.props.style["width"]).toBe(OG_SHARE_CARD_SPEC.widthPx);
    expect(root.props.style["height"]).toBe(OG_SHARE_CARD_SPEC.heightPx);
    expect(card.width).toBe(1200);
    expect(card.height).toBe(630);
    expect(card.contentType).toBe("image/png");
    walk(card.element, ({ element, childCount }) => {
      if (childCount > 1) expect(element.props.style?.["display"]).toBe("flex");
    });
  });

  it("follows role overrides and brand token overrides", () => {
    const flat = buildFlatTokenMap();
    const colours = collectColours(buildBrandShareCard(input({ roles: { background: "--color-surface-inverse" } })).element);
    expect(colours).toContain(flat.get("--color-surface-inverse"));
    const before = collectColours(buildBrandShareCard(input()).element);
    const after = collectColours(buildBrandShareCard(input({ tokenOverrides: { "--color-surface-base": "oklch(0.3 0.1 250)" } })).element);
    expect(after).not.toEqual(before);
  });

  it("is deterministic and hands buildSiteMetadata an accepted shareCard", () => {
    expect(renderToStaticMarkup(buildBrandShareCard(input()).element)).toBe(renderToStaticMarkup(buildBrandShareCard(input()).element));
    const card = buildBrandShareCard(input({ path: "/share/brand" }));
    expect(card.shareCard).toEqual({ url: "/share/brand", alt: "Example Studio share card", width: 1200, height: 630 });
    const meta = buildSiteMetadata({
      site: { name: "Example Studio", tagline: "Small tools, well made", origin: "https://example.com", themeColor: "#112233", locale: "en_US", shareCard: card.shareCard },
      page: { kind: "home", label: "Home", description: "A description.", path: "/" },
    });
    expect(meta.openGraph.image.url).toBe("https://example.com/share/brand");
    expect(buildBrandShareCard(input()).shareCard.url).toBe("/opengraph-image");
  });

  it("emits text verbatim", () => {
    const markup = renderToStaticMarkup(buildBrandShareCard(input({ headline: "A &amp; B  two" })).element);
    expect(markup).toContain("A &amp;amp; B  two");
  });
});

function childrenOf(element: ReactElement<Props>): ReactElement<Props>[] {
  const children = element.props.children;
  const list = Array.isArray(children) ? children : children === undefined ? [] : [children];
  return list.filter((child) => isValidElement(child)) as ReactElement<Props>[];
}

function byKey(root: ReactElement<Props>, key: string): ReactElement<Props> {
  const found = collect(root, ({ element }) => element.key === key);
  expect(found).toHaveLength(1);
  return found[0]!.element;
}

describe("lockup order", () => {
  it("puts the plate then the wordmark in the lockup, and the plate alone without a wordmark", () => {
    const card = buildBrandShareCard(input());
    const lockup = byKey(card.element as ReactElement<Props>, "lockup");
    expect(childrenOf(lockup).map((child) => child.key)).toEqual(["plate", "wordmark"]);

    const { wordmark: _omitted, ...rest } = input();
    const plain = buildBrandShareCard(rest);
    expect(childrenOf(byKey(plain.element as ReactElement<Props>, "lockup")).map((child) => child.key)).toEqual(["plate"]);
  });
});

describe("top row order", () => {
  it("puts the lockup, the rule, then the kicker in the top row", () => {
    const card = buildBrandShareCard(input());
    const top = byKey(card.element as ReactElement<Props>, "top");
    expect(childrenOf(top).map((child) => child.key)).toEqual(["lockup", "rule", "kicker"]);
  });
});

describe("headline at the bottom", () => {
  it("spaces the root between the top row and a bottom block that starts with the headline", () => {
    const root = buildBrandShareCard(input()).element as ReactElement<Props>;
    expect(root.props.style?.["justifyContent"]).toBe("space-between");
    const rootChildren = childrenOf(root);
    const bottom = rootChildren[rootChildren.length - 1]!;
    expect(bottom.key).toBe("bottom");
    expect(childrenOf(bottom)[0]!.key).toBe("headline");
  });
});

describe("overflow guards", () => {
  it("keeps the plate and rule from shrinking and the mark in ratio", () => {
    const root = buildBrandShareCard(input()).element as ReactElement<Props>;
    expect(byKey(root, "plate").props.style?.["flexShrink"]).toBe(0);
    expect(byKey(root, "rule").props.style?.["flexShrink"]).toBe(0);
    const images = collect(root, ({ element }) => element.type === "img");
    expect(images).toHaveLength(1);
    expect(images[0]!.element.props.style?.["objectFit"]).toBe("contain");
  });

  it("lets the lockup shrink and truncates the wordmark and kicker to one line", () => {
    const root = buildBrandShareCard(input()).element as ReactElement<Props>;
    const lockup = byKey(root, "lockup").props.style ?? {};
    expect(lockup["minWidth"]).toBe(0);
    expect(lockup["maxWidth"]).toBe("100%");
    expect(lockup["flexShrink"]).toBe(1);
    expect(byKey(root, "wordmark").props.style?.["flexShrink"]).toBe(1);
    for (const key of ["wordmark", "kicker"]) {
      const style = byKey(root, key).props.style ?? {};
      expect(style["minWidth"]).toBe(0);
      expect(style["overflow"]).toBe("hidden");
      expect(style["whiteSpace"]).toBe("nowrap");
      expect(style["textOverflow"]).toBe("ellipsis");
    }
    expect(byKey(root, "kicker").props.style?.["flex"]).toBe(1);
  });

  it("clamps the headline and supporting line to two lines on block elements, the only display the renderer clamps", () => {
    const root = buildBrandShareCard(input()).element as ReactElement<Props>;
    for (const key of ["headline", "supporting"]) {
      const style = byKey(root, key).props.style ?? {};
      expect(style["display"]).toBe("block");
      expect(style["lineClamp"]).toBe(2);
      expect(style["overflow"]).toBe("hidden");
    }
  });
});

describe("field-neutral message", () => {
  it("does not name buildShareCard or tagline when a blank kicker is refused", () => {
    let message = "";
    try {
      buildBrandShareCard(input({ kicker: "   " }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("buildShareCard");
    expect(message).not.toContain("tagline");
  });
});

describe("refusals and exports", () => {
  it("refuses a markSrc that is not an inline image data URL", () => {
    for (const markSrc of ["https://example.com/mark.png", "//example.com/mark.png", "/mark.png", "javascript:alert(1)", "data:text/html;base64,AAAA", ""]) {
      expect(reasonOf(() => buildBrandShareCard(input({ markSrc })))).toBe("invalid-mark-source");
    }
    expect(reasonOf(() => buildBrandShareCard(input({ markSrc: 3 as unknown as string })))).toBe("invalid-mark-source");
  });

  it("refuses blank, padded and control-character text with the buildShareCard reasons", () => {
    expect(reasonOf(() => buildBrandShareCard(input({ kicker: "" })))).toBe("blank-text");
    expect(reasonOf(() => buildBrandShareCard(input({ kicker: "   " })))).toBe("blank-text");
    expect(reasonOf(() => buildBrandShareCard(input({ headline: "" })))).toBe("blank-text");
    expect(reasonOf(() => buildBrandShareCard(input({ wordmark: " Studio" })))).toBe("surrounding-whitespace");
    expect(reasonOf(() => buildBrandShareCard(input({ supporting: "a\nb" })))).toBe("control-character");
    expect(reasonOf(() => buildBrandShareCard(input({ alt: "" })))).toBe("blank-text");
    expect(reasonOf(() => buildBrandShareCard(input({ headline: 4 as unknown as string })))).toBe("invalid-input");
  });

  describe("derived alt", () => {
    function derived(overrides: Partial<BrandShareCardInput>): string {
      const { alt: _alt, ...rest } = input(overrides);
      return buildBrandShareCard(rest).shareCard.alt;
    }

    it("reads the visible text in order when alt is omitted", () => {
      expect(derived({ kicker: undefined, supporting: undefined, headline: "Sign in" })).toBe("Example Studio. Sign in");
      expect(derived({ kicker: undefined, headline: "Sign in", supporting: "Staff only" })).toBe("Example Studio. Sign in. Staff only");
      expect(derived({})).toBe("Example Studio. Small tools. Made well, made to last. A fictional studio for tests.");
    });

    it("does not double terminal punctuation", () => {
      expect(derived({ kicker: undefined, headline: "Ready?", supporting: "Staff only" })).toBe("Example Studio. Ready? Staff only");
      expect(derived({ kicker: undefined, headline: "Sign in!", supporting: "Staff only" })).toBe("Example Studio. Sign in! Staff only");
      expect(derived({ wordmark: "Example Studio.", kicker: "Note:", headline: "Sign in", supporting: undefined })).toBe("Example Studio. Note: Sign in");
    });

    it("is the headline alone without a wordmark, kicker or supporting line", () => {
      expect(derived({ wordmark: undefined, kicker: undefined, supporting: undefined, headline: "Sign in" })).toBe("Sign in");
    });
  });

  describe("explicit alt wins", () => {
    it("returns a supplied alt verbatim", () => {
      expect(buildBrandShareCard(input({ alt: "Custom" })).shareCard.alt).toBe("Custom");
    });

    it("still refuses an explicit empty or non-string alt", () => {
      expect(reasonOf(() => buildBrandShareCard(input({ alt: "" })))).toBe("blank-text");
      expect(reasonOf(() => buildBrandShareCard(input({ alt: 4 as unknown as string })))).toBe("invalid-input");
    });
  });

  it("refuses a displayFontFamily outside letters, digits, spaces and hyphens", () => {
    for (const displayFontFamily of ["Example;Display", "Example, serif", "Example\"", "url(x)", "", 3 as unknown as string]) {
      expect(reasonOf(() => buildBrandShareCard(input({ displayFontFamily })))).toBe("invalid-input");
    }
  });

  it("refuses a bad path, role, override and non-object input with existing reasons", () => {
    expect(reasonOf(() => buildBrandShareCard(input({ path: "//evil.example" })))).toBe("invalid-path");
    expect(reasonOf(() => buildBrandShareCard(input({ roles: { plate: "red" } })))).toBe("unresolvable-role");
    expect(reasonOf(() => buildBrandShareCard(input({ roles: { headline: "--color-does-not-exist" } })))).toBe("unresolvable-role");
    expect(reasonOf(() => buildBrandShareCard(input({ tokenOverrides: { "--not-a-token": "#000000" } })))).toBe("invalid-token-override");
    expect(reasonOf(() => buildBrandShareCard(null as unknown as BrandShareCardInput))).toBe("invalid-input");
  });

  it("exports the same builder, roles and plate size from web and web/server", () => {
    expect(webIndex.buildBrandShareCard).toBe(buildBrandShareCard);
    expect(webServer.buildBrandShareCard).toBe(buildBrandShareCard);
    expect(webIndex.BRAND_SHARE_CARD_DEFAULT_ROLES).toBe(BRAND_SHARE_CARD_DEFAULT_ROLES);
    expect(webServer.BRAND_SHARE_CARD_DEFAULT_ROLES).toBe(BRAND_SHARE_CARD_DEFAULT_ROLES);
    expect(webIndex.BRAND_SHARE_CARD_PLATE_PX).toBe(96);
    expect(webServer.BRAND_SHARE_CARD_PLATE_PX).toBe(96);
  });
});
