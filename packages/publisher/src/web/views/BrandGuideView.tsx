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
}

/** Public brand guide. Fixture copy ships with the package; the host cites Strategist facts beside the tokens. */
export function BrandGuideView({ title, usage, lockupSvg, assets, colors, type, facts }: BrandGuideViewProps): ReactNode {
  return (
    <main>
      <PageHeader heading={title} description={usage} />
      <section aria-label="Lockup">
        <div dangerouslySetInnerHTML={{ __html: lockupSvg }} />
      </section>
      <section aria-label="Downloads">
        <ul>
          {assets.map((asset) => (
            <li key={asset.role}>
              <a href={asset.href}>{asset.label}</a>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Color">
        <dl>
          {colors.map((entry) => (
            <div key={entry.name}>
              <dt>{entry.name}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-label="Type">
        <dl>
          {type.map((entry) => (
            <div key={entry.name}>
              <dt>{entry.name}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-label="Strategy facts">
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
