import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { scanStyleSources } from "../style-scan.js";
import { checkTokenPurity } from "../token-gate.js";
import { TOKENS } from "../tokens/tokens.js";
import * as identityKit from "../tokens/identity-kit.js";
import { Brandmark, BRANDMARK_SIZES, BRANDMARK_VARIANTS, type BrandmarkSize, type BrandmarkVariant } from "./Brandmark.js";
import type { BrandmarkProps } from "./Brandmark.js";
import { BRANDMARK_WORDMARK_SIZE_RATIO } from "./internal/shell-vars.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "..");
const brandmarkSource = readFileSync(join(here, "Brandmark.tsx"), "utf8");
const shellVarsSource = readFileSync(join(here, "internal", "shell-vars.ts"), "utf8");
const tokensCss = readFileSync(join(packageRoot, "styles", "tokens.css"), "utf8");

const brandmarkConstantStatements = shellVarsSource.match(/export const (?:UI_)?BRANDMARK_\w+\s*=[^;]+;/g) ?? [];

const LABEL = "Consumer-supplied accessible name";
const MARK_SRC = "/assets/mark.svg";
const WORDMARK = "Wordmark text";

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

  // The identity kit is edited by a sibling change that adds these exports;
  // until they exist the local ratios are the only source, and this
  // cross-check is reported as skipped rather than passing vacuously.
  const kit = identityKit as Record<string, unknown>;
  it.skipIf(typeof kit.LOCKUP_GAP_RATIO !== "number")("the gap ratio (8/48) equals the identity kit's LOCKUP_GAP_RATIO", () => {
    expect(GAP_RATIO).toBeCloseTo(kit.LOCKUP_GAP_RATIO as number, 12);
  });
  it.skipIf(typeof kit.LOCKUP_WORDMARK_SIZE_RATIO !== "number")(
    "BRANDMARK_WORDMARK_SIZE_RATIO equals the identity kit's LOCKUP_WORDMARK_SIZE_RATIO",
    () => {
      expect(BRANDMARK_WORDMARK_SIZE_RATIO).toBeCloseTo(kit.LOCKUP_WORDMARK_SIZE_RATIO as number, 12);
    },
  );
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

    const scan = scanStyleSources(dir);
    expect(scan.filesScanned).toBe(2);
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
    expect(importSpecifiers.filter((spec) => spec === "react")).toEqual(["react"]); // type-only: ReactNode
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
    expect(reactImport?.importClause?.isTypeOnly).toBe(true);
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
    expect(html.includes(WORDMARK)).toBe(variant === "lockup");
  });
});
