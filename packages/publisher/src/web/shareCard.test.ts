import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildFlatTokenMap } from "../image/engine.js";
import { OG_SHARE_CARD_SPEC } from "../templates/channelSpecs.js";
import * as webIndex from "./index.js";
import * as webServer from "./server.js";
import { SHARE_CARD_DEFAULT_ROLES, ShareCardError, buildShareCard, type ShareCardErrorReason, type ShareCardInput } from "./shareCard.js";
import { buildSiteMetadata } from "./siteMetadata.js";

const PNG_MARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==";
const SVG_MARK = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%224%22%20height%3D%224%22%2F%3E";

function input(overrides: Partial<ShareCardInput> = {}): ShareCardInput {
  return { name: "Example Studio", tagline: "Small tools, well made", alt: "Example Studio share card", ...overrides };
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

interface Walked {
  element: ReactElement<{ style?: Record<string, unknown>; children?: ReactNode; className?: unknown }>;
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

describe("buildShareCard size and hand-off", () => {
  it("returns the OG_SHARE_CARD_SPEC size on the root and on width and height", () => {
    const card = buildShareCard(input());
    const root = card.element as ReactElement<{ style: Record<string, unknown> }>;
    expect(root.props.style["width"]).toBe(OG_SHARE_CARD_SPEC.widthPx);
    expect(root.props.style["height"]).toBe(OG_SHARE_CARD_SPEC.heightPx);
    expect(card.width).toBe(OG_SHARE_CARD_SPEC.widthPx);
    expect(card.height).toBe(OG_SHARE_CARD_SPEC.heightPx);
    expect(card.contentType).toBe("image/png");
  });

  it("returns a shareCard that buildSiteMetadata accepts, on the default and a custom route", () => {
    for (const path of [undefined, "/share/card"]) {
      const card = buildShareCard(input(path === undefined ? {} : { path }));
      expect(card.shareCard).toEqual({
        url: path ?? "/opengraph-image",
        alt: "Example Studio share card",
        width: OG_SHARE_CARD_SPEC.widthPx,
        height: OG_SHARE_CARD_SPEC.heightPx,
      });
      const meta = buildSiteMetadata({
        site: { name: "Example Studio", tagline: "Small tools, well made", origin: "https://example.com", themeColor: "#112233", locale: "en_US", shareCard: card.shareCard },
        page: { kind: "home", label: "Home", description: "A description.", path: "/" },
      });
      expect(meta.openGraph.image.url).toBe(`https://example.com${card.shareCard.url}`);
      expect(meta.openGraph.image.width).toBe(OG_SHARE_CARD_SPEC.widthPx);
    }
  });

  it("is exported from ./web and ./web/server", () => {
    expect(webIndex.buildShareCard).toBe(buildShareCard);
    expect(webServer.buildShareCard).toBe(buildShareCard);
    expect(webIndex.ShareCardError).toBe(ShareCardError);
    expect(webServer.ShareCardError).toBe(ShareCardError);
  });
});

describe("buildShareCard colours", () => {
  it("uses only resolved role-token values", () => {
    const flat = buildFlatTokenMap();
    const allowed = new Set(Object.values(SHARE_CARD_DEFAULT_ROLES).map((role) => flat.get(role)));
    const colours = collectColours(buildShareCard(input({ mark: { src: PNG_MARK, width: 96, height: 96 } })).element);
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) {
      expect(colour).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
      expect(allowed.has(colour)).toBe(true);
    }
  });

  it("changes when a brand override changes a role", () => {
    const before = collectColours(buildShareCard(input()).element);
    const after = collectColours(
      buildShareCard(input({ tokenOverrides: { "--color-surface-base": "oklch(0.3 0.1 250)" } })).element,
    );
    const flat = buildFlatTokenMap({ "--color-surface-base": "oklch(0.3 0.1 250)" });
    expect(after).not.toEqual(before);
    expect(after).toContain(flat.get("--color-surface-base"));
  });

  it("lets the caller pick other roles", () => {
    const flat = buildFlatTokenMap();
    const colours = collectColours(buildShareCard(input({ roles: { background: "--color-surface-inverse" } })).element);
    expect(colours).toContain(flat.get("--color-surface-inverse"));
  });

  it("throws unresolvable-role for a role that is unknown, not a colour, or malformed", () => {
    expect(reasonOf(() => buildShareCard(input({ roles: { background: "--color-does-not-exist" } })))).toBe("unresolvable-role");
    expect(reasonOf(() => buildShareCard(input({ roles: { name: "--text-base" } })))).toBe("unresolvable-role");
    expect(reasonOf(() => buildShareCard(input({ roles: { tagline: "red" } })))).toBe("unresolvable-role");
    expect(reasonOf(() => buildShareCard(input({ roles: { accent: "--color-accent)" } })))).toBe("unresolvable-role");
    expect(reasonOf(() => buildShareCard(input({ tokenOverrides: { "--color-surface-base": "not-a-colour" } })))).toBe("unresolvable-role");
  });

  it("throws invalid-token-override for an override the token registry refuses", () => {
    expect(reasonOf(() => buildShareCard(input({ tokenOverrides: { "--color-no-such-token": "#ffffff" } })))).toBe("invalid-token-override");
    expect(reasonOf(() => buildShareCard(input({ tokenOverrides: { "--color-surface-base": 3 as unknown as string } })))).toBe("invalid-input");
  });
});

describe("buildShareCard text", () => {
  it("emits name and tagline verbatim", () => {
    const name = "Ünï & <Co> \"Q\"";
    const tagline = "Made · well";
    const html = renderToStaticMarkup(buildShareCard(input({ name, tagline })).element);
    expect(html).toContain("Ünï &amp; &lt;Co&gt; &quot;Q&quot;");
    expect(html).toContain("Made · well");
  });

  it.each([
    ["blank name", { name: "" }, "blank-text"],
    ["whitespace-only tagline", { tagline: "   " }, "blank-text"],
    ["blank alt", { alt: "" }, "blank-text"],
    ["leading space", { name: " Example" }, "surrounding-whitespace"],
    ["trailing no-break space", { tagline: "Example " }, "surrounding-whitespace"],
    ["control character inside", { name: "Exa\u0007mple" }, "control-character"],
    ["line break inside", { tagline: "one\ntwo" }, "control-character"],
    ["non-string name", { name: 4 as unknown as string }, "invalid-input"],
  ] as const)("throws %s", (_label, override, reason) => {
    expect(reasonOf(() => buildShareCard(input(override)))).toBe(reason);
  });

  it("never echoes input in the error message", () => {
    let message = "";
    try {
      buildShareCard(input({ name: "Sensitive Name\u0007" }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("Sensitive");
  });

  it.each([
    ["no leading slash", "share"],
    ["protocol-relative", "//evil.example/x"],
    ["query", "/x?y=1"],
    ["dot segment", "/a/../b"],
    ["non-normal form", "/café"],
    ["absolute url", "https://example.com/x"],
  ])("throws invalid-path for %s", (_label, path) => {
    expect(reasonOf(() => buildShareCard(input({ path })))).toBe("invalid-path");
  });
});

describe("buildShareCard mark", () => {
  it("renders an accepted png or svg data url with its size", () => {
    for (const src of [PNG_MARK, SVG_MARK]) {
      const html = renderToStaticMarkup(buildShareCard(input({ mark: { src, width: 96, height: 64 } })).element);
      expect(html).toContain(`src="${src.replace(/&/g, "&amp;")}"`);
      expect(html).toContain('width="96"');
      expect(html).toContain('height="64"');
    }
  });

  it.each([
    ["remote https", "https://example.com/mark.png"],
    ["protocol-relative", "//example.com/mark.png"],
    ["javascript", "javascript:alert(1)"],
    ["relative path", "/mark.png"],
    ["other data type", "data:text/html;base64,PGgxPmhpPC9oMT4="],
    ["jpeg data", "data:image/jpeg;base64,AAAA"],
    ["png without base64", "data:image/png,abc"],
    ["png with bad base64", "data:image/png;base64,@@@@"],
    ["empty payload", "data:image/svg+xml,"],
    ["raw markup in svg payload", "data:image/svg+xml,<svg onload=alert(1)>"],
    ["quote in svg payload", 'data:image/svg+xml,%3Csvg%3E" onerror="x'],
    ["non-string", 5 as unknown as string],
  ])("throws invalid-mark-source for %s", (_label, src) => {
    expect(reasonOf(() => buildShareCard(input({ mark: { src, width: 96, height: 96 } })))).toBe("invalid-mark-source");
  });

  it.each([
    ["fractional width", { width: 96.5, height: 96 }],
    ["fractional height", { width: 96, height: 10.1 }],
    ["zero", { width: 0, height: 96 }],
    ["negative", { width: 96, height: -1 }],
    ["NaN", { width: Number.NaN, height: 96 }],
    ["string", { width: "96" as unknown as number, height: 96 }],
    ["larger than the card", { width: 96, height: OG_SHARE_CARD_SPEC.heightPx + 1 }],
  ])("throws invalid-mark-size for %s", (_label, size) => {
    expect(reasonOf(() => buildShareCard(input({ mark: { src: PNG_MARK, ...size } })))).toBe("invalid-mark-size");
  });

  it("throws invalid-input for a non-object mark", () => {
    expect(reasonOf(() => buildShareCard(input({ mark: "x" as unknown as ShareCardInput["mark"] })))).toBe("invalid-input");
  });
});

describe("buildShareCard structure", () => {
  it("uses inline styles only, with display flex wherever there is more than one child", () => {
    for (const mark of [undefined, { src: PNG_MARK, width: 96, height: 96 }]) {
      const { element } = buildShareCard(input(mark === undefined ? {} : { mark }));
      let visited = 0;
      let multiChild = 0;
      walk(element, ({ element: el, childCount }) => {
        visited += 1;
        expect(el.props.className).toBeUndefined();
        expect(Object.keys(el.props)).not.toContain("class");
        const style = el.props.style;
        if (style !== undefined) {
          for (const value of Object.values(style)) expect(String(value)).not.toContain("var(");
        }
        if (childCount > 1) {
          multiChild += 1;
          expect(style?.["display"]).toBe("flex");
        }
      });
      expect(visited).toBeGreaterThan(2);
      expect(multiChild).toBeGreaterThan(0);
      expect(renderToStaticMarkup(element)).not.toMatch(/var\(|class=|<link|<script|url\(/);
    }
  });

  it("renders identical markup across two calls, and does not mutate its input", () => {
    const value = input({ mark: { src: SVG_MARK, width: 64, height: 64 }, tokenOverrides: { "--color-accent": "oklch(0.5 0.15 30)" } });
    const snapshot = JSON.stringify(value);
    const first = renderToStaticMarkup(buildShareCard(value).element);
    const second = renderToStaticMarkup(buildShareCard(value).element);
    expect(first).toBe(second);
    expect(JSON.stringify(value)).toBe(snapshot);
  });

  it("refuses a non-object input", () => {
    expect(reasonOf(() => buildShareCard(null as unknown as ShareCardInput))).toBe("invalid-input");
    expect(reasonOf(() => buildShareCard([] as unknown as ShareCardInput))).toBe("invalid-input");
  });
});
