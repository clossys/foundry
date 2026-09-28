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

export interface BrandGuideViewProps {
  title: string;
  usage: string;
  lockupSvg: string;
  assets: readonly BrandGuideAssetLink[];
  colors: readonly BrandGuideFact[];
  type: readonly BrandGuideFact[];
  facts: readonly BrandGuideFact[];
  /** Accessible name for the lockup section. @default "Lockup" */
  lockupLabel?: string;
  /** Accessible name for the downloads section. @default "Downloads" */
  downloadsLabel?: string;
  /** Accessible name for the color section. @default "Color" */
  colorLabel?: string;
  /** Accessible name for the type section. @default "Type" */
  typeLabel?: string;
  /** Accessible name for the strategy-facts section. @default "Strategy facts" */
  factsLabel?: string;
}

/** Public brand guide. Fixture copy ships with the package; the host cites Strategist facts beside the tokens. */
export function BrandGuideView({
  title,
  usage,
  lockupSvg,
  assets,
  colors,
  type,
  facts,
  lockupLabel = "Lockup",
  downloadsLabel = "Downloads",
  colorLabel = "Color",
  typeLabel = "Type",
  factsLabel = "Strategy facts",
}: BrandGuideViewProps): ReactNode {
  return (
    <main>
      <PageHeader title={title} description={usage} />
      <section aria-label={lockupLabel}>
        <div dangerouslySetInnerHTML={{ __html: lockupSvg }} />
      </section>
      <section aria-label={downloadsLabel}>
        <ul>
          {assets.map((asset) => (
            <li key={asset.role}>
              <a href={asset.href}>{asset.label}</a>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label={colorLabel}>
        <dl>
          {colors.map((entry) => (
            <div key={entry.name}>
              <dt>{entry.name}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-label={typeLabel}>
        <dl>
          {type.map((entry) => (
            <div key={entry.name}>
              <dt>{entry.name}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-label={factsLabel}>
        <dl>
          {facts.map((entry) => (
            <div key={entry.name}>
              <dt>{entry.name}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
