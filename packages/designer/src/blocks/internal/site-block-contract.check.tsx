/**
 * Compile-time proof that the site blocks keep their intentionally closed
 * vocabularies. This is a `*.check.tsx` rather than a test because Vitest
 * transpiles test sources without checking `@ts-expect-error` assertions.
 */
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
    <StatusList legendLabel="Readiness" labels={{ available: "Available", partial: "Partial", planned: "Planned" }} groups={[]} ground="inverse" />
  </>
);

// @ts-expect-error — all grounded site blocks reject unsupported surface/foreground combinations.
export const invalidHeroGround = <Hero heading="Hero" ground="raised" />;

// @ts-expect-error — all grounded site blocks share the same closed vocabulary.
export const invalidFeatureGridGround = <FeatureGrid items={[]} ground="accent" />;

// @ts-expect-error — FAQ cannot be painted with an unsupported ground.
export const invalidFaqGround = <Faq items={[]} ground="transparent" />;

// @ts-expect-error — status foregrounds and boundaries are selected from a complete ground mapping.
export const invalidStatusGround = <StatusList legendLabel="Readiness" labels={{ available: "Available", partial: "Partial", planned: "Planned" }} groups={[]} ground="raised" />;

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
    legendLabel="Readiness"
    labels={{ available: "Available", partial: "Partial", planned: "Planned" }}
    groups={[{ id: "one", heading: "Group", items: [{ id: "row", label: "Row", state: "available" }] }]}
  />
);

export const invalidStatusList = (
  <StatusList
    legendLabel="Readiness"
    labels={{ available: "Available", partial: "Partial", planned: "Planned" }}
    groups={[
      {
        id: "one",
        heading: "Group",
        items: [
          // @ts-expect-error — arbitrary status names cannot bypass the block's token mapping.
          { id: "row", label: "Row", state: "blocked" },
        ],
      },
    ]}
  />
);

export const incompleteStatusLabels = (
  <StatusList
    legendLabel="Readiness"
    // @ts-expect-error — the one legend must visibly name every member of the closed state vocabulary.
    labels={{ available: "Available", partial: "Partial" }}
    groups={[]}
  />
);
