/** @vitest-environment jsdom */
/**
 * WIRE-5b (E4): specimens hold no raw literals. Every layer's specimen content (tokens, assets, components,
 * Sections and Frames) is drawn from the one deterministic synthetic dataset and rendered through a registered
 * Foundry part; the value under review reaches it only as a reason-coded override.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import ts from "typescript";
import { checkWiring } from "../catalog-core/wiring.js";
import { importFoundryFrames, importFoundrySections, loadBuildCatalog, loadComponentCompositionRules, planSurfaceDefaults } from "../catalog-core/index.js";
import type { CompositeResolved, ResolvedComponent, SurfaceDefaultCandidateDocument, SurfaceDefaultsInput } from "../catalog-core/index.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import * as components from "../components/index.js";
import * as charts from "../charts/index.js";
import * as shell from "../shell/index.js";
import { PATTERN_RECIPES } from "../tokens/pattern.js";
import { SPECIMEN_OVERRIDE_REASONS, TOKEN_LEAF_SPECIMENS, TokenLeafSpecimen, tokenLeafSpecimenKind } from "../tokens/preview/specimens.js";
import { IconSpecimen, ImageSpecimen, PatternSpecimen, RatioSpecimen, SvgSpecimen } from "./asset-specimens.js";
import { buildCandidates } from "./model.js";
import { CandidateCell } from "./CandidateCell.js";
import { componentSpecimenPreview } from "./component-specimens.js";
import { componentSpecimenSample } from "./component-specimen-samples.js";
import { catalog, labels } from "./__fixtures__/studio.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import { planSurfacePreviews } from "./planned-surface-previews.js";
import * as surfaceContent from "./surface-preview-sample-content.js";
import { specimenDataset } from "./specimen-dataset.js";

afterEach(cleanup);

/** The specimen render files WIRE-5b owns (packet Allowed), relative to `src/`. */
const RENDER_FILES = [
  "tokens/preview/specimens.tsx",
  "studio/asset-specimens.tsx",
  "studio/component-specimens.tsx",
  "studio/component-specimen-samples.tsx",
  "studio/component-specimen-contained.tsx",
  "studio/previews.tsx",
  "studio/frame-preview.tsx",
  "studio/planned-surface-previews.tsx",
  "studio/surface-preview-samples.tsx",
  "studio/ratio-fixture.tsx",
] as const;
const read = (file: string) => readFileSync(fileURLToPath(new URL("../" + file, import.meta.url)), "utf8");

describe("WL4: no raw values in the specimen files", () => {
  it("reports no WL4 finding over every WIRE-5b render file", () => {
    const result = checkWiring({ sources: RENDER_FILES.map(file => ({ path: "src/" + file, content: read(file), layer: "sections" as const })) });
    expect(result.findings.filter(row => row.code === "WL4").map(row => `${row.file}:${row.line} ${row.evidence}`)).toEqual([]);
  });
});

/** Attributes whose string values are structure (classes, enums, geometry, ids), never shown copy. */
const STRUCTURAL_ATTRIBUTES = new Set([
  "className", "variant", "size", "as", "position", "ground", "measure", "kind", "presentation", "placement", "wide", "type", "tone", "role",
  "preserveAspectRatio", "viewBox", "d", "fill", "stroke", "strokeDasharray", "vectorEffect", "focusable", "aria-hidden", "key", "id", "href",
  "src", "srcLang", "preload", "orientation", "buttonVariant", "format", "status", "slot", "headingLevel", "media",
]);
/** SVG drawing attributes may carry plain geometry numbers. */
const GEOMETRY_ATTRIBUTES = new Set(["cx", "cy", "r", "x", "y", "width", "height", "strokeWidth", "opacity"]);
/** Object keys whose values are shown copy. */
const CONTENT_KEY = /^(?:label|title|heading|description|caption|eyebrow|placeholder|alt|message|quote|question|answer|body|name|text|content|summary|value|meta|badge|delta|cta|price|trigger)$|(?:Label|Text|Message|Title|Note|(?<!class)Name|Role)$/;
const LETTERS = /[A-Za-z]/;
/** Shown copy: a capitalised word followed by another (an export, pointer, enum or class list is not). */
const PROSE = /^\W*[A-Z][A-Za-z'’]*[ ,.;:!?]+[A-Za-z]/;

/** The literal text of a string or template literal (template holes dropped). */
function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(" ");
  return undefined;
}

/** Where a literal's value lands: a JSX attribute (by name), a JSX child, an object key, or nowhere rendered. */
function landing(node: ts.Node): { kind: "attribute"; name: string } | { kind: "child" } | { kind: "key"; name: string } | undefined {
  let current: ts.Node = node;
  for (let parent = current.parent; parent; current = parent, parent = parent.parent) {
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent)) continue;
    if (ts.isConditionalExpression(parent) && current !== parent.condition) continue;
    if (ts.isBinaryExpression(parent) && current === parent.right && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind)) continue;
    if (ts.isJsxExpression(parent)) continue;
    if (ts.isJsxAttribute(parent)) return { kind: "attribute", name: parent.name.getText() };
    if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) return { kind: "child" };
    if (ts.isPropertyAssignment(parent) && current === parent.initializer) return { kind: "key", name: parent.name.getText().replace(/^["']|["']$/g, "") };
    // A default initializer (`playLabel = "Play"`) lands under its binding's name.
    if ((ts.isBindingElement(parent) || ts.isParameter(parent) || ts.isVariableDeclaration(parent)) && current === parent.initializer && ts.isIdentifier(parent.name)) return { kind: "key", name: parent.name.text };
    return undefined;
  }
  return undefined;
}

/** True inside the one audited override door (`specimenOverride`), which is the only place a style may be built. */
const insideOverrideDoor = (node: ts.Node): boolean => {
  for (let parent = node.parent; parent; parent = parent.parent) if (ts.isFunctionDeclaration(parent) && parent.name?.text === "specimenOverride") return true;
  return false;
};

/** Literal sample text, numbers and styles a specimen file renders directly instead of drawing from the dataset. */
function literals(file: string, inline?: string): string[] {
  const text = inline ?? read(file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const at = (node: ts.Node, what: string) => found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${what}`);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isJsxText(node) && LETTERS.test(node.text)) at(node, `JSX text ${JSON.stringify(node.text.trim())}`);
    if (ts.isJsxAttribute(node) && node.name.getText() === "style") at(node, "inline style attribute (use specimenOverride)");
    if (ts.isPropertyAssignment(node) && node.name.getText() === "style" && !insideOverrideDoor(node)) at(node, "style object outside specimenOverride");
    const value = literalText(node);
    if (value !== undefined && LETTERS.test(value) && !ts.isTemplateSpan(node.parent)) {
      const where = landing(node);
      const shown = where?.kind === "child"
        || (where?.kind === "attribute" && !STRUCTURAL_ATTRIBUTES.has(where.name) && !where.name.startsWith("data-"))
        || (where?.kind === "key" && CONTENT_KEY.test(where.name));
      const structural = where?.kind === "attribute" && (STRUCTURAL_ATTRIBUTES.has(where.name) || where.name.startsWith("data-"));
      if (shown) at(node, `literal sample text ${JSON.stringify(value)}`);
      else if (!structural && PROSE.test(value)) at(node, `literal copy ${JSON.stringify(value)}`);
    }
    if (ts.isNumericLiteral(node) && Number(node.text) !== 0 && Number(node.text) !== 1) {
      const where = landing(node);
      const element = ts.findAncestor(node, candidate => ts.isJsxSelfClosingElement(candidate) || ts.isJsxOpeningElement(candidate)) as ts.JsxOpeningLikeElement | undefined;
      const svg = element && /^[a-z]/.test(element.tagName.getText()) && GEOMETRY_ATTRIBUTES.has(where?.kind === "attribute" ? where.name : "");
      if ((where?.kind === "attribute" && where.name !== "headingLevel" && !svg) || (where?.kind === "key" && CONTENT_KEY.test(where.name))) at(node, `raw number ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("no literal sample text or raw values in the specimen files", () => {
  it("finds none: every specimen file draws its copy and numbers from the dataset", () => {
    expect(RENDER_FILES.flatMap(file => literals(file))).toEqual([]);
  });

  it("catches a literal put back (the scan is live)", () => {
    expect(literals("probe.tsx", "export const P = () => <Card>Northwind</Card>;")).toHaveLength(1);
    expect(literals("probe.tsx", "export const P = () => <Pagination page={2} />;")).toHaveLength(1);
    expect(literals("probe.tsx", "export const P = () => <Faq heading=\"Questions\" />;")).toHaveLength(1);
    expect(literals("probe.tsx", "export const P = () => <span style={{ height: 48 }} />;")).not.toEqual([]);
    expect(literals("probe.tsx", "export const P = () => <span className=\"block size-lg\" data-kind=\"motion\" />;")).toEqual([]);
  });
});

/** Every object and array node of the dataset, and every primitive value in it. */
function datasetIndex() {
  const nodes = new Set<unknown>(), primitives = new Set<unknown>();
  const walk = (value: unknown) => {
    if (value !== null && typeof value === "object") {
      if (nodes.has(value)) return;
      nodes.add(value);
      for (const child of Object.values(value)) walk(child);
    } else primitives.add(value);
  };
  walk(specimenDataset);
  return { nodes, primitives };
}
function unfed(value: unknown, path: string, index = datasetIndex()): string[] {
  if (index.nodes.has(value)) return [];
  if (Array.isArray(value)) return [`${path}: inline array`];
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => unfed(child, `${path}.${key}`, index));
  return index.primitives.has(value) ? [] : [`${path}: inline ${JSON.stringify(value)}`];
}

function realPlan() {
  const slots = loadBuildCatalog().slots.filter(slot => slot.layer === "sections" || slot.layer === "frames") as SurfaceDefaultsInput["catalog"]["slots"];
  const fills: SurfaceDefaultCandidateDocument[] = [...importFoundrySections().fills, ...importFoundryFrames().fills];
  return { fills, plan: planSurfaceDefaults({ catalog: { slots, fills }, slots: slots.map(slot => slot.id), preference: ["foundry"] }) };
}

/** Rendered strings of one dataset subtree, escaped the way SSR writes them. */
function datasetStrings(root: unknown): string[] {
  const strings = new Set<string>();
  const walk = (value: unknown, seen = new Set<unknown>()) => {
    if (typeof value === "string" && value.length > 3 && LETTERS.test(value)) strings.add(value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/'/g, "&#x27;"));
    else if (value !== null && typeof value === "object" && !seen.has(value)) { seen.add(value); for (const child of Object.values(value)) walk(child, seen); }
  };
  walk(root);
  return [...strings];
}

describe("one dataset feeds every layer", () => {
  it("carries all five layers in the one deterministic dataset", () => {
    for (const layer of ["tokens", "assets", "sections", "frames"] as const) expect(Object.keys(specimenDataset), layer).toContain(layer);
    // Components are fed from the dataset's per-component records (component-specimen-dataset.test.tsx).
    expect(specimenDataset.table.rows.length).toBeGreaterThan(0);
    expect(specimenDataset.tokens.sampleText.trim().split(/\s+/).length).toBeGreaterThan(2);
  });

  it("addresses every Section and Frame sample into the dataset: no second copy", () => {
    const exportsFed = Object.fromEntries(Object.entries(surfaceContent).filter(([name]) => name !== "SURFACE_SAMPLE_STATES"));
    expect(Object.keys(exportsFed).length).toBeGreaterThan(10);
    expect(Object.entries(exportsFed).flatMap(([name, value]) => unfed(value, name))).toEqual([]);
  });

  it("renders every Studio-owned Section and Frame preview with dataset content", () => {
    const { plan, fills } = realPlan();
    const result = planSurfacePreviews({ plan, fills });
    const previews = Object.values(result.previews);
    expect(previews.filter(preview => preview.slot.startsWith("sections."))).toHaveLength(45);
    expect(previews.filter(preview => preview.slot.startsWith("frames."))).toHaveLength(8);
    const strings = datasetStrings({ sections: specimenDataset.sections, frames: specimenDataset.frames });
    const unfedSlots = previews.filter(preview => {
      const html = renderToStaticMarkup(createElement("div", null, preview.render()));
      return !strings.some(value => html.includes(value));
    }).map(preview => preview.slot);
    expect(unfedSlots).toEqual([]);
  });
});

const signed = completedTokenLibrary(catalog, { id: "specimen-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-25");
const membersOf = (slotId: string) => buildCandidates({ catalog, library: signed, working: signed, scope: "slot", target: slotId, slotId }).find(entry => entry.selected)?.members ?? [];

/**
 * Every override a specimen draws is marked and carries a reason from the closed list, and sets custom properties
 * only. (A registered part's own internal styles are its business; the static scan bans styles in specimen files.)
 */
function overrideFaults(root: Element, label: string): string[] {
  const marked = [...root.querySelectorAll<HTMLElement>("[data-specimen-override],[data-override-reason]"), ...(root.matches("[data-specimen-override],[data-override-reason]") ? [root as HTMLElement] : [])];
  return marked.flatMap(element => {
    const reason = element.getAttribute("data-override-reason");
    const faults: string[] = [];
    if (!element.hasAttribute("data-specimen-override") || !(SPECIMEN_OVERRIDE_REASONS as readonly (string | null)[]).includes(reason)) faults.push(`${label}: <${element.tagName.toLowerCase()}> override without a listed reason (${reason ?? "none"})`);
    const style = element.style;
    for (let index = 0; index < style.length; index++) if (!style.item(index).startsWith("--")) faults.push(`${label}: override sets ${style.item(index)}, not a custom property`);
    return faults;
  });
}

describe("specimen role and reason-coded overrides", () => {
  it("stamps every token specimen with data-layer=\"tokens\" and applies the member only as a reason-coded override", () => {
    const faults: string[] = [], kinds = new Set<string>(), cells: ReactElement[] = [];
    for (const slotId of Object.keys(TOKEN_LEAF_SPECIMENS)) for (const { id, member } of membersOf(slotId)) {
      const kind = tokenLeafSpecimenKind(member);
      if (!kind) continue;
      kinds.add(kind);
      cells.push(createElement("div", { key: id, "data-cell": id }, createElement(TokenLeafSpecimen, { id, member })));
    }
    // One commit for every member: each cell's first child is that member's specimen root.
    const { container, unmount } = render(createElement("div", null, cells));
    for (const cell of container.querySelectorAll<HTMLElement>("[data-cell]")) {
      const id = cell.dataset.cell!, root = cell.firstElementChild!;
      if (root.getAttribute("data-layer") !== "tokens") faults.push(`${id}: root data-layer ${root.getAttribute("data-layer")}`);
      if (root.getAttribute("data-override-reason") !== "token-under-review") faults.push(`${id}: the member value is not a token-under-review override`);
      faults.push(...overrideFaults(root, id));
    }
    unmount();
    expect(cells.length).toBeGreaterThan(20);
    expect(faults).toEqual([]);
    expect([...kinds].sort()).toEqual(["blur", "density", "focus", "gradient", "icon", "layer-fan", "motion", "opacity", "radius", "ruler", "shadow", "text-metric"]);
  }, 60_000);

  it("draws token sample text from the dataset when the host gives none", () => {
    const [entry] = membersOf("tokens.line-height");
    const { container } = render(createElement(TokenLeafSpecimen, { id: entry!.id, member: entry!.member }));
    expect(container.textContent).toContain(specimenDataset.tokens.sampleText);
  });

  it("draws the dataset sample in every Studio text-metric and focus cell, never the host's label copy", () => {
    const leaves = Object.entries(TOKEN_LEAF_SPECIMENS).filter(([, kind]) => kind === "text-metric" || kind === "focus").map(([slot]) => slot);
    expect(leaves).toHaveLength(12);
    const sample = specimenDataset.tokens.sampleText, firstWord = sample.trim().split(/\s+/)[0]!;
    const faults: string[] = [];
    let drawn = 0;
    for (const slot of leaves) {
      const candidate = buildCandidates({ catalog, library: signed, working: signed, scope: "slot", target: slot, slotId: slot }).find(entry => entry.selected);
      if (!candidate) { faults.push(`${slot}: no selected fill`); continue; }
      const { container, unmount } = render(createElement(CandidateCell, { candidate, labels }));
      const targets = [...container.querySelectorAll("figure[data-kind='text-metric'] [data-specimen-target], figure[data-kind='focus'] [data-specimen-target]")];
      if (targets.length === 0) faults.push(`${slot}: no text specimen drawn`);
      for (const target of targets) {
        drawn++;
        const text = target.textContent ?? "";
        if (text !== sample && text !== firstWord) faults.push(`${slot}: draws ${JSON.stringify(text)}`);
      }
      unmount();
    }
    expect(faults).toEqual([]);
    expect(drawn).toBeGreaterThanOrEqual(leaves.length);
  }, 60_000);

  it("stamps every asset specimen with data-layer=\"assets\" and reason-codes its overrides", () => {
    const { mark, glyph } = specimenDataset.assets;
    const specimens: Record<string, ReactElement> = {
      favicon: createElement(SvgSpecimen, { id: "assets.favicon.default", slot: "assets.favicon", svg: mark.svg }),
      appIcon: createElement(SvgSpecimen, { id: "assets.app-icon.maskable", slot: "assets.app-icon", svg: mark.svg }),
      logo: createElement(SvgSpecimen, { id: "assets.logo.positive", slot: "assets.logo", svg: mark.svg }),
      icon: createElement(IconSpecimen, { glyph: glyph.glyph, name: glyph.slot }),
      ratio: createElement(RatioSpecimen, { width: 3, height: 2 }),
      pattern: createElement(PatternSpecimen, { recipe: PATTERN_RECIPES.dots }),
      image: createElement(ImageSpecimen, { image: { kind: "illustration", src: mark.src, width: 3, height: 2, alt: mark.name } }),
    };
    const faults = Object.entries(specimens).flatMap(([name, element]) => {
      const { container, unmount } = render(element);
      const root = container.firstElementChild!;
      const out = [...root.getAttribute("data-layer") === "assets" ? [] : [`${name}: root data-layer ${root.getAttribute("data-layer")}`], ...overrideFaults(root, name)];
      unmount();
      return out;
    });
    expect(faults).toEqual([]);
  });
});

/**
 * Leaves of the Frames layer that have no runtime renderer yet. They belong to F-SF-RUNTIME (lane L9), which gives
 * them one; until then they are listed here by name rather than stubbed. Every other leaf on every layer fills.
 */
const FRAMES_RUNTIME_OWNED: readonly string[] = ["frames.site-shell"];

/** A registered token or asset leaf fills when its Studio cell draws a real specimen: never only its value as text, never "unsupported". */
const SPECIMEN = "[data-token-specimen],[data-studio-color-swatch],[data-preview-kind='swatch'],[data-preview-kind='font'],[data-preview-kind='ruler'],[data-token-preview-motion],[data-asset-specimen]";
/** A stand-in: an "unsupported" note, or the generic preview's status output in place of a specimen. */
const STAND_IN = "[data-preview-kind^='unsupported'],output[role='status'][data-property]";

describe("every leaf on all five layers renders its registered fill from the dataset", () => {
  it("fills Tokens, Assets, Components, Sections and Frames edge to edge", () => {
    const build = loadBuildCatalog();
    const slotsOf = (layer: string) => build.slots.filter(slot => slot.layer === layer).map(slot => slot.id);
    const gaps: Record<string, Record<string, string>> = {}, totals: Record<string, number> = {};
    const gap = (layer: string, slot: string, reason: string) => { (gaps[layer] ??= {})[slot] = reason; };

    // Tokens and Assets: the Studio's own cell for the selected fill of a library that fills every leaf.
    const library = completedCatalogLibrary(catalog, { id: "edge-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-25");
    for (const layer of ["tokens", "assets"] as const) {
      const slots = slotsOf(layer);
      totals[layer] = slots.length;
      for (const slot of slots) {
        const candidate = buildCandidates({ catalog, library, working: library, scope: "slot", target: slot, slotId: slot }).find(entry => entry.selected);
        if (!candidate || candidate.members.length === 0) { gap(layer, slot, "no selected fill"); continue; }
        const { container, unmount } = render(createElement(CandidateCell, { candidate, labels }));
        if (container.querySelector(STAND_IN)) gap(layer, slot, "unsupported stand-in");
        else if (!container.querySelector(SPECIMEN)) {
          const first = candidate.members[0]!.member;
          gap(layer, slot, `no specimen drawn (previewable ${candidate.previewable}, ${first.$type} ${JSON.stringify(first.css.light)}, kinds ${[...container.querySelectorAll("[data-preview-kind],[data-token-preview]")].map(node => node.getAttribute("data-preview-kind") ?? "token-preview").join("|") || "none"})`);
        }
        unmount();
      }
    }

    // Components: the registered implementation fill drawn by the live specimen host with dataset content.
    const strings = datasetStrings(specimenDataset);
    const modules = { "@clossys/designer/components": components, "@clossys/designer/charts": charts, "@clossys/designer/shell": shell };
    const specimens = componentSpecimenPreview({ modules });
    const fills = [...loadCatalogBundles().componentFills.flatMap(doc => Object.values(doc.components)), ...loadComponentCompositionRules().map(rule => rule.template)];
    // Every string the dataset holds, short ones included (a key cap is two characters).
    const anyDatasetString = new Set<string>();
    const collect = (value: unknown, seen = new Set<unknown>()): void => {
      if (typeof value === "string") anyDatasetString.add(value);
      else if (value !== null && typeof value === "object" && !seen.has(value)) { seen.add(value); for (const child of Object.values(value)) collect(child, seen); }
    };
    collect(specimenDataset);
    const drawsDataset = (value: unknown, seen = new Set<unknown>()): boolean => typeof value === "string" ? anyDatasetString.has(value)
      : value !== null && typeof value === "object" && !seen.has(value) && (seen.add(value), Object.values(value).some(child => drawsDataset(child, seen)));
    const componentSlots = slotsOf("components");
    totals.components = componentSlots.length;
    for (const slot of componentSlots) {
      const fill = fills.find(candidate => candidate.slot === slot && candidate.source === "foundry" && candidate.impl.kind === "package");
      if (!fill) {
        // A leaf Foundry fills by composition, or only a vendored source fills, draws its source entry's designer sample.
        // component-specimens-adopted.test.tsx compiles that source and renders it; here the sample must come from the dataset.
        const source = fills.find(candidate => candidate.slot === slot && candidate.impl.kind === "source");
        if (!source || source.impl.kind !== "source") { gap("components", slot, "no registered fill"); continue; }
        const sample = componentSpecimenSample(`${source.impl.entry}#${source.impl.export}`, undefined, {});
        if (!sample || !drawsDataset({ props: sample.props, children: sample.children })) gap("components", slot, `source sample ${source.impl.entry} draws no dataset content`);
        continue;
      }
      const component = { slot, originKind: "adopted", origin: { kind: "adopted", source: "foundry" }, impl: fill.impl, propMap: fill.propMap, reads: { tokens: {}, assets: [], components: [] }, descriptor: fill } as unknown as ResolvedComponent;
      const profile = { selectionHash: `selection-${slot}`, components: { components: { [slot]: component } } } as unknown as CompositeResolved;
      const drawn = specimens.preview(slot, profile);
      if (!drawn) { gap("components", slot, "specimen host refused"); continue; }
      const html = renderToStaticMarkup(createElement("div", null, drawn));
      if (html.includes(`>${slot}<`) || !strings.some(value => html.includes(value))) gap("components", slot, "no dataset content");
    }

    // Sections and Frames: the planned Foundry fill's package preview, with dataset content.
    const { plan, fills: surfaceFills } = realPlan();
    const planned = planSurfacePreviews({ plan, fills: surfaceFills });
    const surfaceStrings = datasetStrings({ sections: specimenDataset.sections, frames: specimenDataset.frames });
    for (const layer of ["sections", "frames"] as const) {
      const slots = slotsOf(layer);
      totals[layer] = slots.length;
      for (const slot of slots) {
        const preview = planned.previews[slot];
        if (!preview) { gap(layer, slot, planned.unrenderable.find(row => row.slot === slot)?.reason ?? "not planned"); continue; }
        const html = renderToStaticMarkup(createElement("div", null, preview.render()));
        if (!surfaceStrings.some(value => html.includes(value))) gap(layer, slot, "no dataset content");
      }
    }

    const counts = Object.fromEntries(Object.entries(totals).map(([layer, total]) => [layer, `${total - Object.keys(gaps[layer] ?? {}).length}/${total}`]));
    console.info(`specimen leaves filled per layer: ${JSON.stringify(counts)}`);
    const runtimeOwned = Object.keys(gaps.frames ?? {}).filter(slot => FRAMES_RUNTIME_OWNED.includes(slot));
    for (const slot of runtimeOwned) delete gaps.frames![slot];
    expect(totals).toEqual({ tokens: 55, assets: 48, components: 59, sections: 45, frames: 9 });
    expect(Object.fromEntries(Object.entries(gaps).filter(([, rows]) => Object.keys(rows).length > 0))).toEqual({});
    expect(runtimeOwned).toEqual(FRAMES_RUNTIME_OWNED);
  }, 240_000);
});
