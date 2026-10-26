import { expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { libraryHash, loadCatalog, type FillDoc, type LibraryData } from "../catalog-core/index.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import { emptyChanges } from "./model.js";
import { matrixBoards, matrixRows } from "./matrix-model.js";
import { valueLibraryBoardPreviews } from "./library-board-adapter.js";
import { labels } from "./__fixtures__/studio.js";

/**
 * Catalog-wide token board conformance (owner rule, ledger 1505/1509/1510/1520/1530/1534):
 * one leaf cell holds MANY L4 previews, every L4 of one leaf uses the SAME specimen type,
 * no unavailable/unsupported/value-only stand-in, one visible label per member.
 *
 * NEED ratchet: leaves whose selected members still lack an off-the-shelf specimen
 * (TOKENS-FB-1 addendum 6404367982, per-leaf NEED rows). It is a report, not a waiver:
 * it must equal the actually failing leaves in BOTH directions, so a listed leaf that
 * starts passing, or an unlisted leaf that starts failing, turns this test red.
 * Label conformance has no ratchet.
 */
const SPECIMEN_NEED: readonly string[] = [
  "tokens.behavior-timing", // NEED off-the-shelf event-timeline capability with source-bound event semantics
  "tokens.blur", // NEED exact off-the-shelf blur capability
  "tokens.breakpoint", // NEED existing-component shared ruler/scale/axis contract
  "tokens.color-ramp", // NEED exact inert off-the-shelf OKLCH component
  "tokens.density", // NEED single component contract for heterogeneous gap/pad/row-height roles
  "tokens.duration", // NEED exact off-the-shelf movement target/application contract
  "tokens.easing", // NEED exact off-the-shelf movement target/application contract
  "tokens.focus-outline", // NEED exact selected focus shadow/outline application contract
  "tokens.font-size", // NEED exact selected font/metric application contract
  "tokens.font-weight", // NEED exact selected font/metric application contract
  "tokens.letter-spacing", // NEED exact selected font/metric application contract
  "tokens.line-height", // NEED paired typography component contract with actual font-size association
  "tokens.radius", // NEED exact radius application contract for scale and role values
  "tokens.shadow", // NEED exact off-the-shelf selected shadow application
  "tokens.transition-duration", // NEED exact off-the-shelf movement target/application contract
  "tokens.transition-easing", // NEED exact off-the-shelf movement target/application contract
];

const catalog = loadCatalog();
const metaOf = (doc: FillDoc) => doc.$extensions["com.clossys.fill"];
const tokenLeaves = catalog.slots.filter(slot => slot.id.startsWith("tokens.")).map(slot => slot.id);
const tokenDocs = catalog.fills.filter(doc => tokenLeaves.includes(metaOf(doc).slot) && metaOf(doc).mode !== "reference");
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Every authored member id of one fill document, exactly as the engine addresses it. */
function memberIds(doc: FillDoc): string[] {
  const ids: string[] = [];
  const visit = (node: object, path: string): void => {
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (child && typeof child === "object" && Object.hasOwn(child, "$value")) ids.push(`${path}.${key}`);
      else if (child && typeof child === "object") visit(child, `${path}.${key}`);
    }
  };
  visit(doc.tokens ?? {}, "tokens");
  return ids;
}

/**
 * The selection is the repository's signed-default token library, built from the catalog by the
 * original engine operations (adopt + registered derive); no id list is hard-coded here.
 */
function selectedLibrary(): LibraryData {
  return completedTokenLibrary(catalog, { id: "coverage-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-25");
}

type Verdict = { specimen: string[]; label: string[] };
const visible = (element: Element): boolean => !element.closest("[aria-hidden=true], .sr-only");

/** The one specimen a rendered member shows, or the fallback it shows instead. */
function specimenOf(variant: HTMLElement): { type?: string; fallback?: string } {
  if (variant.textContent?.includes(labels.previewUnavailable)) return { fallback: "preview-unavailable" };
  if (variant.querySelector('[data-preview-kind="unsupported-text"]')) return { fallback: "unsupported-text" };
  if (variant.querySelector('output[role="status"]')) return { fallback: "unsupported-application" };
  if (variant.querySelector('[data-preview-kind="text"]')) return { fallback: "value-only" };
  // An unbound length painted as a generic bar does not apply the member to its real consumer.
  if (variant.querySelector('[data-preview-kind="ruler"]')) return { fallback: "generic-ruler" };
  const figure = variant.querySelector<HTMLElement>("figure[data-kind]");
  if (figure) return { type: `application:${figure.dataset.kind}` };
  if (variant.querySelector("[data-studio-color-swatch]")) return { type: "color-swatch" };
  if (variant.querySelector('[data-preview-kind="font"]')) return { type: "font-sample" };
  if (variant.querySelector('[data-preview-kind="swatch"]')) return { type: "swatch" };
  return { fallback: "no-specimen" };
}

function conformance(): { verdicts: Record<string, Verdict>; selected: Map<string, string | undefined>; authored: Set<string>; leaves: number } {
  const library = selectedLibrary(), authored = new Set(tokenDocs.flatMap(memberIds));
  const rows = matrixRows({ catalog, library, working: library, changes: emptyChanges(library), expanded: new Set(), evaluateRows: new Set() });
  const boards = matrixBoards({ catalog, library, working: library }, rows);
  const consumer = library.source.id, selectionHash = libraryHash(library), sourceHash = "coverage-source";
  const verdicts: Record<string, Verdict> = {}, selected = new Map<string, string | undefined>();
  for (const leaf of tokenLeaves) verdicts[leaf] = { specimen: [], label: [] };
  for (const board of boards) {
    const port = valueLibraryBoardPreviews({ layer: "tokens", board, sources: [], consumerSource: consumer, selectionHash, sourceHashes: { [consumer]: sourceHash }, mode: "view", canSave: false, pending: false, prompt: () => { throw new Error("prompts are not rendered by previews"); } }, labels);
    for (const row of board.rows) {
      if (row.scope !== "slot" || !tokenLeaves.includes(row.id)) continue;
      const verdict = verdicts[row.id]!;
      const candidate = row.candidates.find(entry => entry.selected);
      if (!candidate) { verdict.specimen.push("no selected candidate"); continue; }
      for (const error of candidate.findings.filter(finding => finding.severity === "error")) verdict.specimen.push(`${error.code}: ${error.message}`);
      const node = port.render({ leaf: row.id, source: consumer, selectionHash, sourceHash });
      if (node === undefined) { verdict.specimen.push("preview-unavailable"); continue; }
      const view = render(<>{node}</>);
      const types = new Map<string, string[]>();
      for (const { id, member } of candidate.members) {
        selected.set(id, member.origin?.kind);
        const key = id.slice(member.slot.length + 1);
        const variant = [...view.container.querySelectorAll<HTMLElement>("[data-candidate-variant]")].find(element => element.dataset.candidateVariant === id);
        if (!variant) { verdict.specimen.push(`${key}: not rendered`); continue; }
        const { type, fallback } = specimenOf(variant);
        if (fallback) verdict.specimen.push(`${key}: ${fallback}`);
        else types.set(type!, [...types.get(type!) ?? [], key]);
        // One visible key owner; any other visible text equal to the key is a second label, unless
        // the member's value is literally the key (e.g. elevation `none` = `none`).
        const named = [...variant.querySelectorAll("*")].filter(element => element.children.length === 0 && visible(element) && element.textContent?.trim() === key);
        const names = named.filter(element => element.hasAttribute("data-member-key")).length + (key === member.css.light ? 0 : named.filter(element => !element.hasAttribute("data-member-key")).length);
        if (names !== 1) verdict.label.push(`${key}: ${names} visible labels`);
      }
      if (types.size > 1) verdict.specimen.push(`mixed specimen types ${[...types.keys()].sort(byCodeUnit).join(" + ")}`);
      view.unmount();
    }
  }
  cleanup();
  return { verdicts, selected, authored, leaves: boards.flatMap(board => board.rows).filter(row => row.scope === "slot" && tokenLeaves.includes(row.id)).length };
}

it("every selected member of every token leaf renders its leaf's one specimen type with no fallback", () => {
  const { verdicts, selected, authored, leaves } = conformance();
  // The selection reaches every token leaf and every authored member id; anything beyond the
  // authored documents is a registered recipe output, never an invented member.
  expect(leaves).toBe(tokenLeaves.length);
  expect([...authored].filter(id => !selected.has(id))).toEqual([]);
  expect([...selected].filter(([id, origin]) => !authored.has(id) && origin !== "derived")).toEqual([]);
  const failing = Object.entries(verdicts).filter(([, verdict]) => verdict.specimen.length > 0).map(([leaf]) => leaf).sort(byCodeUnit);
  const report = Object.fromEntries(Object.entries(verdicts).filter(([, verdict]) => verdict.specimen.length > 0).map(([leaf, verdict]) => [leaf, verdict.specimen]));
  expect({ newlyFailing: failing.filter(leaf => !SPECIMEN_NEED.includes(leaf)), nowPassing: SPECIMEN_NEED.filter(leaf => !failing.includes(leaf)) }, JSON.stringify(report, null, 1)).toEqual({ newlyFailing: [], nowPassing: [] });
  expect(Object.fromEntries(Object.entries(verdicts).filter(([, verdict]) => verdict.label.length > 0).map(([leaf, verdict]) => [leaf, verdict.label]))).toEqual({});
}, 120_000);
