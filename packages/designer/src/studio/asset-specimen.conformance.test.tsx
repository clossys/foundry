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

/** An ink as comparable text: named, short and opaque-alpha hex forms folded to one six-digit lowercase hex. */
function normaliseInk(ink: string): string {
  const value = (NAMED[ink] ?? ink).toLowerCase();
  const short = /^#([\da-f])([\da-f])([\da-f])$/.exec(value);
  if (short) return `#${short[1]!}${short[1]!}${short[2]!}${short[2]!}${short[3]!}${short[3]!}`;
  return /^#[\da-f]{6}ff$/.test(value) ? value.slice(0, 7) : value;
}
type Paint = { plate: boolean; inks: string[] };
const UNPAINTED = new Set(["none", "transparent"]);
const FILLED = new Set(["rect", "circle", "ellipse", "path", "polygon", "polyline", "text", "tspan"]);
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const measure = (value: string | undefined): number | undefined => value !== undefined && NUMBER.test(value) ? Number(value) : undefined;
/** The shapes an SVG paints, in paint order, with inherited fill, stroke and colour resolved and a plate named: a filled shape spanning the enclosing viewBox. */
function paintOf(svg: string, override: { color?: string; fill?: string } = {}): Paint[] {
  type Context = { color: string; fill: string; stroke: string; box: readonly [number, number]; hidden: boolean };
  const chain: Context[] = [], paints: Paint[] = [];
  for (const element of inspectSvg(svg, { favicon: true })) {
    const parent: Context = chain[element.depth - 1] ?? { color: "#000000", fill: "#000000", stroke: "none", box: [0, 0], hidden: false };
    const attrs = element.attrs, root = element.depth === 0;
    const rawColor = (root ? override.color : undefined) ?? attrs.color;
    const color = rawColor && rawColor !== "currentColor" ? normaliseInk(rawColor) : parent.color;
    const resolve = (value: string | undefined, inherited: string): string => value === undefined ? inherited : value === "currentColor" ? color : UNPAINTED.has(value) ? "none" : normaliseInk(value);
    const fill = resolve((root ? override.fill : undefined) ?? attrs.fill, parent.fill), stroke = resolve(attrs.stroke, parent.stroke);
    const viewBox = element.tag === "svg" ? attrs.viewBox?.trim().split(/[ ,]+/).map(Number) : undefined;
    const box = viewBox && viewBox.length === 4 ? [viewBox[2]!, viewBox[3]!] as const : parent.box;
    const hidden = parent.hidden || element.tag === "defs" || element.tag === "mask" || attrs.opacity === "0";
    chain[element.depth] = { color, fill, stroke, box, hidden };
    chain.length = element.depth + 1;
    if (hidden || !(FILLED.has(element.tag) || element.tag === "line")) continue;
    const fillShown = FILLED.has(element.tag) && fill !== "none" && attrs["fill-opacity"] !== "0";
    const strokeShown = stroke !== "none" && attrs["stroke-opacity"] !== "0";
    const span = element.tag === "rect" ? [measure(attrs.width), measure(attrs.height)]
      : element.tag === "circle" ? [2 * (measure(attrs.r) ?? 0), 2 * (measure(attrs.r) ?? 0)]
      : element.tag === "ellipse" ? [2 * (measure(attrs.rx) ?? 0), 2 * (measure(attrs.ry) ?? 0)] : [];
    const plate = fillShown && span.length === 2 && (span[0] ?? 0) >= 0.9 * box[0] && (span[1] ?? 0) >= 0.9 * box[1] && box[0] > 0 && box[1] > 0;
    if (plate) paints.push({ plate, inks: [fill] });
    else if (fillShown || strokeShown) paints.push({ plate, inks: [...(fillShown ? [fill] : []), ...(strokeShown ? [stroke] : [])] });
  }
  return paints;
}
const DARK_RULE = /@media \(prefers-color-scheme: dark\)\{svg\{color:([^{};]+)(?:;fill:([^{};]+))?\}\}/;
/**
 * Faults of how an SVG's symbol is painted against what it sits on: `flat paint` when a symbol is the
 * very ink of the plate beneath it, and (when `contrast` is set) a symbol below large-text contrast
 * against that plate, or, with no plate, against the specimen ground. Never throws on an ink it cannot score.
 */
function markFaults(svg: string, options: { ground?: string; contrast?: boolean; override?: { color?: string; fill?: string } } = {}): string[] {
  const faults = new Set<string>();
  let plate: string | undefined;
  const ratio = (ink: string, behind: string): number => { try { return contrastRatio(ink, behind); } catch { return 0; } };
  for (const paint of paintOf(svg, options.override)) {
    if (paint.plate) { plate = paint.inks[0]; continue; }
    for (const ink of paint.inks) {
      if (plate !== undefined) {
        if (ink === plate) faults.add(`flat paint ${ink}`);
        else if (options.contrast && ratio(ink, plate) < AA_LARGE) faults.add(`${ink} on plate ${plate}`);
      } else if (options.contrast && !options.override) {
        if (!options.ground) faults.add("no ground");
        else if (ratio(ink, options.ground) < AA_LARGE) faults.add(`${ink} on ${options.ground}`);
      }
    }
  }
  return [...faults];
}
/** The faults of a member's artwork in the light scheme, and for a favicon in the dark scheme its own style rule switches to (plate against symbol only). */
function artworkFaults(kind: string | undefined, svg: string, ground?: string): string[] {
  const contrast = kind === "favicon" || kind === "app-icon";
  const faults = markFaults(svg, { ground, contrast });
  const dark = kind === "favicon" ? DARK_RULE.exec(svg) : null;
  if (dark) faults.push(...markFaults(svg, { contrast, override: { color: dark[1]!, ...(dark[2] === undefined ? {} : { fill: dark[2] }) } }).map(fault => `dark: ${fault}`));
  return faults;
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
    if (kind === "logo" || kind === "favicon" || kind === "app-icon") faults.push(...artworkFaults(kind, entry.member.value.light as string, groundColor(specimen.querySelector("img") ?? specimen)));
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

  describe("flat paint: a plate and the symbol on it painted one ink", () => {
    const frame = (body: string, attrs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"${attrs}>${body}</svg>`;
    const plate = (fill: string) => `<rect x="0" y="0" width="48" height="48" fill="${fill}"/>`;
    const symbol = (fill: string) => `<circle cx="24" cy="24" r="10" fill="${fill}"/>`;

    it("sees a full-viewBox plate and a symbol painted the same ink, however the ink is spelt or inherited", () => {
      expect(markFaults(frame(plate("#111111") + symbol("#111111")))).toEqual(["flat paint #111111"]);
      expect(markFaults(frame(plate("#111") + symbol("#111111")))).toEqual(["flat paint #111111"]);
      expect(markFaults(frame('<rect x="0" y="0" width="48" height="48"/>' + symbol("currentColor"), ' color="#111111" fill="#111111"'))).toEqual(["flat paint #111111"]);
      expect(markFaults(frame('<rect x="0" y="0" width="48" height="48"/><circle cx="24" cy="24" r="10" fill="none" stroke="currentColor" stroke-width="2"/>', ' color="#111111" fill="#111111"'))).toEqual(["flat paint #111111"]);
      expect(markFaults(frame(plate("#111111") + '<g><text x="24" y="30" fill="#111111">E</text></g>'))).toEqual(["flat paint #111111"]);
    });

    it("lets a symbol-only single-ink mark and a two-ink badge through", () => {
      expect(markFaults(frame(symbol("currentColor"), ' color="#111111"'), { ground: "#ffffff", contrast: true })).toEqual([]);
      expect(markFaults(frame(plate("#111111") + symbol("#ffffff")), { contrast: true })).toEqual([]);
      expect(markFaults(frame(plate("#111111") + symbol("#ffffff") + '<defs>' + symbol("#111111") + '</defs>'), { contrast: true })).toEqual([]);
    });

    it("tells a plate from a ring or a small shape of its own ink", () => {
      expect(markFaults(frame('<circle cx="24" cy="24" r="22" fill="none" stroke="#111111" stroke-width="2"/>' + symbol("#111111")))).toEqual([]);
      expect(markFaults(frame('<rect x="4" y="4" width="20" height="20" fill="#111111"/>' + symbol("#111111")))).toEqual([]);
    });

    it("sees an inked plate inset in a larger viewBox, as the standard app icon draws it", () => {
      const standard = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect x="16" y="16" width="480" height="480" rx="104" fill="#111111"/>${inner}</svg>`;
      expect(markFaults(standard('<circle cx="256" cy="256" r="80" fill="#111111"/>'))).toEqual(["flat paint #111111"]);
      expect(markFaults(standard('<circle cx="256" cy="256" r="80" fill="#ffffff"/>'))).toEqual([]);
    });

    it("scores every SVG role of the producer-derived library and names the members that flatten", () => {
      const library = consumerLibrary(), failing: Record<string, string[]> = {}, seen = new Set<string>();
      for (const slot of assetSlots.filter(candidateSlot => candidateSlot.id === "assets.mark" || candidateSlot.id === "assets.lockup" || candidateSlot.id === "assets.favicon" || candidateSlot.id === "assets.app-icon")) {
        for (const candidate of buildCandidates({ catalog, library, working: library, slotId: slot.id, scope: "slot", target: slot.id })) for (const entry of candidate.members) {
          if (entry.member.$type !== "svg") continue;
          const role = entry.id.slice(slot.id.length + 1), svg = entry.member.value.light as string;
          seen.add(`${slot.id.slice("assets.".length)}.${role}`);
          const faults = artworkFaults(slot.id === "assets.favicon" ? "favicon" : slot.id === "assets.app-icon" ? "app-icon" : "logo", svg).filter(fault => fault.includes("flat paint"));
          if (faults.length) (failing[`${slot.id.slice("assets.".length)}.${role}`] ??= []).push(`${entry.id} (${candidate.source}): ${faults.join("; ")}`);
        }
      }
      // Every role the producer derives must have been scored; the ratchet is empty, so a flat member is a failure, not a waiver.
      expect([...seen].sort()).toEqual(["app-icon.maskable", "app-icon.standard", "favicon.vector", "lockup.positive", "lockup.reversed", "mark.mono", "mark.positive", "mark.reversed"]);
      expect(failing).toEqual({});
    });
  });

  describe("favicon and app-icon artwork", () => {
    const candidateOf = (slot: string, role: string, svg: string): Candidate => ({ index: 0, source: "example", selected: true, previewable: true, usable: true, errors: 0, findings: [], inUseByDefault: false,
      fill: {} as Candidate["fill"], members: [{ id: `${slot}.${role}`, member: { slot, source: "example", fill: `example/${slot}`, via: "authored", $type: "svg", value: { light: svg }, css: { light: svg }, alias: {} } }] } as unknown as Candidate);
    const rowOf = (slot: string, role: string, svg: string): Row => { const candidate = candidateOf(slot, role, svg); return specimenRow(candidate, candidate.members[0]!); };
    const favicon = (color: string, fill: string, dark = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" color="${color}" fill="${fill}">${dark}<rect x="0" y="0" width="48" height="48"/><circle cx="24" cy="24" r="10" fill="currentColor"/></svg>`;
    const badge = (plate: string, symbol: string, shape = '<rect width="512" height="512"') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${shape} fill="${plate}"/><circle cx="256" cy="256" r="80" fill="${symbol}"/></svg>`;

    it("reports a favicon whose symbol is its plate's ink, in either colour scheme", () => {
      expect(rowOf("assets.favicon", "vector", favicon("#111111", "#111111")).faults).toContain("flat paint #111111");
      const dark = favicon("#ffffff", "#111111", "<style>@media (prefers-color-scheme: dark){svg{color:#111111;fill:#111111}}</style>");
      expect(rowOf("assets.favicon", "vector", dark).faults).toEqual(["dark: flat paint #111111"]);
      expect(rowOf("assets.favicon", "vector", favicon("#ffffff", "#111111", "<style>@media (prefers-color-scheme: dark){svg{color:#111111;fill:#ffffff}}</style>")).faults).toEqual([]);
    });

    it("reports a favicon or app icon whose symbol is too close to its plate or, with no plate, to the ground it sits on", () => {
      expect(rowOf("assets.favicon", "vector", favicon("#222222", "#111111")).faults).toEqual(["#222222 on plate #111111"]);
      expect(rowOf("assets.favicon", "vector", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="10" fill="#ffffff"/></svg>').faults.some(fault => fault.startsWith("#ffffff on "))).toBe(true);
      expect(rowOf("assets.app-icon", "standard", badge("#111111", "#111111")).faults).toEqual(["flat paint #111111"]);
      expect(rowOf("assets.app-icon", "maskable", badge("#111111", "#222222")).faults).toEqual(["#222222 on plate #111111"]);
      expect(rowOf("assets.app-icon", "maskable", badge("#111111", "#ffffff")).faults).toEqual([]);
      expect(rowOf("assets.app-icon", "standard", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="80" fill="#ffffff"/></svg>').faults.some(fault => fault.startsWith("#ffffff on "))).toBe(true);
    });
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
