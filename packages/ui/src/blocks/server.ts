/**
 * @vespeneventures/ui/blocks/server — the server-safe subset of
 * `@vespeneventures/ui/blocks`. See `atoms/server.ts`'s own header for the
 * full #375 rationale this file shares: `blocks/index.ts` re-exports
 * every block eagerly from one module, so the interactive minority
 * (`DataTable`, `Form`, `ConfirmDialog`, `Toolbar`, `NavGrid`, `Faq`,
 * `Pagination`, `Testimonial`) drags the whole barrel down under React's
 * `react-server` condition even though ten individual blocks resolve
 * cleanly on their own.
 *
 * MEMBERSHIP IS EMPIRICAL — confirmed by resolving each member's own
 * compiled file (`dist/blocks/<Name>.js`, never the barrel) under
 * `node --conditions=react-server`. `PricingTable` is included here even
 * though an earlier audit (see issue #375's own body) didn't list it as
 * safe: it imports only `Badge` and `Card` (both server-safe atoms) and
 * types from `react`, and the probe confirms it resolves cleanly — the
 * earlier list was a hypothesis, re-verified here, not a source of truth.
 * See `src/render-environment.ts` for the recorded verdict and
 * `render-environment.test.ts` for the negative control proving
 * `blocks/index.ts` still fails the identical probe.
 *
 * ADDITIVE ONLY: every name below already ships from `blocks/index.ts`.
 * No wildcard subpath, no per-file deep export — see `atoms/server.ts`'s
 * header for why.
 */

import { version as reactVersion } from "react";
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/**
 * `react` guard only — see `atoms/server.ts`'s own header for why
 * `react-aria-components` is deliberately NOT guarded from this file:
 * none of the members below import it (confirmed by grep against each
 * one's own source), and guarding it here would make that peer
 * non-optional for every consumer of this narrower subpath.
 */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { ArticleBody } from "./ArticleBody.js";
export type { ArticleBodyProps } from "./ArticleBody.js";

export { DetailView } from "./DetailView.js";
export type { DetailViewProps, DetailViewField } from "./DetailView.js";

export { EmptyState } from "./EmptyState.js";
export type { EmptyStateProps } from "./EmptyState.js";

export { FeatureGrid } from "./FeatureGrid.js";
export type { FeatureGridProps, FeatureGridItem, FeatureGridHeadingLevel } from "./FeatureGrid.js";

export { FieldGroup } from "./FieldGroup.js";
export type { FieldGroupProps, FieldGroupLayout } from "./FieldGroup.js";

export { Hero } from "./Hero.js";
export type { HeroProps, HeroHeadingLevel } from "./Hero.js";

export { PageHeader } from "./PageHeader.js";
export type { PageHeaderProps } from "./PageHeader.js";

export { PricingTable } from "./PricingTable.js";
export type { PricingTableProps, PricingTier, PricingTableHeadingLevel } from "./PricingTable.js";

export { SectionHeader } from "./SectionHeader.js";
export type { SectionHeaderProps, SectionHeaderLevel } from "./SectionHeader.js";

export { Stat } from "./Stat.js";
export type { StatProps, StatTrend } from "./Stat.js";
