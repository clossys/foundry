import data from "./catalog-bundles.data.json" with { type: "json" };
import starterData from "./rac-starter.data.json" with { type: "json" };
import headlessPackage from "react-aria-components/package.json" with { type: "json" };
import { RAC_PACKAGE, type ComponentCheckInput } from "./catalog-core/check-components.js";
import type { FillDoc } from "./catalog-core/types.js";
import type { ComponentCandidateDocument, ComponentFile } from "./catalog-core/resolve-components.js";
import { componentDescriptorHash, componentOf } from "./catalog-core/resolve-components.js";
import type { SourceBundle } from "./catalog-core/changeset-components.js";
import { importShadcnCharts, materializeShadcnChart, pinnedShadcnChartsInput } from "./importers/shadcn-charts.js";
import { importShadcnAriaRail } from "./importers/shadcn-aria-rail.js";
import { importLucide } from "./importers/lucide.js";
import { importFoundryComponents } from "./importers/foundry-components.js";
import { importShadcnAriaComponents, materializeShadcnComponent, type ShadcnComponentInput } from "./importers/shadcn-aria-components.js";
import { importRacStarter, type RacStarterInput } from "./importers/rac-starter.js";
import { associateSourceOwnerRecords } from "./catalog-core/source-owner-closure.js";
import type { CompositeEngineInput } from "./catalog-core/types.js";
export type { SourceOwnerClosureResult, SourceOwnerRecord, SourceOwnerNeed } from "./catalog-core/source-owner-closure.js";

export interface SourceCandidateBytes {
  fill: string;
  slot: string;
  descriptorHash: string;
  status: "ready" | "blocked";
  transform: string;
  upstreamFiles: readonly ComponentFile[];
  outputFiles: readonly ComponentFile[];
  blockers: readonly { code: string; message: string }[];
}

/** Offline candidate inventory. Drafts and retained blockers are not adoption clearance. */
export function loadCatalogBundles() {
  const input = structuredClone(data.shadcn) as unknown as ShadcnComponentInput;
  const shadcn = importShadcnAriaComponents(input);
  const foundry = importFoundryComponents();
  const rail = importShadcnAriaRail();
  const chartInput = pinnedShadcnChartsInput();
  const charts = importShadcnCharts(chartInput);
  const chartDocs = charts.fills as unknown as readonly ComponentCandidateDocument[];
  // Kbd has byte-identical upstream source and reuses the existing keyboard adoption.
  const newRail = (row: { slot: string }) => row.slot !== "components.keyboard";
  const starter = importRacStarter(structuredClone(starterData) as RacStarterInput);
  const upstream = new Map([...input.items.flatMap(item => item.files), input.styles, input.notice].map(file => [file.path, file]));
  const sourceCandidates: SourceCandidateBytes[] = [];
  const sourceBundles: SourceBundle[] = [];
  for (const doc of chartDocs) {
    const fill = componentOf(doc);
    const descriptorHash = componentDescriptorHash(fill);
    const outputFiles = materializeShadcnChart(charts, fill.slot.slice("components.".length));
    const upstreamFiles = [chartInput.chart, chartInput.notice];
    sourceCandidates.push({ fill: doc.$extensions["com.clossys.fill"].id, slot: fill.slot, descriptorHash,
      status: "ready", transform: fill.transform!, upstreamFiles, outputFiles, blockers: [] });
    sourceBundles.push({ slot: fill.slot, descriptorHash, transform: fill.transform!, upstream: upstreamFiles, files: outputFiles, blockers: [] });
  }
  for (const doc of shadcn.fills) {
    const fill = Object.values(doc.components)[0]!;
    const rewrite = shadcn.rewrites[fill.item]!;
    const upstreamFiles = fill.pin!.files!.map(pin => {
      const file = upstream.get(pin.path);
      if (!file) throw new Error(`catalog-bundles: missing pinned source ${pin.path}`);
      return file;
    });
    const descriptorHash = componentDescriptorHash(fill);
    const candidate: SourceCandidateBytes = {
      fill: doc.$extensions["com.clossys.fill"].id, slot: fill.slot, descriptorHash,
      status: rewrite.issues.length ? "blocked" : "ready", transform: fill.transform,
      upstreamFiles, outputFiles: rewrite.files, blockers: rewrite.issues,
    };
    sourceCandidates.push(candidate);
    // Only the existing materializer can produce adoptable output. Blocked bytes
    // remain inspectable under distinct fields and never enter sourceBundles.
    if (candidate.status === "ready") sourceBundles.push({
      slot: fill.slot, descriptorHash, transform: fill.transform,
      upstream: upstreamFiles, files: materializeShadcnComponent(shadcn, fill.item), blockers: [],
    });
  }
  return structuredClone({
    package: data.package,
    valueFills: [...data.valueFiles.map(file => file.document), ...importLucide().filter(doc => doc.$extensions["com.clossys.fill"].slot === "assets.icon-panel-left")] as unknown as FillDoc[],
    componentFills: [...foundry.fills, ...shadcn.fills, ...starter.fills, ...chartDocs, ...rail.fills.filter(doc => newRail(doc.$extensions["com.clossys.fill"]))] as readonly ComponentCandidateDocument[],
    foundryCoverage: foundry.coverage,
    sourceCandidates: [...sourceCandidates, ...starter.candidates, ...rail.candidates.filter(newRail)],
    sourceBundles: [...sourceBundles, ...starter.sourceBundles, ...rail.sourceBundles.filter(newRail)],
    notices: data.notices,
  });
}

export type CatalogBundles = ReturnType<typeof loadCatalogBundles>;

/**
 * The headless component library this catalog resolves against, as the `installedRac` input of
 * component checks and default planning. The version is read from the installed
 * react-aria-components package.json wherever this module resolves it, never typed by hand.
 */
export function installedHeadlessLibrary(): ComponentCheckInput["installedRac"] {
  return { version: headlessPackage.version, instance: RAC_PACKAGE };
}

/** Complete current record association for board caches; never runtime qualification. */
export function prepareSourceOwnerClosure(input: CompositeEngineInput) {
  return associateSourceOwnerRecords(input, loadCatalogBundles());
}
