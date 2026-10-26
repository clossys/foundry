import { loadCatalog, applyLibraryChange, libraryHash, type LibraryData, type CatalogData, type PlacementNode } from "../../catalog-core/index.js";
import type { StudioLabels } from "../types.js";
export const labels: StudioLabels = {
  board: { changeSelection: "Change selection", done: "Done", notChosen: "Not chosen", choose: "Choose", askAgent: "Ask Claude/Codex to decide", custom: "Custom", create: "Create new", refresh: "Refresh/change this candidate", promptTitle: "Candidate prompt", promptInstruction: "Use the designer skill to create or refresh one complete candidate. Respect the supplied constraints; unavailable guidelines are not a clearance.", returnStep: "Write the candidate to the consumer library, then return to Designer and check for new candidates.", copy: "Copy", copied: "Prompt copied", copyFailed: "Copy failed", close: "Close", checkCandidates: "Check for new candidates", checking: "Checking candidates", candidatesUnavailable: "Candidate refresh is unavailable in this host", candidatesFailed: "Candidate refresh failed", pendingSelection: "Pending selection", noNewCandidates: "No new candidates" },
  canvas: { noCandidatesInBoard: "no candidates in this board", label: "L-canvas", hint: "L-canvas-hint", search: "L-search", explorerOpen: "L-open-explorer", explorerClose: "L-close-explorer", inspectorClose: "L-close-inspector", minimap: "L-minimap", filters: { all: "All", pending: "Pending", warnings: "Has warnings", differs: "Differs from group" }, zoomLabel: "L-zoom", zoomIn: "L-zoom-in", zoomOut: "L-zoom-out", fit: "L-fit", zoom: percent => `${Math.round(percent)}%`, openBoard: name => `L-open-board ${name}`, goToBoard: name => `L-go-board ${name}` },
  layers: { label: "L-layers", tokens: "Tokens", assets: "Assets", components: "Components", sections: "Sections", frames: "Frames", disabled: "Built after Tokens sign-off" },
  scorecard: { title: "L-score", close: "L-close", resolved: "L-resolved", checks: "L-checks", issues: "L-issues", noIssues: "L-no-issues", target: "Target: needs the check engine", counts: (errors, notices) => `L-score-count ${errors}/${notices}`, supported: codes => `L-supported ${codes.join("/")}`, categories: { contract: "Contract and format", accessibility: "Accessibility", coherence: "Coherence", modes: "Modes", provenance: "Provenance and license", coverage: "Coverage" } },
  matrix: { label: "L-matrix", leaf: "L-leaf", libraries: "L-libraries", showAll: "L-show-all", expand: leaf => `L-expand ${leaf}`, collapse: leaf => `L-collapse ${leaf}`, differs: "L-differs", pending: "L-cell-pending" },
  treeLabel: "L-tree", stageLabel: "L-stage", inspectorLabel: "L-inspector", useGroup: "L-use-group",
  useSource: (source, target) => `L-use ${source} @ ${target}`,
  scope: { label: "L-scope", member: "L-member", slot: "L-slot", node: "L-node", memberPicker: "L-member-picker", nodePicker: "L-node-picker", explanation: "L-specificity" },
  memberCount: (count) => `L-count ${count}`,
  checkSummary: (errors, notices) => `L-check ${errors}/${notices}`,
  previewUnavailable: "L-preview-unavailable", visualPreviewUnsupported: "Visual preview unsupported", referenceOnly: "L-reference-only", inUseByDefault: "L-default", noFill: "L-no-fill",
  autosave: { saving: "L-saving", saved: "L-saved", notSaved: "L-not-saved", retry: "L-retry", undo: "L-undo", redo: "L-redo", changedElsewhere: "L-changed-elsewhere", keepMine: "L-keep-mine", takeTheirs: "L-take-theirs" }, resetToDefault: "L-reset",
  saveFailed: { unavailable: "L-unavailable", conflict: "L-conflict", invalid: "L-invalid", failed: "L-failed" },
  loading: "L-loading", loadFailed: "L-load-failed", sampleText: "L-sample", fontNotLoaded: "L-font-note",
  inspector: { representedLeaf: "L-represented-leaf", trust: "L-trust", usedBy: "L-used-by", none: "L-none", source: "L-i-source", mode: "L-i-mode", licence: "L-i-licence", pin: "L-i-pin", status: "L-i-status", evidence: "L-i-evidence", members: "L-i-members", findings: "L-i-findings", via: "L-i-via", light: "L-i-light", dark: "L-i-dark", alias: "L-i-alias", builtOn: "L-i-built-on", relation: "L-i-relation" },
};
export const emptyLibrary = (): LibraryData => ({ source: { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, fills: [], adoptedAt: "2026-10-23" });
export const catalog = loadCatalog();
export const adopt = (library = emptyLibrary(), slot = "tokens.surface-color", source = "foundry"): LibraryData => applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: "adopt", slot, source }] });
const ids = new Set(["tokens.surface-color", "tokens.spacing", "assets.icon-search"]);
const prune = (node: PlacementNode): PlacementNode[] => {
  if ("children" in node) { const children = node.children.flatMap(prune); return children.length ? [{ ...node, children }] : []; }
  const leaves = node.leaves.filter(id => ids.has(id)); return leaves.length ? [{ ...node, leaves }] : [];
};
/** A real catalog slice makes UI interaction tests fast without replacing the engine. */
export const smallCatalog: CatalogData = { ...catalog, slots: catalog.slots.filter(slot => ids.has(slot.id)), fills: catalog.fills.filter(fill => ids.has(fill.$extensions["com.clossys.fill"].slot)), placements: catalog.placements.map(placement => ({...placement, nodes: placement.nodes.flatMap(prune)})).filter(placement => placement.nodes.length > 0) };
