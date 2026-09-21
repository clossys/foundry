/**
 * Compiles a minimal consumer entry (`@import "tailwindcss"` + `theme.css` +
 * optional `@source`) with the real Tailwind v4 `compile()` API — used by
 * `designer-hero-css-check` fixtures and tests, not a second styling system.
 *
 * Programmatic `compile().build()` does not apply `@source` the way the CLI
 * does, so when `source` is set this module also scans `dist/` for class
 * candidates (the same discipline as README Setup) and passes them to
 * `build(candidates)`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { scanClassCandidates } from "../compiled-css/class-scan.js";
import { assertPeerVersion } from "../internal/peer-version.js";
import { resolveInstalledPeerVersion } from "../internal/resolve-installed-peer-version.js";
import { TAILWINDCSS_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

export interface CompileConsumerCssOptions {
  /** Directory containing `styles/theme.css` and `dist/` (this package root). */
  packageRoot: string;
  /** When set, scans `dist/` for class candidates (models a correct `@source`). */
  source?: string;
  /** When set, writes `entry.css` here for debugging. */
  workDir?: string;
}

export async function compileConsumerCss(options: CompileConsumerCssOptions): Promise<string> {
  assertPeerVersion({
    peer: "tailwindcss",
    declaredRange: TAILWINDCSS_DECLARED_RANGE,
    foundVersion: resolveInstalledPeerVersion("tailwindcss", import.meta.url),
  });

  const packageRoot = resolve(options.packageRoot);
  const workDir = options.workDir ?? resolve(packageRoot, "node_modules", ".cache", "hero-css-fixture");
  const themePath = resolve(packageRoot, "styles", "theme.css");
  const themeImport = relative(workDir, themePath).replace(/\\/g, "/");
  const sourceLine = options.source ? `@source "${options.source.replace(/\\/g, "/")}";\n` : "";

  const entryCss = `@import "tailwindcss";
@import "${themeImport}";
${sourceLine}`;

  mkdirSync(workDir, { recursive: true });
  const entryPath = resolve(workDir, "entry.css");
  writeFileSync(entryPath, entryCss, "utf8");

  const candidates =
    options.source === undefined
      ? []
      : scanClassCandidates(resolve(packageRoot, "dist"), { extensions: [".js", ".mjs"] }).candidates;

  const require = createRequire(import.meta.url);
  const { compile } = await import("tailwindcss");

  async function loadStylesheet(
    id: string,
    base: string,
  ): Promise<{ path: string; base: string; content: string }> {
    let target: string;
    if (id === "tailwindcss") {
      target = require.resolve("tailwindcss/index.css");
    } else if (id.startsWith(".") || id.startsWith("/")) {
      target = resolve(base, id);
    } else {
      target = require.resolve(id);
    }
    const content = readFileSync(target, "utf8");
    return { path: target, base: dirname(target), content };
  }

  const compiled = await compile(entryCss, { base: workDir, loadStylesheet });
  return compiled.build(candidates);
}
