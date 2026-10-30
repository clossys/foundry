import { specimenLayoutNeeds, type SpecimenAxis, type SpecimenItem, type SpecimenLeafDefinition, type SpecimenLeafProps } from "./specimen-layouts.js";
import { SPECIMEN_KIND_MAP, resolveSpecimenLeafBinding, type SpecimenCellKind } from "./specimen-kind-map.js";

export type SpecimenAgent = "director" | "writer" | "designer" | "publisher";
export interface SpecimenCoverageCell extends SpecimenCellKind {
  readonly agent: SpecimenAgent;
  readonly id: string;
  readonly items: readonly SpecimenItem[];
  readonly axes?: readonly SpecimenAxis[];
  readonly sourceText?: string;
}
/** Produced independently from the actual source registry, including variants omitted by cell data. */
export interface RegisteredSpecimenCases {
  readonly items: readonly SpecimenItem[];
  readonly axes?: readonly SpecimenAxis[];
}
export interface SpecimenCoverageFinding {
  readonly agent: SpecimenAgent;
  readonly cell: string;
  readonly code: string;
  readonly section?: string;
  readonly item?: string;
}
export interface SpecimenDomCaseEvidence {
  readonly section: string;
  readonly item: string;
  readonly issues: readonly string[];
  readonly livePage: boolean;
}
export interface SpecimenDomEvidence {
  readonly agent: SpecimenAgent;
  readonly cell: string;
  readonly surface: "row" | "expanded" | "linkout";
  readonly issues: readonly string[];
  readonly cases: readonly SpecimenDomCaseEvidence[];
}
export interface SpecimenAgentCoverage {
  readonly agent: SpecimenAgent;
  readonly cells: number;
  /** null means at least one cell's binding or source cases could not be enumerated. */
  readonly expectedCases: number | null;
  readonly registeredCases: number;
  readonly renderedCases: number;
  readonly pass: boolean;
}
export interface SpecimenCoverageReport {
  readonly pass: boolean;
  readonly exitCode: 0 | 1;
  readonly agents: readonly SpecimenAgentCoverage[];
  readonly findings: readonly SpecimenCoverageFinding[];
}
const agents: readonly SpecimenAgent[] = ["director", "writer", "designer", "publisher"];
const coordinateKey = (coordinates: Readonly<Record<string, string>>) => JSON.stringify(Object.entries(coordinates).sort(([a], [b]) => a.localeCompare(b)));
const itemKey = (item: SpecimenItem) => JSON.stringify([item.id, coordinateKey(item.coordinates ?? {})]);
function dataKey(value: unknown, seen = new Set<object>()): string | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  let result: string | undefined;
  if (Array.isArray(value)) {
    const parts = value.map(entry => dataKey(entry, seen));
    if (parts.every(part => part !== undefined)) result = `[${parts.join(",")}]`;
  } else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
    const parts = Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => {
      const part = dataKey(entry, seen);
      return part === undefined ? undefined : `${JSON.stringify(key)}:${part}`;
    });
    if (parts.every(part => part !== undefined)) result = `{${parts.join(",")}}`;
  }
  seen.delete(value);
  return result;
}

function axisCoordinates(axes: readonly SpecimenAxis[]): readonly string[] | undefined {
  let combinations: Record<string, string>[] = [{}];
  const ids = new Set<string>();
  for (const axis of axes) {
    if (!axis.id || !axis.label || ids.has(axis.id) || !Array.isArray(axis.values) || !axis.values.length) return undefined;
    ids.add(axis.id);
    const values = new Set<string>();
    for (const value of axis.values) {
      if (!value.id || !value.label || values.has(value.id)) return undefined;
      values.add(value.id);
    }
    combinations = combinations.flatMap(coordinates => axis.values.map(value => ({ ...coordinates, [axis.id]: value.id })));
  }
  return combinations.map(coordinateKey);
}

/** Pure check. Cells and registeredCases must come from native IA and registry inputs, not a second manifest. */
export function validateSpecimenCoverage(input: {
  readonly cells: readonly SpecimenCoverageCell[];
  readonly registry: readonly SpecimenLeafDefinition[];
  readonly registeredCases: (cell: SpecimenCoverageCell, leaf: SpecimenLeafDefinition) => RegisteredSpecimenCases | undefined;
  /** Native props are required when a leaf exposes capability validation. */
  readonly leafProps?: (cell: SpecimenCoverageCell, leaf: SpecimenLeafDefinition) => SpecimenLeafProps | undefined;
  readonly evidence: readonly SpecimenDomEvidence[];
}): SpecimenCoverageReport {
  const findings: SpecimenCoverageFinding[] = [];
  const add = (cell: SpecimenCoverageCell, code: string, item?: string) => findings.push({ agent: cell.agent, cell: cell.id, code, ...(item === undefined ? {} : { item }) });
  const summaries = agents.map(agent => {
    const cells = input.cells.filter(cell => cell.agent === agent);
    let expectedCases: number | null = 0, registeredCases = 0, renderedCases = 0;
    const before = findings.length;
    if (!cells.length) findings.push({ agent, cell: "", code: "missing-agent-input" });
    const ids = new Set<string>();
    for (const cell of cells) {
      const beforeCell = findings.length;
      if (!cell.id || ids.has(cell.id)) add(cell, "duplicate-or-empty-cell");
      ids.add(cell.id);
      const binding = resolveSpecimenLeafBinding(cell, input.registry);
      if ("error" in binding) { add(cell, binding.error); expectedCases = null; continue; }
      const leaf = binding.leaf;
      const nativeKind = SPECIMEN_KIND_MAP.find(entry => entry.kind === cell.kind && (entry.layer === undefined || entry.layer === cell.layer));
      if (!nativeKind || agent !== nativeKind.agent) add(cell, "agent-specimen-mismatch");
      if (!["single", "ladder", "grid", "matrix"].includes(leaf.layout)) add(cell, "missing-or-invalid-layout");
      if (typeof leaf.render !== "function") add(cell, "unrenderable-specimen-leaf");
      if (!Array.isArray(cell.items) || !cell.items.length) add(cell, "empty-specimen-items");
      if (leaf.validate || leaf.requirements?.length) {
        const props = input.leafProps?.(cell, leaf);
        if (!props) add(cell, "missing-native-leaf-props");
        else {
          const actual = { ...props, items: cell.items, axes: cell.axes };
          for (const need of [...specimenLayoutNeeds({ ...actual, id: leaf.id, layout: leaf.layout }), ...(leaf.validate?.(actual) ?? [])]) add(cell, `leaf-need:${need.reason}`);
        }
      }
      const expected = input.registeredCases(cell, leaf);
      if (!expected?.items.length) { add(cell, "missing-registered-cases"); expectedCases = null; continue; }
      const axes = expected.axes ?? [];
      const combinations = axisCoordinates(axes);
      if (!combinations || (expected.items.length > 1 && leaf.layout === "matrix" && axes.length < 2)) {
        add(cell, "missing-or-invalid-axes"); expectedCases = null; continue;
      }
      if (JSON.stringify(cell.axes ?? []) !== JSON.stringify(axes)) add(cell, "cell-registry-axes-mismatch");
      // A single item is valid on every leaf and renders without layout chrome. Matrices with many items require every axis combination.
      const expectedCoordinates = new Set(combinations);
      const seenCoordinates = new Set<string>(), expectedKeys = new Set<string>(), expectedIds = new Set<string>();
      for (const item of expected.items) {
        const coordinates = coordinateKey(item.coordinates ?? {});
        if (!item.id || !item.label || dataKey(item.value) === undefined || expectedIds.has(item.id) || (axes.length > 0 && (!expectedCoordinates.has(coordinates) || seenCoordinates.has(coordinates)))) add(cell, "invalid-registered-case", item.id);
        expectedKeys.add(itemKey(item)); expectedIds.add(item.id); seenCoordinates.add(coordinates);
      }
      if (axes.length > 0) for (const coordinates of expectedCoordinates) if (!seenCoordinates.has(coordinates)) add(cell, "missing-registered-case", coordinates);
      if (expectedCases !== null) expectedCases += axes.length ? combinations.length : expected.items.length;
      const supplied = new Set<string>(), suppliedIds = new Set<string>();
      for (const item of cell.items ?? []) {
        const key = itemKey(item);
        if (!item.id || !item.label || item.value === undefined || suppliedIds.has(item.id) || !expectedKeys.has(key)) add(cell, "invalid-or-duplicate-case", item.id);
        const registered = expected.items.find(entry => itemKey(entry) === key);
        if (dataKey(item.value) === undefined || registered && dataKey(item.value) !== dataKey(registered.value)) add(cell, "cell-registry-value-mismatch", item.id);
        supplied.add(key); suppliedIds.add(item.id);
      }
      for (const item of expected.items) if (!supplied.has(itemKey(item))) add(cell, "missing-cell-case", item.id);
      if (findings.length !== beforeCell) continue;
      registeredCases += expected.items.length;
      const evidence = input.evidence.filter(entry => entry.agent === agent && entry.cell === cell.id);
      for (const entry of evidence) for (const issue of entry.issues) add(cell, issue);
      for (const item of expected.items) {
        const proofs = evidence.filter(entry => entry.issues.length === 0).flatMap(entry => entry.cases).filter(entry => entry.section === leaf.id && entry.item === item.id);
        const allProofs = evidence.flatMap(entry => entry.cases).filter(entry => entry.section === leaf.id && entry.item === item.id);
        if (proofs.some(entry => entry.issues.length === 0 && (agent !== "publisher" || entry.livePage))) renderedCases += 1;
        else {
          add(cell, "missing-rendered-case", item.id);
          for (const proof of proofs) for (const issue of proof.issues) add(cell, issue, item.id);
          if (agent === "publisher" && allProofs.some(entry => !entry.livePage)) add(cell, "missing-live-emitted-page", item.id);
        }
      }
    }
    return { agent, cells: cells.length, expectedCases, registeredCases, renderedCases, pass: findings.length === before && cells.length > 0 && expectedCases !== null && expectedCases > 0 && renderedCases === expectedCases };
  });
  const pass = summaries.every(summary => summary.pass);
  return { pass, exitCode: pass ? 0 : 1, agents: summaries, findings };
}

function displayed(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") return false;
    if (node.tagName === "DETAILS" && !node.hasAttribute("open") && !node.querySelector("summary")?.contains(element)) return false;
  }
  return true;
}
function sourceLeak(text: string, sourceText?: string): boolean {
  return /---\s*\n[\s\S]*?\n\s*---(?:\n|$)/.test(text)
    || /(?:originKinds|confirmed|selectionHash|\$extensions)\s*:/.test(text)
    || /```(?:ya?ml|tsx?|jsx?|json|mdx?)?\s*\n/.test(text)
    || Boolean(sourceText?.trim() && sourceText.trim().length >= 16 && text.includes(sourceText.trim()));
}
function regionText(region: Element): string {
  const walker = region.ownerDocument.createTreeWalker(region, 4);
  const text: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) text.push(node.textContent ?? "");
  return text.join("\n");
}
function contentIssues(region: Element, sourceText?: string, visitedFrames = new Set<Element>()): string[] {
  const issues = new Set<string>();
  const text = regionText(region);
  if (!displayed(region)) issues.add("hidden-specimen");
  if (!region.ownerDocument.documentElement.contains(region)) issues.add("unmounted-specimen");
  if (!text.trim() && !region.querySelector("svg,img,canvas,video,audio,iframe,input,textarea,[role='img']")) issues.add("empty-specimen");
  if (sourceLeak(text, sourceText)) issues.add("raw-source-in-specimen");
  if (/\bNEED\b/.test(text) || /(?:^|\n)\s*pending\s*(?:\n|$)|\b(?:text[- ]fallback|excerpt|placeholder)\b/i.test(text) || region.matches("[data-ds-specimen-need]") || region.querySelector("[data-ds-specimen-need],[data-preview-pending],[data-runtime-pending]")) issues.add("unresolved-specimen");
  if (region.querySelector("[contenteditable='true'],textarea:not([readonly])")) issues.add("editable-specimen");
  for (const element of [region, ...region.querySelectorAll("*")]) if (!element.closest("[data-ds-leaf]")) issues.add("outside-native-leaf");
  // Portalled surface content lives in a viewport document; the outer iframe alone is never rendered proof.
  for (const frame of region.querySelectorAll<HTMLIFrameElement>("iframe")) {
    if (visitedFrames.has(frame)) continue;
    visitedFrames.add(frame);
    try {
      const doc = frame.contentDocument;
      if (!doc || doc.readyState !== "complete") { issues.add("unverified-specimen-viewport"); continue; }
      if (!doc.body?.children.length || !doc.body.textContent?.trim() && !doc.body.querySelector("svg,img,canvas,video,audio,input,[role='img']")) { issues.add("empty-specimen-viewport"); continue; }
      if (sourceLeak(regionText(doc.body), sourceText)) issues.add("raw-source-in-specimen");
      for (const child of doc.body.children) for (const issue of contentIssues(child, sourceText, visitedFrames)) issues.add(issue);
    } catch { issues.add("unverified-specimen-viewport"); }
  }
  return [...issues];
}
function livePage(region: Element): boolean {
  return [...region.querySelectorAll<HTMLIFrameElement>("iframe")].some(frame => {
    try {
      const url = new URL(frame.src, frame.ownerDocument.URL);
      const doc = frame.contentDocument;
      const inert = frame.closest("[inert]") !== null;
      return url.protocol === "http:" && url.hostname === "127.0.0.1" && frame.hasAttribute("sandbox")
        && !frame.getAttribute("sandbox")?.split(/\s+/).some(value => value === "allow-forms" || value === "allow-top-navigation")
        && (inert || frame.tabIndex === -1 && frame.ownerDocument.defaultView?.getComputedStyle(frame).pointerEvents === "none")
        && displayed(frame) && doc?.readyState === "complete" && doc.URL !== "about:blank" && doc.URL === url.href
        && Boolean(doc.body?.textContent?.trim()) && !sourceLeak(doc.body?.textContent ?? "")
        && !/\bNEED\b/.test(regionText(doc.body)) && !/not published yet|(?:^|\n)\s*pending\s*(?:\n|$)|\bplaceholder\b/i.test(regionText(doc.body));
    } catch { return false; }
  });
}

/** Collect from real mounted regions. Closed disclosure cases remain hidden until expanded or linked out. */
export function collectSpecimenDomEvidence(input: {
  readonly cell: SpecimenCoverageCell;
  readonly root: Element;
  readonly surface: SpecimenDomEvidence["surface"];
}): SpecimenDomEvidence {
  const regions = [...(input.root.matches("[data-ds-specimen-region]") ? [input.root] : []), ...input.root.querySelectorAll("[data-ds-specimen-region]")];
  const issues = new Set<string>();
  if (!regions.length) issues.add("missing-specimen-region");
  for (const region of regions) for (const issue of contentIssues(region, input.cell.sourceText)) if (issue !== "hidden-specimen") issues.add(issue);
  const nodes = regions.flatMap(region => [...(region.matches("[data-ds-specimen-item]") ? [region] : []), ...region.querySelectorAll("[data-ds-specimen-item]")]);
  const cases = [...new Set(nodes)].map(node => ({
    section: node.closest("[data-ds-specimen-section]")?.getAttribute("data-ds-specimen-section") ?? "",
    item: node.getAttribute("data-ds-specimen-item") ?? "",
    issues: contentIssues(node, input.cell.sourceText),
    livePage: livePage(node),
  }));
  return { agent: input.cell.agent, cell: input.cell.id, surface: input.surface, issues: [...issues], cases };
}
