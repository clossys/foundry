/**
 * Route/surface ladder conformance — one visual primitive stack per mount
 * (issues #1055, #1060). Pure analysis over a consumer-declared scan set.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

export interface SurfaceLadderFinding {
  file: string;
  rule: string;
  message: string;
}

export interface SurfaceLadderResult {
  filesScanned: number;
  findings: SurfaceLadderFinding[];
}

const IMPORT_RE = /(?:\bimport\s*\(|\brequire\s*\(|\b(?:import|export)\b[^'"]*?\bfrom\s*|\bimport\s+)\s*["']([^"']+)["']/g;
const CSS_IMPORT_RE = /@import\s+(?:url\()?["']?([^"');\s]+)/g;

const DESIGNER_PRIMITIVE_RE =
  /^@clossys\/designer\/(?:atoms|blocks|shell|tokens|theme)(?:\/|$)/;
const DESIGNER_BLOCKS_RE = /^@clossys\/designer\/blocks(?:\/|$)/;
const DESIGNER_PUBLISHER_WEB_RE = /^@clossys\/publisher\/web(?:\/|$)/;

/** Another scoped package's atom/token/theme entrypoint — not Designer, not Publisher web. */
const FOREIGN_PRIMITIVE_RE = /^@([a-z0-9-]+)\/([a-z0-9-]+)\/(?:atoms|tokens|theme)(?:\/|\.css|$)/;

const DESIGNER_TOKENS_CSS = /@clossys\/designer\/tokens\.css/;
const DESIGNER_THEME_CSS = /@clossys\/designer\/theme\.css/;
const FOREIGN_COMPOSE_RE = /\bfrom\s+["'](@(?!clossys\/publisher)[^"']+)\/(?:compose|PageRenderer)["']/;

const SELF_REF_SHIM_RE =
  /--text-display-l:\s*var\(\s*--text-display-l\s*[,)]|--font-display:\s*var\(\s*--font-display\s*[,)]/;

const MARKETING_SECTION_HEADER_RE = /<SectionHeader\b/;

function collectImports(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) out.push(match[1] as string);
  return out;
}

function collectCssImports(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(CSS_IMPORT_RE)) out.push(match[1] as string);
  return out;
}

function isForeignPrimitive(specifier: string): boolean {
  if (DESIGNER_PRIMITIVE_RE.test(specifier)) return false;
  if (DESIGNER_PUBLISHER_WEB_RE.test(specifier)) return false;
  return FOREIGN_PRIMITIVE_RE.test(specifier);
}

const ROUTE_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".jsx", ".js", ".mjs"]);

export function collectRouteSourceFiles(root: string, skipDirs = new Set(["node_modules", "dist", ".git"])): string[] {
  const out: string[] = [];
  const absRoot = resolve(root);
  if (!existsSync(absRoot)) return out;

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (ROUTE_EXTENSIONS.has(extname(entry))) out.push(relative(absRoot, full));
    }
  }

  walk(absRoot);
  return out;
}

/**
 * Fail closed when the scan set is empty — exit code 2 at the CLI layer.
 */
export function checkSurfaceLadder(files: readonly string[], root = process.cwd()): SurfaceLadderResult {
  const findings: SurfaceLadderFinding[] = [];
  const rel = (path: string) => relative(root, path) || path;

  for (const file of files) {
    const abs = resolve(root, file);
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    const imports = collectImports(source);
    const cssImports = collectCssImports(source);
    const hasDesignerPrimitive = imports.some((s) => DESIGNER_PRIMITIVE_RE.test(s));
    const hasDesignerBlocks = imports.some((s) => DESIGNER_BLOCKS_RE.test(s));

    for (const spec of imports) {
      if (hasDesignerPrimitive && isForeignPrimitive(spec)) {
        findings.push({
          file: rel(abs),
          rule: "surface:dual-primitive-stack",
          message:
            "This file imports @clossys/designer primitives and a second atom/token entrypoint. One visual ladder per route — adopt Designer or keep the prior stack, not both on the same mount.",
        });
      }
    }

    if (hasDesignerBlocks && FOREIGN_COMPOSE_RE.test(source)) {
      findings.push({
        file: rel(abs),
        rule: "surface:dual-compose-ladder",
        message:
          "This file imports @clossys/designer blocks and a foreign compose/PageRenderer path. Publisher web or Designer blocks own the mount — not a second compose engine beside them.",
      });
    }

    const hasTokensCss = cssImports.some((s) => DESIGNER_TOKENS_CSS.test(s));
    const hasThemeCss = cssImports.some((s) => DESIGNER_THEME_CSS.test(s));
    if (hasTokensCss && hasThemeCss) {
      findings.push({
        file: rel(abs),
        rule: "surface:dual-designer-css-root",
        message:
          "Do not import @clossys/designer/tokens.css and @clossys/designer/theme.css on the same surface. Greenfield: theme.css only. Existing token root: theme-keys.css only.",
      });
    }

    if (SELF_REF_SHIM_RE.test(source)) {
      findings.push({
        file: rel(abs),
        rule: "surface:designer-key-shim",
        message:
          "Self-referencing var() copies of Designer utility keys drift from the real token chain. Import theme-keys.css instead of hand-declaring --text-display-l or --font-display shims.",
      });
    }

    if (MARKETING_SECTION_HEADER_RE.test(source) && /\bHero\b/.test(source)) {
      findings.push({
        file: rel(abs),
        rule: "surface:marketing-section-header",
        message:
          "SectionHeader is a settings-scale heading (text-h3). Marketing chapters after the fold belong in MarketingChapter (text-h2+) or a second Hero — not SectionHeader beside Hero on the same page.",
      });
    }
  }

  return { filesScanned: files.length, findings };
}
