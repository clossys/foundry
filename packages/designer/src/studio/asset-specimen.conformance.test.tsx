import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { applyLibraryChange, authorImageRatios, createConsumerIdentitySeeds, deriveIdentity, libraryHash, loadCatalog } from "../catalog-core/index.js";
import { metaOf } from "../catalog-core/model.js";
import type { DtcgToken, LibraryData } from "../catalog-core/types.js";
import { inspectSvg } from "../catalog-assets/svg.js";
import { parseRootDeclarations } from "../tokens/internal/parse-css.js";
import { contrastRatio } from "../tokens/color.js";
import { AA_LARGE } from "../tokens/contrast-pairs.js";
import { buildCandidates, type Candidate } from "./model.js";
import { CompactPreview } from "./previews.js";
import { labels } from "./__fixtures__/studio.js";

afterEach(cleanup);

const tokensCss = readFileSync(resolvePath(dirname(fileURLToPath(import.meta.url)), "../../styles/tokens.css"), "utf8");
const lightTokens = parseRootDeclarations(tokensCss);
const catalog = loadCatalog();
const assetSlots = catalog.slots.filter(slot => slot.layer === "assets");

/** A consumer with every assets leaf selected, built only through the producer pipeline. */
function consumerLibrary(): LibraryData {
  let library: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, fills: [], adoptedAt: "2026-10-23" };
  const color = (light: string, dark?: string): DtcgToken => ({ $type: "color", $value: light, $extensions: { "com.clossys.css": { raw: light }, ...(dark ? { "com.clossys.modes": { dark } } : {}) } });
  library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [
    { op: "author", slot: "tokens.text-color", tokens: { primary: color("#111111", "#ffffff"), "on-inverse": color("#ffffff"), "on-accent": color("#ffffff") } },
    { op: "author", slot: "tokens.surface-color", tokens: { base: color("#ffffff", "#111111"), inverse: color("#111111") } },
    { op: "author", slot: "tokens.accent-color", tokens: { default: color("#2255aa") } },
    { op: "author", slot: "tokens.typeface", tokens: { display: { $type: "fontFamily", $value: ["sans-serif"] } } },
    ...catalog.fills.filter(fill => metaOf(fill).source === "lucide").map(fill => ({ op: "adopt" as const, slot: metaOf(fill).slot, source: "lucide" })),
  ] });
  library = deriveIdentity(catalog, createConsumerIdentitySeeds(catalog, library, { name: "Example", fontLicence: { family: "sans-serif", outlining: "unknown" } }));
  return authorImageRatios(catalog, library, { ratios: { landscape: { width: 3, height: 2 } }, source: "Consumer editorial brief", rationale: "Landscape crop for editorial media" });
}

/** The CSS colour a ground class paints in the light theme, read from the shipped token file. */
function groundColor(element: Element): string | undefined {
  const ground = element.closest("[class*='bg-surface-']");
  const token = ground?.className.toString().split(/\s+/).find(name => name.startsWith("bg-surface-"));
  return token ? lightTokens.get(`--color-${token.slice(3)}`) : undefined;
}
const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff" };
/** Every painted ink of a checked SVG; currentColor resolves through the artwork's own colour, else the image default (black). */
function svgInks(svg: string): string[] {
  const elements = inspectSvg(svg, { favicon: true });
  const root = elements[0]?.attrs.color;
  const current = root && root !== "currentColor" ? root : "#000000";
  const inks: string[] = [];
  for (const element of elements) for (const key of ["fill", "stroke"] as const) {
    const value = element.attrs[key];
    if (!value || value === "none" || value === "transparent") continue;
    inks.push(NAMED[value] ?? (value === "currentColor" ? current : value));
  }
  return inks.map(ink => NAMED[ink] ?? ink);
}
/** A mark that vanishes into its ground: an ink below large-text contrast against the plate it sits on. */
function contrastFaults(specimen: Element, svg: string): string[] {
  const ground = groundColor(specimen.querySelector("img") ?? specimen);
  if (!ground) return ["no ground"];
  const inks = svgInks(svg);
  if (inks.length === 0) return ["blank artwork"];
  return inks.filter(ink => contrastRatio(ink, ground) < AA_LARGE).map(ink => `${ink} on ${ground}`);
}

const EXPECTED = (slot: string): string => slot.startsWith("assets.icon-") ? "icon" : slot === "assets.lockup" || slot === "assets.mark" ? "logo" : slot === "assets.image-ratio" ? "ratio" : slot.slice("assets.".length);
type Row = { slot: string; source: string; member: string; faults: string[]; kind?: string };
function specimenRow(candidate: Candidate, entry: Candidate["members"][number]): Row {
  const slot = entry.member.slot;
  const view = render(<CompactPreview candidate={{ ...candidate, members: [entry] }} labels={labels} />);
  const root = view.container, faults: string[] = [];
  const source = typeof entry.member.value.light === "string" ? entry.member.value.light : JSON.stringify(entry.member.value.light);
  if (root.querySelector("code, pre")) faults.push("source text element");
  if (root.textContent?.includes("<svg") || root.textContent?.includes(source)) faults.push("raw source text");
  const specimens = root.querySelectorAll<HTMLElement>("[data-asset-specimen]");
  if (specimens.length !== 1) faults.push(`${specimens.length} specimens`);
  const specimen = specimens[0], kind = specimen?.getAttribute("data-asset-specimen") ?? undefined;
  if (specimen && kind !== EXPECTED(slot)) faults.push(`specimen ${kind}`);
  if (specimen && entry.member.$type === "glyph" && !specimen.querySelector("svg > *")) faults.push("blank icon");
  if (specimen && entry.member.$type === "glyph" && !specimen.textContent?.includes(slot.slice("assets.icon-".length))) faults.push("icon without its name");
  if (specimen && entry.member.$type === "svg") {
    if (!specimen.querySelector("img[src^='data:image/svg+xml,']")) faults.push("no rendered artwork");
    if (kind === "logo") faults.push(...contrastFaults(specimen, entry.member.value.light as string));
  }
  if (specimen && entry.member.$type === "rules") {
    const { width, height } = entry.member.value.light as { width: number; height: number };
    if (![...specimen.querySelectorAll<HTMLElement>("*")].some(element => element.style.aspectRatio.replace(/\s/g, "") === `${width}/${height}`)) faults.push("no ratio frame");
  }
  view.unmount();
  return { slot, source: candidate.source, member: entry.id, faults, kind };
}

describe("assets specimens", () => {
  it("renders every member of all assets leaves as one rendered specimen per leaf, never source", () => {
    const library = consumerLibrary();
    const rows: Row[] = [];
    for (const slot of assetSlots) {
      const candidates = buildCandidates({ catalog, library, working: library, slotId: slot.id, scope: "slot", target: slot.id }).filter(candidate => candidate.previewable && candidate.members.length > 0);
      expect(candidates.some(candidate => candidate.selected), slot.id).toBe(true);
      for (const candidate of candidates) for (const entry of candidate.members) rows.push(specimenRow(candidate, entry));
    }
    const kinds = new Map<string, Set<string | undefined>>();
    for (const row of rows) kinds.set(row.slot, (kinds.get(row.slot) ?? new Set()).add(row.kind));
    const failing = [...new Set(rows.filter(row => row.faults.length > 0 || kinds.get(row.slot)!.size !== 1).map(row => row.slot))];
    expect(new Set(rows.map(row => row.slot)).size).toBe(assetSlots.length);
    const sourceText = new Set(rows.filter(row => row.faults.some(fault => fault.includes("source text"))).map(row => row.slot)).size;
    expect({ failing: failing.length, sourceText, of: assetSlots.length, sample: rows.filter(row => row.faults.length).slice(0, 6).map(row => `${row.member} (${row.source}): ${row.faults.join("; ")}`) }).toEqual({ failing: 0, sourceText: 0, of: assetSlots.length, sample: [] });
   }, 60000);

  it("detects a mark that disappears into its ground", () => {
    const white = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" color="#ffffff"><circle cx="24" cy="24" r="20" fill="currentColor"/></svg>';
    const candidate = (member: string): Candidate => ({ index: 0, source: "example", selected: true, previewable: true, usable: true, errors: 0, findings: [], inUseByDefault: false,
      fill: {} as Candidate["fill"], members: [{ id: `assets.mark.${member}`, member: { slot: "assets.mark", source: "example", fill: "example/mark", via: "authored", $type: "svg", value: { light: white }, css: { light: white }, alias: {} } }] } as unknown as Candidate);
    const onLight = specimenRow(candidate("positive"), candidate("positive").members[0]!);
    expect(onLight.kind).toBe("logo");
    expect(onLight.faults.some(fault => fault.startsWith("#ffffff on"))).toBe(true);
    const onInverse = specimenRow(candidate("reversed"), candidate("reversed").members[0]!);
    expect(onInverse.faults).toEqual([]);
  });

  it("keeps the visible unsupported state for an unknown asset value type", () => {
    const value = { light: "SYNTHETIC-unknown" };
    const candidate = { index: 0, source: "example", selected: true, previewable: true, usable: true, errors: 0, findings: [], inUseByDefault: false, fill: {},
      members: [{ id: "assets.mark.positive", member: { slot: "assets.mark", source: "example", fill: "example/mark", via: "authored", $type: "string", value, css: value, alias: {} } }] } as unknown as Candidate;
    const view = render(<CompactPreview candidate={candidate} labels={labels} />);
    expect(view.getByText(labels.visualPreviewUnsupported)).toBeInTheDocument();
    expect(view.container.textContent).not.toContain("SYNTHETIC-unknown");
  });
});
