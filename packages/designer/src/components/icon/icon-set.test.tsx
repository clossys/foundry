import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon } from "./index.js";
import { featureGlyphs } from "../../icons/feature-glyphs.js";
import * as icons from "../../icons/index.js";
import { loadCatalog, check, resolve, applyLibraryChange, libraryHash } from "../../catalog-core/index.js";
import { loadCatalogBundles } from "../../catalog-bundles.js";
import type { FillDoc, LibraryData } from "../../catalog-core/types.js";

const names = "zap shield-check lock key-round globe layers sparkles rocket gauge chart-line chart-pie database server cloud cpu code terminal git-branch plug puzzle workflow bot brain message-square mail bell calendar clock users user-check heart star thumbs-up trophy target compass map-pin search settings refresh-cw download upload file-text image video palette smartphone monitor".split(" ");
const fill = () => structuredClone(loadCatalogBundles().valueFills.find(row => row.$extensions["com.clossys.fill"].slot === "assets.icon-set")!);
function input(document: FillDoc = fill()) {
  const catalog = loadCatalog();
  const candidates = { ...catalog, fills: [...catalog.fills, document] };
  const empty: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, fills: [], adoptedAt: "2026-10-29" };
  return { catalog: candidates, library: applyLibraryChange(candidates, empty, { baseHash: libraryHash(empty), changes: [{ op: "adopt", slot: "assets.icon-set", source: "lucide" }] }) };
}

describe("draft feature glyph set", () => {
  it("registers one open draft leaf and all 48 pinned glyph members", () => {
    const profile = input();
    const slot = profile.catalog.slots.find(row => row.id === "assets.icon-set")!;
    expect(slot.status).toBe("draft");
    expect(slot.contract.members.mode).toBe("open");
    expect(Object.keys(resolve(profile).members).sort()).toEqual(names.map(name => `assets.icon-set.glyph.${name}`).sort());
    expect(check(profile).findings.filter(row => row.severity === "error" && (row.subject === "assets.icon-set" || row.subject.startsWith("assets.icon-set.") || row.subject.endsWith("/assets.icon-set")))).toEqual([]);
    const extended = fill();
    extended.assets!["icon-set"]!.glyph!["example"] = structuredClone(extended.assets!["icon-set"]!.glyph!.zap!);
    expect(check(input(extended)).findings.filter(row => row.code === "C1" && (row.subject === "assets.icon-set" || row.subject.startsWith("assets.icon-set.") || row.subject.endsWith("/assets.icon-set")))).toEqual([]);
  });

  it("checks the generated source pin and byte-identical vendored paths", () => {
    const document = fill();
    const pin = document.$extensions["com.clossys.fill"].pin!;
    expect(pin.version).toBe("1.23.0");
    const bytes = readFileSync(resolvePath(import.meta.dirname, "../../icons/feature-glyphs.ts"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(pin.sha256);
    const values = resolve(input(document)).members;
    for (const name of names) {
      const member = `assets.icon-set.glyph.${name}` as keyof typeof featureGlyphs;
      expect(featureGlyphs[member]).toEqual(values[member]!.value.light);
      const exported = `Feature${name.split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("")}`;
      expect((icons as Record<string, unknown>)[exported]).toEqual(featureGlyphs[member]);
    }
  });

  it("reports an unknown referenced glyph as a catalog finding", () => {
    const profile = input();
    profile.library.fills[0]!.assets!["icon-set"]!.glyph!.zap!.$value = "{assets.icon-set.glyph.unknown}";
    expect(check(profile).findings.some(row => row.severity === "error" && row.message.includes("assets.icon-set.glyph.unknown"))).toBe(true);
  });

  it("renders every feature member as a decorative SVG through components.icon", () => {
    for (const name of names) {
      const asset = `assets.icon-set.glyph.${name}` as keyof typeof featureGlyphs;
      const markup = renderToStaticMarkup(createElement(Icon, { asset, label: "Example feature" }));
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).not.toContain("aria-label");
      expect(markup).toContain("<svg");
      expect(markup).toContain('viewBox="0 0 24 24"');
    }
    expect(() => renderToStaticMarkup(createElement(Icon, { asset: "assets.icon-set.glyph.unknown" as keyof typeof featureGlyphs, decorative: true }))).toThrow("Missing consumer glyph");
  });
});
