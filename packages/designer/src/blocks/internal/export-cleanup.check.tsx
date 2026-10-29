import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import * as Blocks from "../index.js";
import * as ServerBlocks from "../server.js";
import * as PackageInventory from "../../index.js";
import { FeatureGrid, type FeatureGridItem, type FeatureGridProps } from "../FeatureGrid.js";
import { OrderedStepSequence, type OrderedStepSequenceItem, type OrderedStepSequenceProps } from "../OrderedStepSequence.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
export type PublishedFeatureItemKeys = Expect<Equal<keyof FeatureGridItem, "id" | "icon" | "heading" | "description">>;
export type PublishedFeatureProps = Expect<Equal<Exclude<keyof FeatureGridProps, keyof HTMLAttributes<HTMLDivElement>>, "eyebrow" | "heading" | "description" | "items" | "headingLevel" | "ground" | "layout">>;
export type PublishedFeatureLayout = Expect<Equal<NonNullable<FeatureGridProps["layout"]>, "grid" | "list" | "split">>;
export type PublishedStepItemKeys = Expect<Equal<keyof OrderedStepSequenceItem, "id" | "ordinal" | "label" | "heading" | "description">>;
export type PublishedStepProps = Expect<Equal<Exclude<keyof OrderedStepSequenceProps, keyof HTMLAttributes<HTMLElement>>, "eyebrow" | "heading" | "description" | "items" | "headingLevel" | "ground">>;
export type PublishedOrdinal = Expect<Equal<OrderedStepSequenceItem["ordinal"], string | number>>;
const text: ReactNode = <em>Authored copy</em>;
void <FeatureGrid items={[{ id: "one", heading: text, icon: <svg />, description: text }]} headingLevel={6} ground="inverse" data-example="feature" />;
void <OrderedStepSequence items={[{ id: "one", ordinal: "A", label: text, heading: text, description: text }]} headingLevel={6} ground="sunken" aria-label="Sequence" />;
void <FeatureGrid items={Object.freeze([{ id: "one", heading: 0, icon: <button>Open</button>, description: <a href="/detail">Detail</a> }])} onClick={() => {}} style={{ marginInlineStart: "1em" }} />;
void <OrderedStepSequence items={Object.freeze([{ id: "one", ordinal: 0, heading: null, label: [], description: <button>Answer action</button> }])} onKeyDown={() => {}} dir="rtl" />;
// @ts-expect-error The published feature root omits HTML title.
void <FeatureGrid items={[]} title="Title" />;
// @ts-expect-error The published sequence root omits HTML title.
void <OrderedStepSequence items={[]} title="Title" />;
// @ts-expect-error Authored ordinals are strings or numbers, not ReactNode markup.
void <OrderedStepSequence items={[{ id: "one", ordinal: <span>1</span>, heading: "One" }]} />;
// @ts-expect-error Catalog columns belong to Items.
void <FeatureGrid items={[]} columns={3} />;
// @ts-expect-error Catalog treatment belongs to Items.
void <FeatureGrid items={[]} treatment="plate" />;
// @ts-expect-error Published FeatureGrid omits retired collection emphasis.
void <FeatureGrid items={[]} emphasis="statement" />;
// @ts-expect-error Item eyebrows belong to ItemData.
void <FeatureGrid items={[{ id: "one", heading: "One", eyebrow: "Label" }]} />;
// @ts-expect-error Item destinations belong to ItemData.
void <FeatureGrid items={[{ id: "one", heading: "One", href: "/one" }]} />;
// @ts-expect-error Lane definitions belong to connected Items.
void <OrderedStepSequence items={[]} lanes={{ a: "First", b: "Second" }} />;
// @ts-expect-error Canonical final markers belong to connected Items.
void <OrderedStepSequence items={[]} end="ends" />;
// @ts-expect-error Canonical final labels belong to connected Items.
void <OrderedStepSequence items={[]} endLabel="Complete" />;
// @ts-expect-error The published sequence has no continuation-copy adapter.
void <OrderedStepSequence items={[]} continuesLabel="Next" />;
// @ts-expect-error Canonical captions belong to connected Items.
void <OrderedStepSequence items={[]} caption="Example" />;
// @ts-expect-error The published sequence has no catalog list naming override.
void <OrderedStepSequence items={[]} labelledBy="heading" />;
// @ts-expect-error Step visuals belong to ItemData.
void <OrderedStepSequence items={[{ id: "one", ordinal: 1, heading: "One", visual: <span /> }]} />;
// @ts-expect-error Step destinations belong to ItemData.
void <OrderedStepSequence items={[{ id: "one", ordinal: 1, heading: "One", href: "/one" }]} />;
// @ts-expect-error Step lane ids belong to ItemData.
void <OrderedStepSequence items={[{ id: "one", ordinal: 1, heading: "One", lane: "a" }]} />;
// @ts-expect-error CardGrid is replaced by Items.
void Blocks.CardGrid;
// @ts-expect-error TopicList is replaced by Items.
void Blocks.TopicList;
// @ts-expect-error LinkGrid is replaced by Items.
void Blocks.LinkGrid;
// @ts-expect-error Comparison is replaced by Matrix.
void Blocks.Comparison;
// @ts-expect-error LedgerTile is replaced by specimen status rows.
void Blocks.LedgerTile;
// @ts-expect-error CardGrid is absent from the native barrel too.
void ServerBlocks.CardGrid;
// @ts-expect-error TopicList is absent from the native barrel too.
void ServerBlocks.TopicList;
// @ts-expect-error LinkGrid is absent from the native barrel too.
void ServerBlocks.LinkGrid;
// @ts-expect-error Comparison is absent from the native barrel too.
void ServerBlocks.Comparison;
// @ts-expect-error LedgerTile is absent from the native barrel too.
void ServerBlocks.LedgerTile;
// @ts-expect-error CardGrid is absent from the canonical package inventory.
void PackageInventory.CardGrid;
// @ts-expect-error TopicList is absent from the canonical package inventory.
void PackageInventory.TopicList;
// @ts-expect-error LinkGrid is absent from the canonical package inventory.
void PackageInventory.LinkGrid;
// @ts-expect-error Comparison is absent from the canonical package inventory.
void PackageInventory.Comparison;
// @ts-expect-error LedgerTile is absent from the canonical package inventory.
void PackageInventory.LedgerTile;
// @ts-expect-error CardGridProps is retired from this public surface.
export type RemovedOrdinaryCardGridProps = Blocks.CardGridProps;
// @ts-expect-error CardGridItem is retired from this public surface.
export type RemovedOrdinaryCardGridItem = Blocks.CardGridItem;
// @ts-expect-error CardGridSpan is retired from this public surface.
export type RemovedOrdinaryCardGridSpan = Blocks.CardGridSpan;
// @ts-expect-error CardGridHeadingLevel is retired from this public surface.
export type RemovedOrdinaryCardGridHeadingLevel = Blocks.CardGridHeadingLevel;
// @ts-expect-error CardGridTreatment is retired from this public surface.
export type RemovedOrdinaryCardGridTreatment = Blocks.CardGridTreatment;
// @ts-expect-error TopicListProps is retired from this public surface.
export type RemovedOrdinaryTopicListProps = Blocks.TopicListProps;
// @ts-expect-error TopicListItem is retired from this public surface.
export type RemovedOrdinaryTopicListItem = Blocks.TopicListItem;
// @ts-expect-error TopicListColumns is retired from this public surface.
export type RemovedOrdinaryTopicListColumns = Blocks.TopicListColumns;
// @ts-expect-error TopicListGroup is retired from this public surface.
export type RemovedOrdinaryTopicListGroup = Blocks.TopicListGroup;
// @ts-expect-error LinkGridProps is retired from this public surface.
export type RemovedOrdinaryLinkGridProps = Blocks.LinkGridProps;
// @ts-expect-error LinkGridItem is retired from this public surface.
export type RemovedOrdinaryLinkGridItem = Blocks.LinkGridItem;
// @ts-expect-error ComparisonProps is retired from this public surface.
export type RemovedOrdinaryComparisonProps = Blocks.ComparisonProps;
// @ts-expect-error ComparisonSide is retired from this public surface.
export type RemovedOrdinaryComparisonSide = Blocks.ComparisonSide;
// @ts-expect-error ComparisonHeadingLevel is retired from this public surface.
export type RemovedOrdinaryComparisonHeadingLevel = Blocks.ComparisonHeadingLevel;
// @ts-expect-error LedgerTileProps is retired from this public surface.
export type RemovedOrdinaryLedgerTileProps = Blocks.LedgerTileProps;
// @ts-expect-error FeatureGridColumns is retired from this public surface.
export type RemovedOrdinaryFeatureGridColumns = Blocks.FeatureGridColumns;
// @ts-expect-error FeatureGridTreatment is retired from this public surface.
export type RemovedOrdinaryFeatureGridTreatment = Blocks.FeatureGridTreatment;
// @ts-expect-error FeatureGridEmphasis is retired from this public surface.
export type RemovedOrdinaryFeatureGridEmphasis = Blocks.FeatureGridEmphasis;
// @ts-expect-error CardGridProps is retired from this public surface.
export type RemovedNativeCardGridProps = ServerBlocks.CardGridProps;
// @ts-expect-error CardGridItem is retired from this public surface.
export type RemovedNativeCardGridItem = ServerBlocks.CardGridItem;
// @ts-expect-error CardGridSpan is retired from this public surface.
export type RemovedNativeCardGridSpan = ServerBlocks.CardGridSpan;
// @ts-expect-error CardGridHeadingLevel is retired from this public surface.
export type RemovedNativeCardGridHeadingLevel = ServerBlocks.CardGridHeadingLevel;
// @ts-expect-error CardGridTreatment is retired from this public surface.
export type RemovedNativeCardGridTreatment = ServerBlocks.CardGridTreatment;
// @ts-expect-error TopicListProps is retired from this public surface.
export type RemovedNativeTopicListProps = ServerBlocks.TopicListProps;
// @ts-expect-error TopicListItem is retired from this public surface.
export type RemovedNativeTopicListItem = ServerBlocks.TopicListItem;
// @ts-expect-error TopicListColumns is retired from this public surface.
export type RemovedNativeTopicListColumns = ServerBlocks.TopicListColumns;
// @ts-expect-error TopicListGroup is retired from this public surface.
export type RemovedNativeTopicListGroup = ServerBlocks.TopicListGroup;
// @ts-expect-error LinkGridProps is retired from this public surface.
export type RemovedNativeLinkGridProps = ServerBlocks.LinkGridProps;
// @ts-expect-error LinkGridItem is retired from this public surface.
export type RemovedNativeLinkGridItem = ServerBlocks.LinkGridItem;
// @ts-expect-error ComparisonProps is retired from this public surface.
export type RemovedNativeComparisonProps = ServerBlocks.ComparisonProps;
// @ts-expect-error ComparisonSide is retired from this public surface.
export type RemovedNativeComparisonSide = ServerBlocks.ComparisonSide;
// @ts-expect-error ComparisonHeadingLevel is retired from this public surface.
export type RemovedNativeComparisonHeadingLevel = ServerBlocks.ComparisonHeadingLevel;
// @ts-expect-error LedgerTileProps is retired from this public surface.
export type RemovedNativeLedgerTileProps = ServerBlocks.LedgerTileProps;
// @ts-expect-error FeatureGridColumns is retired from this public surface.
export type RemovedNativeFeatureGridColumns = ServerBlocks.FeatureGridColumns;
// @ts-expect-error FeatureGridTreatment is retired from this public surface.
export type RemovedNativeFeatureGridTreatment = ServerBlocks.FeatureGridTreatment;
// @ts-expect-error FeatureGridEmphasis is retired from this public surface.
export type RemovedNativeFeatureGridEmphasis = ServerBlocks.FeatureGridEmphasis;
// @ts-expect-error CardGridProps is retired from this public surface.
export type RemovedInventoryCardGridProps = PackageInventory.CardGridProps;
// @ts-expect-error CardGridItem is retired from this public surface.
export type RemovedInventoryCardGridItem = PackageInventory.CardGridItem;
// @ts-expect-error CardGridSpan is retired from this public surface.
export type RemovedInventoryCardGridSpan = PackageInventory.CardGridSpan;
// @ts-expect-error CardGridHeadingLevel is retired from this public surface.
export type RemovedInventoryCardGridHeadingLevel = PackageInventory.CardGridHeadingLevel;
// @ts-expect-error CardGridTreatment is retired from this public surface.
export type RemovedInventoryCardGridTreatment = PackageInventory.CardGridTreatment;
// @ts-expect-error TopicListProps is retired from this public surface.
export type RemovedInventoryTopicListProps = PackageInventory.TopicListProps;
// @ts-expect-error TopicListItem is retired from this public surface.
export type RemovedInventoryTopicListItem = PackageInventory.TopicListItem;
// @ts-expect-error TopicListColumns is retired from this public surface.
export type RemovedInventoryTopicListColumns = PackageInventory.TopicListColumns;
// @ts-expect-error TopicListGroup is retired from this public surface.
export type RemovedInventoryTopicListGroup = PackageInventory.TopicListGroup;
// @ts-expect-error LinkGridProps is retired from this public surface.
export type RemovedInventoryLinkGridProps = PackageInventory.LinkGridProps;
// @ts-expect-error LinkGridItem is retired from this public surface.
export type RemovedInventoryLinkGridItem = PackageInventory.LinkGridItem;
// @ts-expect-error ComparisonProps is retired from this public surface.
export type RemovedInventoryComparisonProps = PackageInventory.ComparisonProps;
// @ts-expect-error ComparisonSide is retired from this public surface.
export type RemovedInventoryComparisonSide = PackageInventory.ComparisonSide;
// @ts-expect-error ComparisonHeadingLevel is retired from this public surface.
export type RemovedInventoryComparisonHeadingLevel = PackageInventory.ComparisonHeadingLevel;
// @ts-expect-error LedgerTileProps is retired from this public surface.
export type RemovedInventoryLedgerTileProps = PackageInventory.LedgerTileProps;
// @ts-expect-error FeatureGridColumns is retired from this public surface.
export type RemovedInventoryFeatureGridColumns = PackageInventory.FeatureGridColumns;
// @ts-expect-error FeatureGridTreatment is retired from this public surface.
export type RemovedInventoryFeatureGridTreatment = PackageInventory.FeatureGridTreatment;
// @ts-expect-error FeatureGridEmphasis is retired from this public surface.
export type RemovedInventoryFeatureGridEmphasis = PackageInventory.FeatureGridEmphasis;

type OrdinaryMatrixProps = ComponentProps<typeof Blocks.Matrix>;
type NativeMatrixProps = ComponentProps<typeof ServerBlocks.Matrix>;
type InventoryMatrixProps = ComponentProps<typeof PackageInventory.Matrix>;
export type NativeMatrixParity = Expect<Equal<NativeMatrixProps, Blocks.MatrixQuadrantProps | Blocks.MatrixGridProps>>;
export type InventoryMatrixParity = Expect<Equal<OrdinaryMatrixProps, InventoryMatrixProps>>;
export type NativeFeatureParity = Expect<Equal<FeatureGridProps, ServerBlocks.FeatureGridProps>>;
export type InventoryFeatureParity = Expect<Equal<FeatureGridProps, PackageInventory.FeatureGridProps>>;
export type NativeStepParity = Expect<Equal<OrderedStepSequenceProps, ServerBlocks.OrderedStepSequenceProps>>;
export type InventoryStepParity = Expect<Equal<OrderedStepSequenceProps, PackageInventory.OrderedStepSequenceProps>>;
export type MatrixAliasParity = Expect<Equal<ServerBlocks.MatrixProps, Blocks.MatrixQuadrantProps | Blocks.MatrixGridProps>>;
export type MatrixInventoryAliasParity = Expect<Equal<Blocks.MatrixProps, PackageInventory.MatrixProps>>;
export type MatrixSideAliasParity = Expect<Equal<Blocks.MatrixSide, ServerBlocks.MatrixSide>>;
export type MatrixSideInventoryAliasParity = Expect<Equal<Blocks.MatrixSide, PackageInventory.MatrixSide>>;
export type MatrixHeadingAliasParity = Expect<Equal<Blocks.MatrixHeadingLevel, 2 | 3 | 4 | 5 | 6>>;

// Catalog type names preserve the existing fields and match every public barrel.
export type ItemFigureAliasParity = Expect<Equal<Blocks.ItemFigureData, ServerBlocks.ItemFigureData>>;
export type ItemFigureInventoryAliasParity = Expect<Equal<Blocks.ItemFigureData, PackageInventory.ItemFigureData>>;
export type ItemFigureFieldIdentity = Expect<Equal<NonNullable<Blocks.ItemData["figure"]>, Blocks.ItemFigureData>>;
export type ItemFigureShapeIdentity = Expect<Equal<Blocks.ItemFigureData, { value: ReactNode; delta?: ReactNode; trend?: "up" | "down" | "neutral" }>>;
export type ItemStatusAliasParity = Expect<Equal<Blocks.ItemStatusData, ServerBlocks.ItemStatusData>>;
export type ItemStatusInventoryAliasParity = Expect<Equal<Blocks.ItemStatusData, PackageInventory.ItemStatusData>>;
export type ItemStatusFieldIdentity = Expect<Equal<NonNullable<Blocks.ItemData["status"]>, Blocks.ItemStatusData>>;
export type ItemStatusShapeIdentity = Expect<Equal<Blocks.ItemStatusData, { tone: "success" | "warning" | "danger" | "info" | "neutral"; label: ReactNode }>>;
export type MatrixCellAliasParity = Expect<Equal<Blocks.MatrixCellData, ServerBlocks.MatrixCellData>>;
export type MatrixCellInventoryAliasParity = Expect<Equal<Blocks.MatrixCellData, PackageInventory.MatrixCellData>>;
export type MatrixCellFieldIdentity = Expect<Equal<Blocks.MatrixGridProps["rows"][number]["cells"][string], Blocks.MatrixCellData>>;
export type MatrixMarkCellIdentity = Expect<Equal<Extract<Blocks.MatrixCellData, { type: "mark" }>, { type: "mark"; value: 0 | 1 | 2 | 3 | 4 }>>;
export type MatrixGridAliasParity = Expect<Equal<Blocks.MatrixGridProps, ServerBlocks.MatrixGridProps>>;
export type MatrixGridInventoryAliasParity = Expect<Equal<Blocks.MatrixGridProps, PackageInventory.MatrixGridProps>>;
export type MatrixGridMemberIdentity = Expect<Equal<Extract<Blocks.MatrixProps, { arrangement: "grid" }>, Blocks.MatrixGridProps>>;
export type MatrixQuadrantAliasParity = Expect<Equal<Blocks.MatrixQuadrantProps, ServerBlocks.MatrixQuadrantProps>>;
export type MatrixQuadrantInventoryAliasParity = Expect<Equal<Blocks.MatrixQuadrantProps, PackageInventory.MatrixQuadrantProps>>;
export type MatrixQuadrantMemberIdentity = Expect<Equal<Extract<Blocks.MatrixProps, { arrangement?: "sides" }>, Blocks.MatrixQuadrantProps>>;
export type MatrixMembersIdentity = Expect<Equal<Blocks.MatrixProps, Blocks.MatrixQuadrantProps | Blocks.MatrixGridProps | import("../matrix/choices.js").MatrixChoicesProps | ({ readonly arrangement: "library-board" } & Blocks.LibraryBoardSectionProps)>>;
export type PublishedNavKeys = Expect<Equal<keyof Blocks.NavGridProps, "heading" | "items" | "className" | "style" | "config">>;
export type PublishedNavItemKeys = Expect<Equal<keyof Blocks.NavGridItem, "id" | "title" | "description" | "icon" | "href" | "onSelect" | "details">>;
void <Blocks.NavGrid items={Object.freeze([{ id: "one", title: 0, href: "relative-path" }, { id: "two", title: null, onSelect: () => {} }])} />;
// @ts-expect-error A navigation entry has exactly one activation mechanism.
void <Blocks.NavGrid items={[{ id: "one", title: "One", href: "/one", onSelect: () => {} }]} />;
// @ts-expect-error A navigation entry needs its published activation mechanism.
void <Blocks.NavGrid items={[{ id: "one", title: "One" }]} />;

// Collection scale is present on all source and emitted public type surfaces.
export type OrdinaryItemsScale = Expect<Equal<Blocks.ItemsScale, "item" | "statement">>;
export type NativeItemsScale = Expect<Equal<ServerBlocks.ItemsScale, Blocks.ItemsScale>>;
export type InventoryItemsScale = Expect<Equal<PackageInventory.ItemsScale, Blocks.ItemsScale>>;
// @ts-expect-error The retired collection alias is absent.
export type RemovedItemsEmphasis = Blocks.ItemsEmphasis;
// @ts-expect-error The retired collection alias is absent from native blocks.
export type RemovedNativeItemsEmphasis = ServerBlocks.ItemsEmphasis;
// @ts-expect-error The retired collection alias is absent from package inventory.
export type RemovedInventoryItemsEmphasis = PackageInventory.ItemsEmphasis;
void <Blocks.Items arrangement="columns" items={[]} scale="statement" />;
void <ServerBlocks.Items arrangement="columns" items={[]} scale="item" />;
void <PackageInventory.Items arrangement="rows" items={[]} scale={undefined} />;
// @ts-expect-error Collection emphasis is retired.
void <Blocks.Items arrangement="columns" items={[]} emphasis={undefined} />;
// @ts-expect-error Collection emphasis is retired from native blocks.
void <ServerBlocks.Items arrangement="columns" items={[]} emphasis="statement" />;
// @ts-expect-error Collection emphasis is retired from package inventory.
void <PackageInventory.Items arrangement="rows" items={[]} emphasis="item" />;
// @ts-expect-error Published FeatureGrid has no collection scale.
void <FeatureGrid items={[]} scale="statement" />;
