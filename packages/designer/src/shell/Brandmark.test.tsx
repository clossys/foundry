import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ComponentType, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { scanStyleSources } from "../style-scan.js";
import { checkTokenPurity } from "../token-gate.js";
import { TOKENS } from "../tokens/tokens.js";
import { LOCKUP_GAP_RATIO, LOCKUP_WORDMARK_SIZE_RATIO } from "../tokens/identity-kit.js";
import { Brandmark, BRANDMARK_SIZES, BRANDMARK_VARIANTS, type BrandmarkSize, type BrandmarkVariant } from "./Brandmark.js";
import type { BrandmarkProps } from "./Brandmark.js";
import { BADGE_INSET_SHARE, BADGE_RADIUS_SHARE, badgePlatePath } from "./badge-plate.js";
import { BRANDMARK_WORDMARK_SIZE_RATIO } from "./internal/shell-vars.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "..");
const brandmarkSource = readFileSync(join(here, "Brandmark.tsx"), "utf8");
const badgePlateSource = readFileSync(join(here, "badge-plate.ts"), "utf8");
const shellVarsSource = readFileSync(join(here, "..", "internal", "brandmark.ts"), "utf8");
const logomarkSource = readFileSync(join(here, "..", "atoms", "Logomark.tsx"), "utf8");
const tokensCss = readFileSync(join(packageRoot, "styles", "tokens.css"), "utf8");

const brandmarkConstantStatements = shellVarsSource.match(/export const (?:UI_)?BRANDMARK_\w+\s*=[^;]+;/g) ?? [];

const MARK_SRC = "/assets/mark.svg";
const WORDMARK = "Wordmark text";
// Contains the visible wordmark text, as a lockup's label must (WCAG 2.5.3).
const LABEL = `${WORDMARK}, consumer-supplied accessible name`;

const HEIGHT_PX: Record<BrandmarkSize, number> = { sm: 24, md: 36, lg: 48 };
// The identity kit's lockup gap ratio: gap = height x 8/48.
const GAP_RATIO = 8 / 48;
const GAP_PX: Record<BrandmarkSize, number> = { sm: 4, md: 6, lg: 8 };

function props(variant: BrandmarkVariant, size: BrandmarkSize): BrandmarkProps {
  return variant === "lockup"
    ? { variant, size, label: LABEL, markSrc: MARK_SRC, wordmark: WORDMARK }
    : { variant, size, label: LABEL, markSrc: MARK_SRC };
}

const COMBOS: Array<[BrandmarkVariant, BrandmarkSize]> = BRANDMARK_VARIANTS.flatMap((variant) =>
  BRANDMARK_SIZES.map((size): [BrandmarkVariant, BrandmarkSize] => [variant, size]),
);

// Generic synthetic identity fixtures: the rectangle is the complete painted
// artwork, deliberately padded differently in each supplied SVG viewport.
// These are geometry cases, never assets copied from a consumer.
const PRESENTATION_MARKS = [
  { name: "square", box: [48, 48], art: [12, 12, 24, 24] },
  { name: "wide", box: [100, 60], art: [20, 20, 60, 20] },
  { name: "tall", box: [60, 100], art: [20, 20, 20, 60] },
  { name: "offset", box: [80, 80], art: [5, 10, 40, 30] },
  { name: "padded", box: [200, 200], art: [90, 85, 20, 30] },
] as const;
const PresentationBrandmark = Brandmark as unknown as ComponentType<BrandmarkProps & {
  presentation: "desktop" | "mobile" | "responsive";
}>;

function fixtureUrl(mark: (typeof PRESENTATION_MARKS)[number]): string {
  const [x, y, width, height] = mark.art;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mark.box[0]} ${mark.box[1]}"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></svg>`)}`;
}

function fixtureGeometry(mark: (typeof PRESENTATION_MARKS)[number]) {
  return { viewBox: { x: 0, y: 0, width: mark.box[0], height: mark.box[1] },
    paintedBounds: { x: mark.art[0], y: mark.art[1], width: mark.art[2], height: mark.art[3] } };
}

describe("Brandmark: REV4 presentation contract regressions", () => {
  it.each(PRESENTATION_MARKS)("owns desktop glyph sizing and normalizes the padded $name source", mark => {
    const { container } = render(<PresentationBrandmark {...props("lockup", "sm")} markSrc={fixtureUrl(mark)} geometry={fixtureGeometry(mark)} presentation="desktop" />);
    const image = container.querySelector("img")!;
    // These are component-contract checks. The independent Chromium pixel
    // matrix measures the resulting painted rectangle, including SVG padding;
    // neither this declaration nor a larger wrapper is painted-art evidence.
    expect(image.parentElement!.style.height).toBe("var(--ui-brandmark-height-lg, 48px)");
    expect(image.getAttribute("src")).toBe(fixtureUrl(mark));
    expect(image.parentElement!.style.overflow).toBe("hidden");
    expect(image.style.height).toBe(`calc(var(--ui-brandmark-height-lg, 48px) * ${mark.box[1] / mark.art[3]})`);
    expect(image.style.width).toBe(`calc(var(--ui-brandmark-height-lg, 48px) * ${mark.box[0] / mark.art[3]})`);
  });

  it.each(PRESENTATION_MARKS)("uses a normalized accent silhouette at mobile control height for $name", mark => {
    const { container } = render(<PresentationBrandmark {...props("lockup", "sm")} markSrc={fixtureUrl(mark)} geometry={fixtureGeometry(mark)} presentation="mobile" />);
    const link = container.querySelector("a")!;
    const painted = link.querySelector(".bg-accent");
    expect(painted).not.toBeNull();
    expect(painted).toHaveClass("bg-accent");
    expect((painted!.parentElement as HTMLElement).style.height).toBe("var(--ui-layout-tap-target, 44px)");
    expect(link.textContent).toBe("");
    expect((painted as HTMLElement).style.maskSize).toBe("100% 100%");
    expect((painted as HTMLElement).style.height).toBe(`calc(var(--ui-layout-tap-target, 44px) * ${mark.box[1] / mark.art[3]})`);
  });

  it("uses one named responsive link with separate desktop and mobile presentations", () => {
    const { container } = render(<PresentationBrandmark {...props("lockup", "sm")} markSrc={fixtureUrl(PRESENTATION_MARKS[0])} geometry={fixtureGeometry(PRESENTATION_MARKS[0])} presentation="responsive" />);
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(screen.getByRole("link", { name: LABEL })).toHaveAttribute("href", "/");
    expect(container.querySelector(".desktop\\:block")).not.toBeNull();
    expect(container.querySelector(".desktop\\:hidden")).not.toBeNull();
  });

  it.each(["geometry", "presentation"] as const)("retains exact legacy SSR when %s is omitted", omitted => {
    const legacy = props("lockup", "sm");
    const addition = omitted === "geometry" ? { presentation: "desktop" as const }
      : { geometry: fixtureGeometry(PRESENTATION_MARKS[0]) };
    expect(renderToStaticMarkup(<Brandmark {...legacy} {...addition} />)).toBe(renderToStaticMarkup(<Brandmark {...legacy} />));
  });
});

describe("Brandmark: the closed sets", () => {
  it("are exactly the specified variants and sizes (6 combinations)", () => {
    expect([...BRANDMARK_VARIANTS]).toEqual(["mark", "lockup"]);
    expect([...BRANDMARK_SIZES]).toEqual(["sm", "md", "lg"]);
    expect(COMBOS).toHaveLength(6);
  });
});

describe("Brandmark: accessible name, href, and mark image", () => {
  it.each(COMBOS)("%s / %s: the link is named by `label`, points at '/', and carries a decorative mark", (variant, size) => {
    render(<Brandmark {...props(variant, size)} />);
    const link = screen.getByRole("link", { name: LABEL });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveAttribute("aria-label", LABEL);

    const img = link.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("src", MARK_SRC);
    expect(img?.style.height).toContain(`--ui-brandmark-height-${size}`);
    expect(img?.style.width).toBe("auto");
  });

  it.each(BRANDMARK_SIZES)("lockup / %s renders the wordmark as live text and does not change the link's name", (size) => {
    render(<Brandmark {...props("lockup", size)} />);
    const link = screen.getByRole("link", { name: LABEL });
    const text = screen.getByText(WORDMARK);
    expect(text.tagName).toBe("SPAN");
    expect(link).toContainElement(text);
    expect(text).not.toHaveAttribute("aria-hidden");
    expect(text.className).toContain("font-display");
    expect(text.style.fontSize).toContain(`--ui-brandmark-height-${size}`);
    expect(link.style.gap).toContain(`--ui-brandmark-gap-${size}`);
  });

  it.each(BRANDMARK_SIZES)("mark / %s renders no wordmark text", (size) => {
    render(<Brandmark {...props("mark", size)} />);
    const link = screen.getByRole("link", { name: LABEL });
    expect(link.textContent).toBe("");
    expect(link.querySelectorAll("span")).toHaveLength(0);
  });

  it("fails closed at runtime: a lockup with an empty or missing wordmark renders the mark only", () => {
    const missing = { variant: "lockup", size: "md", label: LABEL, markSrc: MARK_SRC } as unknown as BrandmarkProps;
    const { unmount } = render(<Brandmark {...missing} />);
    expect(screen.getByRole("link", { name: LABEL }).querySelectorAll("span")).toHaveLength(0);
    expect(screen.getByRole("link", { name: LABEL }).querySelectorAll("img")).toHaveLength(1);
    unmount();
    render(<Brandmark {...props("lockup", "md")} wordmark="" />);
    expect(screen.getByRole("link", { name: LABEL }).querySelectorAll("span")).toHaveLength(0);
  });

  it.each(["   ", "\t", "\n", " \t\n \r\n "])(
    "treats a whitespace-only wordmark (%j) as absent: mark only, no wordmark span, no gap",
    (wordmark) => {
      render(<Brandmark {...props("lockup", "md")} wordmark={wordmark} />);
      const link = screen.getByRole("link", { name: LABEL });
      expect(link.querySelectorAll("span")).toHaveLength(0);
      expect(link.querySelectorAll("img")).toHaveLength(1);
      expect(link.textContent).toBe("");
      expect(link.style.gap).toBe("");
    },
  );

  it.each(["   ", "\t\n"])(
    "a whitespace-only wordmark (%j) needs no wordmark in the label, and a blank label still throws",
    (wordmark) => {
      render(<Brandmark {...props("lockup", "md")} label="Home" wordmark={wordmark} />);
      expect(screen.getByRole("link", { name: "Home" }).querySelectorAll("span")).toHaveLength(0);
      expect(() => render(<Brandmark {...props("lockup", "md")} label="  " wordmark={wordmark} />)).toThrow(/label/);
    },
  );

  it("does not weaken the label check: a padded but non-blank wordmark is still compared against the label", () => {
    expect(() => render(<Brandmark {...props("lockup", "md")} label="Home" wordmark="  Northwind  " />)).toThrow(/label-in-name|label in name|wordmark/);
  });

  it("accepts a className, applied to the link", () => {
    render(<Brandmark {...props("mark", "sm")} className="consumer-class" />);
    expect(screen.getByRole("link", { name: LABEL })).toHaveClass("consumer-class");
  });
});

describe("Brandmark: href and aria-label are not overridable", () => {
  // The compile-time half (an `href` / `aria-label` prop is a type error)
  // lives in `internal/brandmark-contract.check.tsx` — a `@ts-expect-error`
  // written in a test file is inert (see that file's header). This is the
  // runtime half: force both past the type system and confirm neither lands.
  it("ignores an `href` and an `aria-label` forced past the type system", () => {
    const forced = { ...props("lockup", "md"), href: "/elsewhere", "aria-label": "Overridden" } as unknown as BrandmarkProps;
    render(<Brandmark {...forced} />);
    const link = screen.getByRole("link", { name: LABEL });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveAttribute("aria-label", LABEL);
    expect(screen.queryByRole("link", { name: "Overridden" })).toBeNull();
  });
});

describe("Brandmark: optional public origin", () => {
  it.each([
    [undefined, "/"],
    ["https://example.com", "https://example.com/"],
    ["HTTPS://EXAMPLE.com/", "https://example.com/"],
    ["https://example.com:8443", "https://example.com:8443/"],
    ["http://localhost:3000", "http://localhost:3000/"],
    ["http://127.0.0.1:8080/", "http://127.0.0.1:8080/"],
    ["http://[::1]:4000", "http://[::1]:4000/"],
  ])("origin %j links to %s", (origin, href) => {
    render(<Brandmark {...props("lockup", "md")} origin={origin} />);
    expect(screen.getByRole("link", { name: LABEL })).toHaveAttribute("href", href);
  });

  it.each([
    "javascript:alert(1)", "/path", "//example.com", "https:example.com",
    "https://example.com/path", "https://example.com/.", "https://example.com?x=1",
    "https://example.com#section", "https://user@example.com", "https://@www.example.test/",
    "http://example.com", "http://localhost.example.com", "ftp://example.com",
    " https://example.com", "https://example.com\n", "https:\\\\example.com", "", null, 42,
  ])("refuses malformed origin %j without echoing it", origin => {
    const forced = { ...props("mark", "md"), origin } as unknown as BrandmarkProps;
    expect(() => renderToStaticMarkup(<Brandmark {...forced} />)).toThrow(/Brandmark:.*origin/);
    expect(() => renderToStaticMarkup(<Brandmark {...forced} />)).not.toThrow(/example\.com|alert|path|user@/);
  });
});

describe("Brandmark: validated origin across every home-link slot", () => {
  it.each([
    ["accent", { ...props("lockup", "md"), markInk: "accent" }],
    ["explicit presentation", { ...props("lockup", "md"), presentation: "responsive", geometry: fixtureGeometry(PRESENTATION_MARKS[0]) }],
    ["legacy image lockup", props("lockup", "md")],
    ["legacy mark only", props("mark", "md")],
  ] as const)("forwards the validated origin in the %s slot", (_slot, attributes) => {
    const markup = renderToStaticMarkup(<Brandmark {...attributes} origin="HTTPS://EXAMPLE.COM:8443/" />);
    const document = new DOMParser().parseFromString(markup, "text/html");
    expect(document.querySelectorAll("a")).toHaveLength(1);
    expect(document.querySelector("a")!.getAttribute("href")).toBe("https://example.com:8443/");
    expect(() => renderToStaticMarkup(<Brandmark {...attributes} origin="https://example.com/path" />))
      .toThrow("Brandmark: `origin` must be an https origin, or an http origin on a loopback host.");
  });
});

describe("Brandmark: token wiring", () => {
  const varNameRe = /var\(\s*(--[a-zA-Z0-9-]+)/g;

  function varNames(source: string): string[] {
    return [...source.matchAll(varNameRe)].map((m) => m[1] as string);
  }

  it("finds the brandmark constants in shell-vars.ts (guards the regex against silently matching nothing)", () => {
    expect(brandmarkConstantStatements.length).toBeGreaterThanOrEqual(6);
  });

  it("every custom-property read in the Brandmark component and the brandmark constants in shell-vars.ts is defined in styles/tokens.css", () => {
    const declared = new Set([...tokensCss.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((m) => m[1] as string));
    const read = new Set([...varNames(brandmarkSource), ...varNames(brandmarkConstantStatements.join("\n"))]);
    expect(read.size).toBeGreaterThanOrEqual(6);
    expect([...read].filter((name) => !declared.has(name))).toEqual([]);
  });

  it.each(BRANDMARK_SIZES)("size %s: the height token is the specified px value", (size) => {
    expect(TOKENS[`--ui-brandmark-height-${size}`]?.value).toBe(`${HEIGHT_PX[size]}px`);
  });

  it.each(BRANDMARK_SIZES)("size %s: the gap token is round(height x 8/48)", (size) => {
    const height = Number.parseFloat(TOKENS[`--ui-brandmark-height-${size}`]?.value ?? "");
    const gap = TOKENS[`--ui-brandmark-gap-${size}`]?.value;
    expect(gap).toBe(`${Math.round(height * GAP_RATIO)}px`);
    expect(gap).toBe(`${GAP_PX[size]}px`);
  });

  it("the wordmark ratio constant is the identity kit's 22/48", () => {
    expect(BRANDMARK_WORDMARK_SIZE_RATIO).toBeCloseTo(22 / 48, 12);
  });

  // Hard guards, no skip path: both constants ship in this package's own
  // identity kit, so a rename or a non-numeric value must fail here rather
  // than let the shell's ratios drift from the kit's unnoticed.
  it("the gap ratio (8/48) equals the identity kit's LOCKUP_GAP_RATIO", () => {
    expect(typeof LOCKUP_GAP_RATIO).toBe("number");
    expect(Number.isFinite(LOCKUP_GAP_RATIO)).toBe(true);
    expect(GAP_RATIO).toBeCloseTo(LOCKUP_GAP_RATIO, 12);
  });
  it("BRANDMARK_WORDMARK_SIZE_RATIO equals the identity kit's LOCKUP_WORDMARK_SIZE_RATIO", () => {
    expect(typeof LOCKUP_WORDMARK_SIZE_RATIO).toBe("number");
    expect(Number.isFinite(LOCKUP_WORDMARK_SIZE_RATIO)).toBe(true);
    expect(BRANDMARK_WORDMARK_SIZE_RATIO).toBeCloseTo(LOCKUP_WORDMARK_SIZE_RATIO, 12);
  });
});

function refusal(node: ReactElement): string {
  try {
    renderToStaticMarkup(node);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error("expected Brandmark to refuse, but it rendered");
}

describe("Brandmark: the label must name the link", () => {
  it.each(["", " ", "   ", "\t\n "])("refuses an empty or whitespace-only label (%j) for both variants, naming the prop", (label) => {
    for (const variant of BRANDMARK_VARIANTS) {
      const base = props(variant, "md");
      const message = refusal(<Brandmark {...base} label={label} />);
      expect(message).toContain("label");
    }
  });

  it("refuses a label forced to a non-string past the type system", () => {
    const forced = { ...props("mark", "md"), label: undefined } as unknown as BrandmarkProps;
    expect(refusal(<Brandmark {...forced} />)).toContain("label");
  });

  it("a normal label renders, named by that label", () => {
    render(<Brandmark {...props("mark", "md")} label="Acme home" />);
    expect(screen.getByRole("link", { name: "Acme home" })).toHaveAttribute("href", "/");
  });
});

describe("Brandmark: lockup label contains the visible wordmark text (WCAG 2.5.3)", () => {
  const base = { variant: "lockup", size: "md", markSrc: MARK_SRC } as const;

  it("renders when the label contains the wordmark", () => {
    render(<Brandmark {...base} label="Northwind Studio home" wordmark="Northwind Studio" />);
    expect(screen.getByRole("link", { name: "Northwind Studio home" })).toBeInTheDocument();
  });

  it("matches case-insensitively and with whitespace normalised", () => {
    render(<Brandmark {...base} label={"go to  NORTHWIND\n studio  home"} wordmark="  Northwind   Studio " />);
    expect(screen.getByRole("link", { name: /northwind/i })).toBeInTheDocument();
  });

  it("refuses a label that lacks the wordmark, naming the props and echoing neither value", () => {
    const message = refusal(<Brandmark {...base} label="Northwind home" wordmark="Northwind Studio" />);
    expect(message).toContain("label");
    expect(message).toContain("wordmark");
    expect(message).not.toContain("Northwind");
  });

  it("does not echo a distinctive label or wordmark in either refusal", () => {
    const lacking = refusal(<Brandmark {...base} label="zq-label-value" wordmark="zq-wordmark-value" />);
    expect(lacking).not.toContain("zq-label-value");
    expect(lacking).not.toContain("zq-wordmark-value");
    const empty = refusal(<Brandmark {...base} label="  " wordmark="zq-wordmark-value" />);
    expect(empty).not.toContain("zq-wordmark-value");
  });

  it("the mark variant (image only) is unaffected: any non-empty label renders", () => {
    render(<Brandmark variant="mark" size="md" markSrc={MARK_SRC} label="Home" />);
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  });

  it("a lockup with no wordmark to show falls back to the mark and needs no wordmark in the label", () => {
    render(<Brandmark {...base} label="Home" wordmark="" />);
    expect(screen.getByRole("link", { name: "Home" }).querySelectorAll("span")).toHaveLength(0);
  });
});

describe("Brandmark: designer-token-check over the new files", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("finds no error, no unchecked construct, and only the documented fallback-carrying warnings", () => {
    dir = mkdtempSync(join(tmpdir(), "brandmark-token-check-"));
    writeFileSync(join(dir, "Brandmark.tsx"), brandmarkSource);
    // Only the brandmark constants from shell-vars.ts: the rest of that file
    // is other components' (each of its fallback-carrying reads reports the
    // same warning), and is not this change's to vouch for.
    writeFileSync(join(dir, "brandmark-vars.ts"), `${brandmarkConstantStatements.join("\n")}\n`);
    writeFileSync(join(dir, "badge-plate.ts"), badgePlateSource);

    const scan = scanStyleSources(dir);
    expect(scan.filesScanned).toBe(3);
    const result = checkTokenPurity(scan.candidates, TOKENS, scan.filesScanned, scan.unchecked);

    expect(scan.unchecked).toEqual([]);
    expect(result.unchecked).toEqual([]);
    // Bare literals (hex/color/length outside a var() fallback) are the
    // errors the gate exists to catch: none may exist.
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
    // shell-vars.ts's own convention is `var(--token, <token's default>)` (see
    // its header). The gate reports each such fallback as a
    // `token-value-duplicated-in-fallback` warning. Allowed here ONLY when the
    // fallback is for a brandmark token and currently equals its declared value.
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding.rule).toBe("token-value-duplicated-in-fallback");
      expect(finding.matchedToken).toMatch(/^--ui-brandmark-(height|gap)-(sm|md|lg)$/);
      expect(finding.message).toContain("currently matches");
    }
  });
});

describe("Brandmark: no injected markup, no built-in copy", () => {
  it("has no dangerouslySetInnerHTML and no inline <svg", () => {
    expect(brandmarkSource).not.toContain("dangerouslySetInnerHTML");
    expect(brandmarkSource).not.toContain("<svg");
  });

  it("is server-safe: no client directive, no react-aria import, no hook call", () => {
    const source = ts.createSourceFile("Brandmark.tsx", brandmarkSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const importSpecifiers = source.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
    expect(importSpecifiers.filter((spec) => /react-aria/.test(spec))).toEqual([]);
    // `wordmark` is text, so no React type import is needed; if one is added it must stay type-only.
    const directives = source.statements.filter((st) => ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression));
    expect(directives).toEqual([]);
    const hookCalls: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^use[A-Z]/.test(node.expression.text)) {
        hookCalls.push(node.expression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(hookCalls).toEqual([]);
    const reactImport = source.statements.filter(ts.isImportDeclaration).find((d) => (d.moduleSpecifier as ts.StringLiteral).text === "react");
    if (reactImport) expect(reactImport.importClause?.isTypeOnly).toBe(true);
  });

  it("has no lettered JSX text and no lettered string literal in JSX attributes beyond className/style/href/alt", () => {
    const source = ts.createSourceFile("Brandmark.tsx", brandmarkSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const offenders: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isJsxText(node) && /\p{L}/u.test(node.text)) offenders.push(`JSX text: ${node.text.trim()}`);
      if (
        ts.isJsxAttribute(node) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        /\p{L}/u.test(node.initializer.text) &&
        !["className"].includes(node.name.getText())
      ) {
        offenders.push(`attribute ${node.name.getText()}="${node.initializer.text}"`);
      }
      if (ts.isJsxExpression(node) && node.parent && ts.isJsxElement(node.parent)) {
        const expr = node.expression;
        if (expr && (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) && /\p{L}/u.test(expr.text)) {
          offenders.push(`JSX child literal: ${expr.text}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(offenders).toEqual([]);
  });
});

describe("Brandmark: server render", () => {
  it.each(COMBOS)("%s / %s renders through react-dom/server as a plain <a href=\"/\">", (variant, size) => {
    const html = renderToStaticMarkup(<Brandmark {...props(variant, size)} />);
    expect(html).toContain('<a href="/"');
    expect(html).toContain(`aria-label="${LABEL}"`);
    expect(html).toContain(`<img src="${MARK_SRC}" alt=""`);
    expect(html.includes("<span")).toBe(variant === "lockup");
    if (variant === "lockup") expect(html).toContain(`>${WORDMARK}</span>`);
  });
});

// Captured from main before `plate` existed (label, mark URL and wordmark as in `props()` above).
const NO_PLATE_GOLDEN: Readonly<Record<string, string>> = {
  "mark/sm": "<link rel=\"preload\" as=\"image\" href=\"/assets/mark.svg\"/><a href=\"/\" aria-label=\"Wordmark text, consumer-supplied accessible name\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\"><img src=\"/assets/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/></a>",
  "mark/md": "<link rel=\"preload\" as=\"image\" href=\"/assets/mark.svg\"/><a href=\"/\" aria-label=\"Wordmark text, consumer-supplied accessible name\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\"><img src=\"/assets/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/></a>",
  "mark/lg": "<link rel=\"preload\" as=\"image\" href=\"/assets/mark.svg\"/><a href=\"/\" aria-label=\"Wordmark text, consumer-supplied accessible name\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\"><img src=\"/assets/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/></a>",
  "lockup/sm": "<link rel=\"preload\" as=\"image\" href=\"/assets/mark.svg\"/><a href=\"/\" aria-label=\"Wordmark text, consumer-supplied accessible name\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/assets/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Wordmark text</span></a>",
  "lockup/md": "<link rel=\"preload\" as=\"image\" href=\"/assets/mark.svg\"/><a href=\"/\" aria-label=\"Wordmark text, consumer-supplied accessible name\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/assets/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Wordmark text</span></a>",
  "lockup/lg": "<link rel=\"preload\" as=\"image\" href=\"/assets/mark.svg\"/><a href=\"/\" aria-label=\"Wordmark text, consumer-supplied accessible name\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/assets/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Wordmark text</span></a>",
};

describe("Brandmark: plate", () => {
  function sharedProps(variant: BrandmarkVariant, size: BrandmarkSize): BrandmarkProps {
    return { ...props(variant, size), plate: "shared" };
  }

  it.each(COMBOS)("%s / %s: `plate` omitted and \"self\" render markup byte-identical to main", (variant, size) => {
    const golden = NO_PLATE_GOLDEN[`${variant}/${size}`];
    expect(renderToStaticMarkup(<Brandmark {...props(variant, size)} />)).toBe(golden);
    expect(renderToStaticMarkup(<Brandmark {...props(variant, size)} plate="self" />)).toBe(golden);
  });

  it.each(COMBOS)("%s / %s: \"shared\" renders one decorative plate whose radius and inset come from the two shares", (variant, size) => {
    const html = renderToStaticMarkup(<Brandmark {...sharedProps(variant, size)} />);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("dangerouslySetInnerHTML");
    expect(html).toContain("bg-ink-primary");

    render(<Brandmark {...sharedProps(variant, size)} />);
    const link = screen.getByRole("link", { name: LABEL });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveAttribute("aria-label", LABEL);

    const plates = [...link.querySelectorAll("span")].filter((el) => el.className.includes("bg-ink-primary"));
    expect(plates).toHaveLength(1);
    const plate = plates[0] as HTMLElement;
    expect(plate.getAttribute("aria-hidden")).toBe("true");
    expect(plate.textContent).toBe("");
    const height = `var(--ui-brandmark-height-${size}, ${HEIGHT_PX[size]}px)`;
    expect(plate.style.height).toBe(height);
    expect(plate.style.width).toBe(height);
    expect(plate.style.borderRadius).toBe(`calc(${height} * ${BADGE_RADIUS_SHARE})`);

    const img = plate.querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(link.querySelectorAll("img")).toHaveLength(1);
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("src", MARK_SRC);
    const inner = `calc(${height} * ${1 - 2 * BADGE_INSET_SHARE})`;
    expect(img.style.height).toBe(inner);
    expect(img.style.width).toBe(inner);
    expect(1 - 2 * BADGE_INSET_SHARE).toBeCloseTo(0.64, 12);
  });

  it.each(BRANDMARK_SIZES)("lockup / %s: the plate wraps only the mark; the wordmark and gap stay outside it", (size) => {
    render(<Brandmark {...sharedProps("lockup", size)} />);
    const link = screen.getByRole("link", { name: LABEL });
    const plate = [...link.querySelectorAll("span")].find((el) => el.className.includes("bg-ink-primary")) as HTMLElement;
    const text = screen.getByText(WORDMARK);
    expect(plate).not.toContainElement(text);
    expect(link).toContainElement(text);
    expect(link.style.gap).toContain(`--ui-brandmark-gap-${size}`);
  });

  it("mark / sm: a shared-plate mark has exactly one span (the plate) and no text", () => {
    render(<Brandmark {...sharedProps("mark", "sm")} />);
    const link = screen.getByRole("link", { name: LABEL });
    expect(link.querySelectorAll("span")).toHaveLength(1);
    expect(link.textContent).toBe("");
  });

  it("an unknown `plate` forced past the type system renders as \"self\"", () => {
    const forced = { ...props("mark", "md"), plate: "round" } as unknown as BrandmarkProps;
    expect(renderToStaticMarkup(<Brandmark {...forced} />)).toBe(NO_PLATE_GOLDEN["mark/md"]);
  });

  it("still applies both label refusals with a shared plate", () => {
    expect(refusal(<Brandmark {...sharedProps("mark", "md")} label=" " />)).toContain("label");
    expect(refusal(<Brandmark {...sharedProps("lockup", "md")} label="Home" />)).toContain("wordmark");
  });

  it("the CSS shares in Brandmark come from the exported constants (one source)", () => {
    expect(logomarkSource).toMatch(/import \{[^}]*BADGE_RADIUS_SHARE[^}]*\} from "\.\.\/internal\/brandmark\.js"/);
    expect(logomarkSource).toMatch(/import \{[^}]*BADGE_INSET_SHARE[^}]*\} from "\.\.\/internal\/brandmark\.js"/);
    expect(brandmarkSource).not.toMatch(/\b0\.18\b|\b7 \/ 32\b|\b0\.21875\b|\b0\.64\b/);
  });

  it("the path and the CSS describe one geometry: same radius share at the token height", () => {
    const side = HEIGHT_PX.md;
    const r = side * BADGE_RADIUS_SHARE;
    expect(badgePlatePath(side).startsWith(`M${r} 0H`)).toBe(true);
  });
});

// Frozen React SSR from pre-PR main56e01eab with the optional peer physically rejected by an isolated resolver.
const ABSENT_BRAND_GOLDENS = [
  {"name":"sm/auto/default/default","props":{"variant":"lockup","size":"sm","tone":"auto","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/auto/default/consumer","props":{"variant":"lockup","size":"sm","tone":"auto","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent consumer\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/auto/default/text-inherit","props":{"variant":"lockup","size":"sm","tone":"auto","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/auto/default/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"sm","tone":"auto","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/auto/self/default","props":{"variant":"lockup","size":"sm","tone":"auto","plate":"self","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/auto/self/consumer","props":{"variant":"lockup","size":"sm","tone":"auto","plate":"self","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent consumer\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/auto/self/text-inherit","props":{"variant":"lockup","size":"sm","tone":"auto","plate":"self","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/auto/self/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"sm","tone":"auto","plate":"self","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/auto/shared/default","props":{"variant":"lockup","size":"sm","tone":"auto","plate":"shared","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:var(--ui-brandmark-height-sm, 24px);border-radius:calc(var(--ui-brandmark-height-sm, 24px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);width:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/auto/shared/consumer","props":{"variant":"lockup","size":"sm","tone":"auto","plate":"shared","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent consumer\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:var(--ui-brandmark-height-sm, 24px);border-radius:calc(var(--ui-brandmark-height-sm, 24px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);width:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/auto/shared/text-inherit","props":{"variant":"lockup","size":"sm","tone":"auto","plate":"shared","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:var(--ui-brandmark-height-sm, 24px);border-radius:calc(var(--ui-brandmark-height-sm, 24px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);width:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/auto/shared/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"sm","tone":"auto","plate":"shared","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:var(--ui-brandmark-height-sm, 24px);border-radius:calc(var(--ui-brandmark-height-sm, 24px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);width:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/default/default","props":{"variant":"lockup","size":"sm","tone":"inverse","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/default/consumer","props":{"variant":"lockup","size":"sm","tone":"inverse","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse consumer\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/default/text-inherit","props":{"variant":"lockup","size":"sm","tone":"inverse","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/default/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"sm","tone":"inverse","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/self/default","props":{"variant":"lockup","size":"sm","tone":"inverse","plate":"self","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/self/consumer","props":{"variant":"lockup","size":"sm","tone":"inverse","plate":"self","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse consumer\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/self/text-inherit","props":{"variant":"lockup","size":"sm","tone":"inverse","plate":"self","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/self/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"sm","tone":"inverse","plate":"self","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/shared/default","props":{"variant":"lockup","size":"sm","tone":"inverse","plate":"shared","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:var(--ui-brandmark-height-sm, 24px);border-radius:calc(var(--ui-brandmark-height-sm, 24px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);width:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/shared/consumer","props":{"variant":"lockup","size":"sm","tone":"inverse","plate":"shared","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse consumer\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:var(--ui-brandmark-height-sm, 24px);border-radius:calc(var(--ui-brandmark-height-sm, 24px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);width:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/shared/text-inherit","props":{"variant":"lockup","size":"sm","tone":"inverse","plate":"shared","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:var(--ui-brandmark-height-sm, 24px);border-radius:calc(var(--ui-brandmark-height-sm, 24px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);width:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"sm/inverse/shared/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"sm","tone":"inverse","plate":"shared","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-sm, 4px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-sm, 24px);width:var(--ui-brandmark-height-sm, 24px);border-radius:calc(var(--ui-brandmark-height-sm, 24px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);width:calc(var(--ui-brandmark-height-sm, 24px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-sm, 24px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/default/default","props":{"variant":"lockup","size":"md","tone":"auto","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/default/consumer","props":{"variant":"lockup","size":"md","tone":"auto","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent consumer\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/default/text-inherit","props":{"variant":"lockup","size":"md","tone":"auto","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/default/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"md","tone":"auto","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/self/default","props":{"variant":"lockup","size":"md","tone":"auto","plate":"self","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/self/consumer","props":{"variant":"lockup","size":"md","tone":"auto","plate":"self","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent consumer\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/self/text-inherit","props":{"variant":"lockup","size":"md","tone":"auto","plate":"self","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/self/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"md","tone":"auto","plate":"self","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/shared/default","props":{"variant":"lockup","size":"md","tone":"auto","plate":"shared","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/shared/consumer","props":{"variant":"lockup","size":"md","tone":"auto","plate":"shared","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent consumer\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/shared/text-inherit","props":{"variant":"lockup","size":"md","tone":"auto","plate":"shared","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/auto/shared/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"md","tone":"auto","plate":"shared","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/default/default","props":{"variant":"lockup","size":"md","tone":"inverse","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/default/consumer","props":{"variant":"lockup","size":"md","tone":"inverse","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse consumer\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/default/text-inherit","props":{"variant":"lockup","size":"md","tone":"inverse","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/default/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"md","tone":"inverse","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/self/default","props":{"variant":"lockup","size":"md","tone":"inverse","plate":"self","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/self/consumer","props":{"variant":"lockup","size":"md","tone":"inverse","plate":"self","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse consumer\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/self/text-inherit","props":{"variant":"lockup","size":"md","tone":"inverse","plate":"self","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/self/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"md","tone":"inverse","plate":"self","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/shared/default","props":{"variant":"lockup","size":"md","tone":"inverse","plate":"shared","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/shared/consumer","props":{"variant":"lockup","size":"md","tone":"inverse","plate":"shared","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse consumer\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/shared/text-inherit","props":{"variant":"lockup","size":"md","tone":"inverse","plate":"shared","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"md/inverse/shared/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"md","tone":"inverse","plate":"shared","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/default/default","props":{"variant":"lockup","size":"lg","tone":"auto","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/default/consumer","props":{"variant":"lockup","size":"lg","tone":"auto","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent consumer\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/default/text-inherit","props":{"variant":"lockup","size":"lg","tone":"auto","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/default/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"lg","tone":"auto","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/self/default","props":{"variant":"lockup","size":"lg","tone":"auto","plate":"self","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/self/consumer","props":{"variant":"lockup","size":"lg","tone":"auto","plate":"self","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent consumer\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/self/text-inherit","props":{"variant":"lockup","size":"lg","tone":"auto","plate":"self","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/self/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"lg","tone":"auto","plate":"self","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/shared/default","props":{"variant":"lockup","size":"lg","tone":"auto","plate":"shared","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:var(--ui-brandmark-height-lg, 48px);border-radius:calc(var(--ui-brandmark-height-lg, 48px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);width:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/shared/consumer","props":{"variant":"lockup","size":"lg","tone":"auto","plate":"shared","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent consumer\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:var(--ui-brandmark-height-lg, 48px);border-radius:calc(var(--ui-brandmark-height-lg, 48px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);width:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/shared/text-inherit","props":{"variant":"lockup","size":"lg","tone":"auto","plate":"shared","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:var(--ui-brandmark-height-lg, 48px);border-radius:calc(var(--ui-brandmark-height-lg, 48px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);width:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/auto/shared/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"lg","tone":"auto","plate":"shared","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:var(--ui-brandmark-height-lg, 48px);border-radius:calc(var(--ui-brandmark-height-lg, 48px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);width:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/default/default","props":{"variant":"lockup","size":"lg","tone":"inverse","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/default/consumer","props":{"variant":"lockup","size":"lg","tone":"inverse","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse consumer\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/default/text-inherit","props":{"variant":"lockup","size":"lg","tone":"inverse","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/default/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"lg","tone":"inverse","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/self/default","props":{"variant":"lockup","size":"lg","tone":"inverse","plate":"self","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/self/consumer","props":{"variant":"lockup","size":"lg","tone":"inverse","plate":"self","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse consumer\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/self/text-inherit","props":{"variant":"lockup","size":"lg","tone":"inverse","plate":"self","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/self/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"lg","tone":"inverse","plate":"self","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/shared/default","props":{"variant":"lockup","size":"lg","tone":"inverse","plate":"shared","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:var(--ui-brandmark-height-lg, 48px);border-radius:calc(var(--ui-brandmark-height-lg, 48px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);width:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/shared/consumer","props":{"variant":"lockup","size":"lg","tone":"inverse","plate":"shared","className":"consumer","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse consumer\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:var(--ui-brandmark-height-lg, 48px);border-radius:calc(var(--ui-brandmark-height-lg, 48px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);width:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/shared/text-inherit","props":{"variant":"lockup","size":"lg","tone":"inverse","plate":"shared","className":"text-inherit","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:var(--ui-brandmark-height-lg, 48px);border-radius:calc(var(--ui-brandmark-height-lg, 48px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);width:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
  {"name":"lg/inverse/shared/inline-flex items-center text-ink-secondary p-4","props":{"variant":"lockup","size":"lg","tone":"inverse","plate":"shared","className":"inline-flex items-center text-ink-secondary p-4","label":"Example home","wordmark":"Example","markSrc":"/mark.svg"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse inline-flex items-center text-ink-secondary p-4\" style=\"gap:var(--ui-brandmark-gap-lg, 8px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-lg, 48px);width:var(--ui-brandmark-height-lg, 48px);border-radius:calc(var(--ui-brandmark-height-lg, 48px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);width:calc(var(--ui-brandmark-height-lg, 48px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-lg, 48px) * 0.4583333333333333)\">Example</span></a>"},
];
const ABSENT_HEADER_GOLDENS = [
  {"name":"flow/base/default","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared"},"header":{"placement":"flow","tone":"base"},"html":"<header data-header-root=\"\" class=\"bg-surface-raised py-sm border-b border-line-base site-header-contract\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" data-brand-mark=\"\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><span aria-hidden=\"true\" class=\"inline-block shrink-0 bg-accent\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);mask-image:url(&quot;/mark.svg&quot;);-webkit-mask-image:url(&quot;/mark.svg&quot;);mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center\"></span></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
  {"name":"flow/base/image","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared","markInk":"image"},"header":{"placement":"flow","tone":"base"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><header data-header-root=\"\" class=\"bg-surface-raised py-sm border-b border-line-base site-header-contract\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
  {"name":"flow/base/accent","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared","markInk":"accent"},"header":{"placement":"flow","tone":"base"},"html":"<header data-header-root=\"\" class=\"bg-surface-raised py-sm border-b border-line-base site-header-contract\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" data-brand-mark=\"\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><span aria-hidden=\"true\" class=\"inline-block shrink-0 bg-accent\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);mask-image:url(&quot;/mark.svg&quot;);-webkit-mask-image:url(&quot;/mark.svg&quot;);mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center\"></span></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
  {"name":"flow/inverse/default","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared"},"header":{"placement":"flow","tone":"inverse"},"html":"<header data-header-root=\"\" class=\"bg-surface-raised py-sm border-b border-line-base site-header-contract\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" data-brand-mark=\"\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><span aria-hidden=\"true\" class=\"inline-block shrink-0 bg-accent\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);mask-image:url(&quot;/mark.svg&quot;);-webkit-mask-image:url(&quot;/mark.svg&quot;);mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center\"></span></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
  {"name":"flow/inverse/image","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared","markInk":"image"},"header":{"placement":"flow","tone":"inverse"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><header data-header-root=\"\" class=\"bg-surface-raised py-sm border-b border-line-base site-header-contract\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
  {"name":"flow/inverse/accent","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared","markInk":"accent"},"header":{"placement":"flow","tone":"inverse"},"html":"<header data-header-root=\"\" class=\"bg-surface-raised py-sm border-b border-line-base site-header-contract\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" data-brand-mark=\"\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><span aria-hidden=\"true\" class=\"inline-block shrink-0 bg-accent\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);mask-image:url(&quot;/mark.svg&quot;);-webkit-mask-image:url(&quot;/mark.svg&quot;);mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center\"></span></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
  {"name":"overlay/base/default","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared"},"header":{"placement":"overlay","tone":"base"},"html":"<header data-header-root=\"\" data-placement=\"overlay\" data-tone=\"base\" class=\"site-header-overlay text-ink-primary py-sm site-header-contract\" style=\"position:fixed;inset-block-start:0;inset-inline:0;z-index:var(--ui-z-shell, 20)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" data-brand-mark=\"\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><span aria-hidden=\"true\" class=\"inline-block shrink-0 bg-accent\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);mask-image:url(&quot;/mark.svg&quot;);-webkit-mask-image:url(&quot;/mark.svg&quot;);mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center\"></span></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
  {"name":"overlay/base/image","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared","markInk":"image"},"header":{"placement":"overlay","tone":"base"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><header data-header-root=\"\" data-placement=\"overlay\" data-tone=\"base\" class=\"site-header-overlay text-ink-primary py-sm site-header-contract\" style=\"position:fixed;inset-block-start:0;inset-inline:0;z-index:var(--ui-z-shell, 20)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
  {"name":"overlay/base/accent","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared","markInk":"accent"},"header":{"placement":"overlay","tone":"base"},"html":"<header data-header-root=\"\" data-placement=\"overlay\" data-tone=\"base\" class=\"site-header-overlay text-ink-primary py-sm site-header-contract\" style=\"position:fixed;inset-block-start:0;inset-inline:0;z-index:var(--ui-z-shell, 20)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" data-brand-mark=\"\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><span aria-hidden=\"true\" class=\"inline-block shrink-0 bg-accent\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);mask-image:url(&quot;/mark.svg&quot;);-webkit-mask-image:url(&quot;/mark.svg&quot;);mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center\"></span></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
  {"name":"overlay/inverse/default","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared"},"header":{"placement":"overlay","tone":"inverse"},"html":"<header data-header-root=\"\" data-placement=\"overlay\" data-tone=\"inverse\" class=\"site-header-overlay text-ink-on-inverse py-sm site-header-contract\" style=\"position:fixed;inset-block-start:0;inset-inline:0;z-index:var(--ui-z-shell, 20)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" data-brand-mark=\"\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><span aria-hidden=\"true\" class=\"inline-block shrink-0 bg-accent\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);mask-image:url(&quot;/mark.svg&quot;);-webkit-mask-image:url(&quot;/mark.svg&quot;);mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center\"></span></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
  {"name":"overlay/inverse/image","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared","markInk":"image"},"header":{"placement":"overlay","tone":"inverse"},"html":"<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"/><header data-header-root=\"\" data-placement=\"overlay\" data-tone=\"inverse\" class=\"site-header-overlay text-ink-on-inverse py-sm site-header-contract\" style=\"position:fixed;inset-block-start:0;inset-inline:0;z-index:var(--ui-z-shell, 20)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);object-fit:contain\"/></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
  {"name":"overlay/inverse/accent","props":{"variant":"lockup","size":"md","label":"Example home","wordmark":"Example","markSrc":"/mark.svg","plate":"shared","markInk":"accent"},"header":{"placement":"overlay","tone":"inverse"},"html":"<header data-header-root=\"\" data-placement=\"overlay\" data-tone=\"inverse\" class=\"site-header-overlay text-ink-on-inverse py-sm site-header-contract\" style=\"position:fixed;inset-block-start:0;inset-inline:0;z-index:var(--ui-z-shell, 20)\"><div class=\"site-header-row\"><div class=\"site-header-brand\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse text-inherit\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><span aria-hidden=\"true\" data-brand-mark=\"\" class=\"inline-flex shrink-0 items-center justify-center bg-ink-primary\" style=\"height:var(--ui-brandmark-height-md, 36px);width:var(--ui-brandmark-height-md, 36px);border-radius:calc(var(--ui-brandmark-height-md, 36px) * 0.21875)\"><span aria-hidden=\"true\" class=\"inline-block shrink-0 bg-accent\" style=\"height:calc(var(--ui-brandmark-height-md, 36px) * 0.64);width:calc(var(--ui-brandmark-height-md, 36px) * 0.64);mask-image:url(&quot;/mark.svg&quot;);-webkit-mask-image:url(&quot;/mark.svg&quot;);mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center\"></span></span><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"site-header-actions\"></div></div></header>"},
];

describe("frozen legacy SSR without tailwind-merge", () => {
  let absentBrandmark: typeof Brandmark;
  let absentHeader: typeof import("./SiteHeader.js").SiteHeader;
  let warning: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("tailwind-merge", () => { throw Object.assign(new Error("absent optional peer"), { code: "ERR_MODULE_NOT_FOUND" }); });
    warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { cx } = await import("../atoms/internal/cx.js");
    expect(cx("first", "second")).toBe("first second");
    expect(warning).toHaveBeenCalledTimes(1);
    absentBrandmark = (await import("./Brandmark.js")).Brandmark;
    absentHeader = (await import("./SiteHeader.js")).SiteHeader;
  });
  afterAll(() => { warning.mockRestore(); vi.doUnmock("tailwind-merge"); vi.resetModules(); });
  const geometry = { viewBox: { x: 0, y: 0, width: 100, height: 100 }, paintedBounds: { x: 10, y: 10, width: 80, height: 80 } };
  for (const [mode, extra] of [["omitted", {}], ["geometry only", { geometry }], ["presentation only", { presentation: "mobile" }]] as const) {
    it.each(ABSENT_BRAND_GOLDENS)(`preserves ${mode} image lockup $name`, entry => {
      const Component = absentBrandmark;
      expect(renderToStaticMarkup(<Component {...entry.props as BrandmarkProps} {...extra} />)).toBe(entry.html);
    });
  }
  it.each(ABSENT_HEADER_GOLDENS)("preserves default/image/accent header $name", entry => {
    const Header = absentHeader;
    const Component = absentBrandmark;
    expect(renderToStaticMarkup(<Header {...entry.header as Parameters<typeof Header>[0]} brand={<Component {...entry.props as BrandmarkProps} />} />)).toBe(entry.html);
  });
});
