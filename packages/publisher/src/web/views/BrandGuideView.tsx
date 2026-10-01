import { useId } from "react";
import type { ReactNode } from "react";
import { PageHeader } from "@clossys/designer/blocks/server";

export interface BrandGuideFact {
  name: string;
  value: string;
}

export interface BrandGuideAssetLink {
  role: string;
  href: string;
  label: string;
}

/** Sample text set in each listed face. */
export interface BrandGuideSpecimen {
  text: string;
  /** Each face's name and its font-family value. */
  faces: readonly BrandGuideFact[];
}

export interface BrandGuideViewProps {
  title: string;
  usage: string;
  /** Lockup markup. When omitted, the lockup section is absent from the markup. */
  lockupSvg?: string;
  assets: readonly BrandGuideAssetLink[];
  colors: readonly BrandGuideFact[];
  type: readonly BrandGuideFact[];
  facts: readonly BrandGuideFact[];
  /** A type specimen, rendered after the type section. Absent from the markup when omitted. */
  specimen?: BrandGuideSpecimen;
  /**
   * Renders the guide inside another page's `main`: a `div` instead of a
   * `main`, the title as an `h3` instead of a `PageHeader`, and each section
   * named by a visible `h4` through `aria-labelledby` instead of an
   * `aria-label`.
   * @default false
   */
  embedded?: boolean;
  /** Shown in place of a list with no entries. When omitted, an empty list renders with no entries. */
  emptyLabel?: string;
  /** Accessible name for the lockup section. @default "Lockup" */
  lockupLabel?: string;
  /** Accessible name for the downloads section. @default "Downloads" */
  downloadsLabel?: string;
  /** Accessible name for the color section. @default "Color" */
  colorLabel?: string;
  /** Accessible name for the type section. @default "Type" */
  typeLabel?: string;
  /** Accessible name for the type-specimen section. @default "Type specimen" */
  specimenLabel?: string;
  /** Accessible name for the strategy-facts section. @default "Strategy facts" */
  factsLabel?: string;
}

/** A font-family list: names, quotes, commas and spaces only, so a value can never close the declaration. */
const SAFE_FONT_FAMILY = /^[A-Za-z0-9 ,."'_-]+$/;

function GuideSection({ label, embedded, children }: { label: string; embedded: boolean; children: ReactNode }) {
  const headingId = useId();
  if (!embedded) return <section aria-label={label}>{children}</section>;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-xs">
      <h4 id={headingId} className="text-body text-ink-primary">
        {label}
      </h4>
      {children}
    </section>
  );
}

function FactList({ entries, emptyLabel }: { entries: readonly BrandGuideFact[]; emptyLabel: string | undefined }) {
  if (entries.length === 0 && emptyLabel !== undefined) return <p className="text-body-s text-ink-muted">{emptyLabel}</p>;
  return (
    <dl>
      {entries.map((entry) => (
        <div key={entry.name}>
          <dt>{entry.name}</dt>
          <dd>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Public brand guide. Fixture copy ships with the package; the host cites
 * Strategist facts beside the tokens. With `embedded`, the same sections
 * render inside another page, as Publisher's pack review does.
 */
export function BrandGuideView({
  title,
  usage,
  lockupSvg,
  assets,
  colors,
  type,
  facts,
  specimen,
  embedded = false,
  emptyLabel,
  lockupLabel = "Lockup",
  downloadsLabel = "Downloads",
  colorLabel = "Color",
  typeLabel = "Type",
  specimenLabel = "Type specimen",
  factsLabel = "Strategy facts",
}: BrandGuideViewProps): ReactNode {
  const sections = (
    <>
      {lockupSvg === undefined ? null : (
        <GuideSection label={lockupLabel} embedded={embedded}>
          <div dangerouslySetInnerHTML={{ __html: lockupSvg }} />
        </GuideSection>
      )}
      <GuideSection label={downloadsLabel} embedded={embedded}>
        {assets.length === 0 && emptyLabel !== undefined ? (
          <p className="text-body-s text-ink-muted">{emptyLabel}</p>
        ) : (
          <ul>
            {assets.map((asset) => (
              <li key={asset.role}>
                <a href={asset.href}>{asset.label}</a>
              </li>
            ))}
          </ul>
        )}
      </GuideSection>
      <GuideSection label={colorLabel} embedded={embedded}>
        <FactList entries={colors} emptyLabel={emptyLabel} />
      </GuideSection>
      <GuideSection label={typeLabel} embedded={embedded}>
        <FactList entries={type} emptyLabel={emptyLabel} />
      </GuideSection>
      {specimen === undefined ? null : (
        <GuideSection label={specimenLabel} embedded={embedded}>
          {specimen.faces.length === 0 && emptyLabel !== undefined ? (
            <p className="text-body-s text-ink-muted">{emptyLabel}</p>
          ) : (
            <dl>
              {specimen.faces.map((face) => (
                <div key={face.name}>
                  <dt>{face.name}</dt>
                  <dd style={SAFE_FONT_FAMILY.test(face.value) ? { fontFamily: face.value } : undefined}>{specimen.text}</dd>
                </div>
              ))}
            </dl>
          )}
        </GuideSection>
      )}
      <GuideSection label={factsLabel} embedded={embedded}>
        <FactList entries={facts} emptyLabel={emptyLabel} />
      </GuideSection>
    </>
  );

  if (embedded) {
    return (
      <div className="flex flex-col gap-md">
        <h3 className="text-h3 text-ink-primary">{title}</h3>
        <p className="text-body-s text-ink-secondary">{usage}</p>
        {sections}
      </div>
    );
  }
  return (
    <main>
      <PageHeader title={title} description={usage} />
      {sections}
    </main>
  );
}
