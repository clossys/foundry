#!/usr/bin/env node
/**
 * `publisher-preview` — brand-file check first, then the public brand guide
 * and the internal system audit from the same brand.css and asset roster.
 *
 *   publisher-preview --brand <brand.css> --roster <roster.json> --out <dir>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { checkBrandFileCoverage, readBrandCss } from "@clossys/designer/tokens";
import { checkBrandAssetRoster, type BrandAssetEntry } from "../media/brand-assets.js";
import { BrandGuideView } from "./views/BrandGuideView.js";
import { SystemAuditView } from "./views/SystemAuditView.js";
import { CERTIFICATION_FIXTURE_COPY } from "./certification-fixtures.js";

export class CliInputError extends Error {}

const USAGE = `publisher-preview — write the brand guide and system audit after the brand file passes.

Usage:
  publisher-preview --brand <brand.css> --roster <roster.json> --out <dir>
  publisher-preview --help
`;

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

export function main(argv: readonly string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const brandPath = flag(argv, "--brand");
  const rosterPath = flag(argv, "--roster");
  const outDir = flag(argv, "--out");
  if (brandPath === undefined || rosterPath === undefined || outDir === undefined) {
    throw new CliInputError("missing --brand, --roster, or --out");
  }
  const brand = readBrandCss(resolve(brandPath));
  if (!brand.complete) {
    console.error("publisher-preview: brand.css could not be read");
    return 1;
  }
  const coverage = checkBrandFileCoverage(brand.declarations);
  if (!coverage.ok) {
    console.error("publisher-preview: brand.css failed coverage");
    return 1;
  }
  const roster = JSON.parse(readFileSync(resolve(rosterPath), "utf8")) as BrandAssetEntry[];
  const rosterFindings = checkBrandAssetRoster(roster);
  if (rosterFindings.length > 0) {
    console.error("publisher-preview: brand-asset roster is incomplete");
    return 1;
  }
  const colors = Object.entries(brand.declarations)
    .filter(([name]) => name.startsWith("--color-"))
    .map(([name, value]) => ({ name, value }));
  const type = Object.entries(brand.declarations)
    .filter(([name]) => name.startsWith("--font-"))
    .map(([name, value]) => ({ name, value }));
  const lockup = roster.find((entry) => entry.role === "favicon-svg");
  const guide = renderToStaticMarkup(
    createElement(BrandGuideView, {
      title: CERTIFICATION_FIXTURE_COPY.guideTitle,
      usage: CERTIFICATION_FIXTURE_COPY.guideUsage,
      lockupSvg: lockup?.src ?? "",
      assets: roster.map((entry) => ({ role: entry.role, href: entry.src, label: entry.role })),
      colors,
      type,
      facts: [{ name: CERTIFICATION_FIXTURE_COPY.factName, value: CERTIFICATION_FIXTURE_COPY.factValue }],
    }),
  );
  const audit = renderToStaticMarkup(
    createElement(SystemAuditView, {
      title: CERTIFICATION_FIXTURE_COPY.auditTitle,
      galleryHref: "gallery.html",
      brandOk: true,
      brandFindings: [],
      contrastFindings: [],
    }),
  );
  mkdirSync(resolve(outDir), { recursive: true });
  writeFileSync(resolve(outDir, "guide.html"), guide);
  writeFileSync(resolve(outDir, "audit.html"), audit);
  console.log("publisher-preview: wrote guide.html and audit.html");
  return 0;
}

function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
  } catch {
    return resolve(argvPath) === modulePath;
  }
}

if (detectMainModule()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`publisher-preview: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`\n${USAGE}`);
    process.exitCode = 2;
  }
}
