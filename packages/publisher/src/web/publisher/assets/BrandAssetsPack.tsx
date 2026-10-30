import { checkBrandAssetRoster, requiredBrandAssetSize, type BrandAssetEntry } from "../../../media/brand-assets.js";

interface BrandAssetItem {
  readonly id: string;
  readonly label: string;
  readonly assetId?: string;
  readonly questions?: readonly string[];
}
export interface BrandAssetsPackProps {
  /** @default "Consumer brand asset rosters" */
  readonly sectionLabel?: string;
  /** @default "Choose a consumer asset reference." */
  readonly chooseReferenceLabel?: string;
  /** @default "Roster metadata needs input" */
  readonly incompleteLabel?: string;
  /** @default "Roster metadata complete" */
  readonly completeLabel?: string;
  /** @default "File existence and rendered output are unverified. Export and deployment evidence are not supplied." */
  readonly evidenceDescription?: string;
  /** @default "Unresolved asset reference: ID" */
  readonly unresolvedReferenceLabel?: (id: string) => string;
  /** @default "Asset reference: ID" */
  readonly referenceLabel?: (id: string) => string;
  /** @default "LABEL input questions" */
  readonly questionsLabel?: (label: string) => string;
  /** @default "LABEL findings" */
  readonly findingsLabel?: (label: string) => string;
  /** @default "LABEL entries" */
  readonly entriesLabel?: (label: string) => string;
  /** @default "required WIDTH × HEIGHT px" */
  readonly requiredSizeLabel?: (width: number, height: number) => string;

  readonly items: readonly BrandAssetItem[];
  /** Consumer-owned rosters addressed by the aligned plan's assetId. */
  readonly assets?: Readonly<Record<string, readonly BrandAssetEntry[]>>;
}

export type BrandAssetsPackMessages = Omit<BrandAssetsPackProps, "items" | "assets">;

/** Inspect supplied metadata only; source strings are never loaded or rendered. */
function BrandAssetRoster({ items, assets,
  chooseReferenceLabel = "Choose a consumer asset reference.",
  incompleteLabel = "Roster metadata needs input", completeLabel = "Roster metadata complete",
  evidenceDescription = "File existence and rendered output are unverified. Export and deployment evidence are not supplied.",
  unresolvedReferenceLabel = (id: string) => "Unresolved asset reference: " + id,
  referenceLabel = (id: string) => "Asset reference: " + id,
  questionsLabel = (label: string) => label + " input questions",
  findingsLabel = (label: string) => label + " findings", entriesLabel = (label: string) => label + " entries",
  requiredSizeLabel = (width: number, height: number) => "required " + width + " × " + height + " px",
}: BrandAssetsPackProps) {
  const item = items[0]!;
      const entries = item.assetId && assets && Object.prototype.hasOwnProperty.call(assets, item.assetId) ? assets[item.assetId] : undefined;
      const findings = entries === undefined ? undefined : checkBrandAssetRoster(entries);
      const entryRows = entries?.map(entry => {
        const size = entry.role === "favicon-svg" ? undefined : requiredBrandAssetSize(entry.role);
        return { entry, sizeLabel: size ? requiredSizeLabel(size.width, size.height) : undefined };
      });
      return <section key={item.id} aria-label={item.label} className="grid gap-sm rounded border border-line-base bg-surface-raised p-lg">
        <h3>{item.label}</h3><p>{item.id}</p>
        {!!item.questions?.length && <ul aria-label={questionsLabel(item.label)}>{item.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>}
        {entries === undefined ? <>{item.assetId ? <p>{unresolvedReferenceLabel(item.assetId)}</p> : <p>{chooseReferenceLabel}</p>}</> : <>
          <p>{referenceLabel(item.assetId!)}</p>
          {findings!.length > 0 ? <p>{incompleteLabel}</p> : <p>{completeLabel}</p>}
          <ul aria-label={findingsLabel(item.label)}>{findings!.map((finding, index) => <li key={index}>{finding.message}</li>)}</ul>
          <ul aria-label={entriesLabel(item.label)}>{entryRows!.map(({ entry, sizeLabel }, index) => {
            return <li key={`${entry.role}-${index}`}>{entry.role} · {entry.width} × {entry.height}{sizeLabel && <> · {sizeLabel}</>} · {entry.alt}</li>;
          })}</ul>
        </>}
        <p>{evidenceDescription}</p>
      </section>;
}

export function BrandAssetsPack({ items, sectionLabel = "Consumer brand asset rosters", ...props }: BrandAssetsPackProps) {
  return <section aria-label={sectionLabel} className="grid gap-lg">{items.map(item => <BrandAssetRoster key={item.id} items={[item]} assets={props.assets} chooseReferenceLabel={props.chooseReferenceLabel} incompleteLabel={props.incompleteLabel} completeLabel={props.completeLabel} evidenceDescription={props.evidenceDescription} unresolvedReferenceLabel={props.unresolvedReferenceLabel} referenceLabel={props.referenceLabel} questionsLabel={props.questionsLabel} findingsLabel={props.findingsLabel} entriesLabel={props.entriesLabel} requiredSizeLabel={props.requiredSizeLabel} />)}</section>;
}
