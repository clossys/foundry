/**
 * Compile-time proof that the site blocks keep their intentionally closed
 * vocabularies. This is a `*.check.tsx` rather than a test because Vitest
 * transpiles test sources without checking `@ts-expect-error` assertions.
 */
import { ContentSection } from "../ContentSection.js";
import { Specimen } from "../specimen/Specimen.js";
import { Faq } from "../Faq.js";
import { FeatureGrid } from "../FeatureGrid.js";
import { Hero } from "../Hero.js";
import { OrderedStepSequence } from "../OrderedStepSequence.js";
import { StatusList } from "../StatusList.js";
import type { SectionGround } from "../section-ground.js";

export const exhaustiveGroundLabels = {
  base: "Base",
  sunken: "Sunken",
  inverse: "Inverse",
} satisfies Record<SectionGround, string>;

export const validSequence = <OrderedStepSequence items={[{ id: "one", ordinal: "1", heading: "First" }]} ground="base" />;

// @ts-expect-error — a sequence can only choose a ground whose matching ink and line tokens this block owns.
export const invalidSequenceGround = <OrderedStepSequence items={[]} ground="raised" />;

export const validGroundedBlocks = (
  <>
    <Hero heading="Hero" ground="sunken" />
    <FeatureGrid items={[]} ground="inverse" />
    <Faq items={[]} ground="sunken" />
    <StatusList legendLabel="Status" labels={{ available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }} groups={[]} ground="inverse" />
  </>
);

// @ts-expect-error — all grounded site blocks reject unsupported surface/foreground combinations.
export const invalidHeroGround = <Hero heading="Hero" ground="raised" />;

// @ts-expect-error — all grounded site blocks share the same closed vocabulary.
export const invalidFeatureGridGround = <FeatureGrid items={[]} ground="accent" />;

// @ts-expect-error — FAQ cannot be painted with an unsupported ground.
export const invalidFaqGround = <Faq items={[]} ground="transparent" />;

// @ts-expect-error — status foregrounds and boundaries are selected from a complete ground mapping.
export const invalidStatusGround = <StatusList legendLabel="Status" labels={{ available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }} groups={[]} ground="raised" />;

export const invalidSequenceOrdinal = (
  <OrderedStepSequence
    items={[
      {
        id: "one",
        // @ts-expect-error — the accessibility-carrying ordinal must be authored text, not hidden or interactive markup.
        ordinal: <svg aria-hidden="true" />,
        heading: "First",
      },
    ]}
  />
);

export const validStatusList = (
  <StatusList
    legendLabel="Status"
    labels={{ available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }}
    groups={[
      {
        id: "one",
        heading: "Group",
        items: [
          { id: "row", label: "Row", state: "available" },
          { id: "not-offered", label: "Not offered", disposition: "not-offered" },
        ],
      },
    ]}
  />
);

export const invalidStatusList = (
  <StatusList
    legendLabel="Status"
    labels={{ available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }}
    groups={[
      {
        id: "one",
        heading: "Group",
        items: [
          // @ts-expect-error — arbitrary readiness names cannot bypass the block's token mapping.
          { id: "row", label: "Row", state: "blocked" },
        ],
      },
    ]}
  />
);

export const invalidMixedStatusItem = (
  <StatusList
    legendLabel="Status"
    labels={{ available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }}
    groups={[
      {
        id: "one",
        heading: "Group",
        items: [
          // @ts-expect-error — a deliberate non-capability is off-axis, never also a readiness state.
          { id: "row", label: "Row", state: "available", disposition: "not-offered" },
        ],
      },
    ]}
  />
);

export const invalidUnclassifiedStatusItem = (
  <StatusList
    legendLabel="Status"
    labels={{ available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }}
    groups={[
      {
        id: "one",
        heading: "Group",
        items: [
          // @ts-expect-error — every row must be either a readiness state or a closed off-axis disposition.
          { id: "row", label: "Row" },
        ],
      },
    ]}
  />
);

export const incompleteStatusLabels = (
  <StatusList
    legendLabel="Status"
    // @ts-expect-error — the one legend must visibly name every member of the closed state vocabulary.
    labels={{ available: "Available", partial: "Partial", planned: "Planned", dispositions: {} }}
    groups={[]}
  />
);


import { AnatomyCallouts } from "../AnatomyCallouts.js";
import type { SpecimenPanelContent } from "../specimen/SpecimenPanel.js";
const anatomyPanel: SpecimenPanelContent = { parts: [{ id: "result", type: "fields", label: "Result", items: [{ id: "latest", label: "Latest result", value: "3.00x" }] }] };

// @ts-expect-error The supported split alias requires media.
export const missingSplitMedia = <ContentSection layout="split" heading="Heading" />;
// @ts-expect-error Specimen requires its accessible-name label.
export const missingSpecimenLabel = <Specimen panels={[{ id: "panel", ...anatomyPanel }]} />;

export const validAnatomy = <AnatomyCallouts id="sample-record" label="Sample exception record." panel={anatomyPanel} markers={[]} keyLabel={<em>Key</em>} headingLevel={4} ground="inverse" legendSide="below" />;
// @ts-expect-error — Anatomy ids belong to the caller, never a hook or global counter.
export const missingAnatomyId = <AnatomyCallouts label="Sample exception record." panel={anatomyPanel} markers={[]} keyLabel="Key" />;
// @ts-expect-error — marker overlays are rendering props, never panel content.
export const markedPanelContent: SpecimenPanelContent = { ...anatomyPanel, markers: { result: 1 } };
// @ts-expect-error — Anatomy grounds keep their closed token pairing.
export const invalidAnatomyGround = <AnatomyCallouts id="sample" label="Sample exception record." panel={anatomyPanel} markers={[]} keyLabel="Key" ground="raised" />;
// @ts-expect-error — key headings can only sit at section level plus one.
export const invalidAnatomyHeading = <AnatomyCallouts id="sample" label="Sample exception record." panel={anatomyPanel} markers={[]} keyLabel="Key" headingLevel={2} />;

import { Scene, layoutScene } from "../scene/index.js";
import type { SceneInput, SceneLayout } from "../scene/index.js";
const sceneInput: SceneInput = {
  template: "converge", seed: "documents",
  sources: { heading: "Documents", items: ["one", "two", "three"].map(id => ({ id, format: "pdf", title: id })) },
  target: { heading: "Record", title: "Facility", rows: [{ id: "amount", label: "Amount", value: "12.0M" }, { id: "limit", label: "Limit", value: "15.0M" }] },
  relations: ["one", "two", "three"].map(from => ({ from, to: "amount" })),
};
export const validScene = <Scene id="scene-record" input={sceneInput} label={<em>Document provenance</em>} headingLevel={4} />;
export const sceneLayout: SceneLayout = layoutScene(sceneInput);
// @ts-expect-error — instance identity is separate from the geometry seed.
export const missingSceneId = <Scene input={sceneInput} label="Document provenance" />;
// @ts-expect-error — launch templates are a closed union.
export const invalidSceneTemplate: SceneInput = { ...sceneInput, template: "pipeline" };
// @ts-expect-error — presentation coordinates are not caller data.
export const invalidSceneCoordinate: SceneInput = { ...sceneInput, x: 20 };
// @ts-expect-error — card title heading level is limited to the documented API.
export const invalidSceneHeading = <Scene id="scene-record" input={sceneInput} label="Document provenance" headingLevel={2} />;

export const validCompactHero = <Hero heading="Hero" size="compact" />;
export const validDefaultHero = <Hero heading="Hero" size="default" />;
// @ts-expect-error — hero sizing has two closed choices.
export const invalidHeroSize = <Hero heading="Hero" size="small" />;


// Existing public interfaces carry history, row caps and badges through both barrels.
import { Meter as HistoryMeter, type MeterProps as HistoryMeterProps } from "../../atoms/server.js";
import type { SpecimenStatusRowsPart as HistoryStatusRowsPart, SpecimenMeterPart as HistoryMeterPart } from "../server.js";
import type { SpecimenPanelContent as BadgedPanelContent } from "../index.js";

const meterHistoryProps: HistoryMeterProps = { value: 1, scaleMax: 2, tone: "neutral", valueText: "Now 1", previous: 0, previousText: "Previously 0" };
export const validMeterHistory = <HistoryMeter {...meterHistoryProps} />;
export const validMeterWithoutHistory = <HistoryMeter value={1} scaleMax={2} tone="neutral" valueText="Now 1" />;
// @ts-expect-error Previous measurement is numeric.
export const invalidMeterPrevious = <HistoryMeter {...meterHistoryProps} previous="0" />;
// @ts-expect-error Visible history is authored text.
export const invalidMeterPreviousText = <HistoryMeter {...meterHistoryProps} previousText={0} />;

export const cappedStatusRows: HistoryStatusRowsPart = { id: "checks", type: "status-rows", mobileRows: 3, items: [{ id: "one", label: "First", status: { tone: "info", label: "Open" } }] };
// @ts-expect-error The mobile cap is the closed value 3.
export const invalidStatusRowCap: HistoryStatusRowsPart = { ...cappedStatusRows, mobileRows: 2 };
export const meterHistoryPart: HistoryMeterPart = { id: "quantity", type: "meter", label: "Quantity", ...meterHistoryProps, tone: "neutral" };
// @ts-expect-error Specimen history follows the same numeric measurement contract.
export const invalidPartPrevious: HistoryMeterPart = { ...meterHistoryPart, previous: "0" };
// @ts-expect-error Resolved history is visible text rather than a numeric value.
export const invalidPartPreviousText: HistoryMeterPart = { ...meterHistoryPart, previousText: 0 };
export const badgedPanelContent: BadgedPanelContent = { parts: [cappedStatusRows], badge: { label: "Reviewed", tone: "success" } };
export const defaultPanelBadge: BadgedPanelContent = { parts: [cappedStatusRows], badge: { label: "Reviewed" } };
// @ts-expect-error Panel badges use the existing five Badge tones.
export const invalidPanelBadgeTone: BadgedPanelContent = { ...badgedPanelContent, badge: { label: "Reviewed", tone: "accent" } };

// Canonical split layouts allow header-only bands; the supported alias needs media.
void <ContentSection layout="split-start" heading="Heading" />;
void <ContentSection layout="split-end" heading="Heading" />;
void <ContentSection layout="split" heading="Heading" media={<p>Visual</p>} />;
// @ts-expect-error The supported split alias requires media.
void <ContentSection layout="split" heading="Heading" />;

const namedSpecimenPanel = { id: "sample", ...anatomyPanel };
void <Specimen label="Sample record" panels={[namedSpecimenPanel]} />;
// @ts-expect-error Every Specimen requires its accessible figure label.
void <Specimen panels={[namedSpecimenPanel]} />;

import { Tree, type TreeProps, type TreeNodeData } from "../index.js";
import { Tree as ServerTree, type TreeProps as ServerTreeProps, type TreeNodeData as ServerTreeNodeData } from "../server.js";

const treeRoot: TreeNodeData = { id: "root", heading: "Organization", figure: { value: 42, delta: "+6", trend: "up" }, status: { tone: "success", label: "Open" } };
const treeChild: ServerTreeNodeData = { id: "one", parent: "root", edgeLabel: <em>Contains</em>, heading: "Team" };
const treeProps: TreeProps = { nodes: [treeRoot, treeChild, { id: "two", parent: "root", heading: "Team", edgeLabel: "Contains" }], labelledBy: "organization", orientation: "down", ground: "inverse", className: "caller" };
const serverTreeProps: ServerTreeProps = treeProps;
void <Tree {...treeProps} />;
void <ServerTree {...serverTreeProps} />;
// @ts-expect-error A Tree node carries no navigation destination.
const linkedTreeNode: TreeNodeData = { ...treeRoot, href: "/root" };
// @ts-expect-error A Tree node carries no Item visual slot.
const visualTreeNode: TreeNodeData = { ...treeRoot, visual: <p>Visual</p> };
// @ts-expect-error Featured remains retired on Tree nodes.
const featuredTreeNode: TreeNodeData = { ...treeRoot, featured: true };
// @ts-expect-error Tree orientation has two closed choices.
void <Tree {...treeProps} orientation="up" />;
// @ts-expect-error Tree grounds use the existing section vocabulary.
void <ServerTree {...serverTreeProps} ground="raised" />;
