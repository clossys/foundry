import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { UI_LAYOUT_TAP_TARGET } from "../components/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { assertNoNestedInteractive, CardLinkTitle, cardLinkContainerClassName } from "./stretched-link.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.people", "foundry/sections.people");

export interface PeopleGridPerson {
  id: string;
  name: ReactNode;
  role?: ReactNode;
  bio?: ReactNode;
  portrait?: ReactNode;
  /** Decorative fallback when no portrait is supplied. */
  initials: string;
  href?: string;
}

export interface PeopleGridProps extends Omit<HTMLAttributes<HTMLUListElement>, "children"> {
  /** Two through twelve people. */
  people: readonly PeopleGridPerson[];
  media?: "avatar" | "photo";
  /** Desktop columns; tablet uses at most three. */
  columns?: 2 | 3 | 4;
  headingLevel?: 3 | 4 | 5 | 6;
  ground?: SectionGround;
}

const COLUMN_CLASSES: Readonly<Record<2 | 3 | 4, string>> = {
  2: "tablet:grid-cols-2 desktop:grid-cols-2",
  3: "tablet:grid-cols-3 desktop:grid-cols-3",
  4: "tablet:grid-cols-3 desktop:grid-cols-4",
};

const INITIALS_FILL_CLASSES: Readonly<Record<SectionGround, string>> = {
  base: "bg-surface-sunken",
  sunken: "bg-surface-raised",
  inverse: "bg-surface-inverse-raised",
};

function PersonCard({ person, media, headingLevel, ground }: {
  person: PeopleGridPerson;
  media: "avatar" | "photo";
  headingLevel: 3 | 4 | 5 | 6;
  ground: SectionGround;
}) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const photo = media === "photo";
  const itemClasses = photo ? "flex min-w-0 flex-col gap-md" : "flex min-w-0 items-start gap-md";
  const mediaClasses = photo ? "aspect-square w-full overflow-hidden rounded-panel" : "size-14 shrink-0 overflow-hidden rounded-pill";
  const initialsInk = ground === "inverse" ? colors.primary : colors.secondary;
  const initialsClasses = cx("flex items-center justify-center font-medium", INITIALS_FILL_CLASSES[ground], initialsInk);
  const Heading = headingLevel === 3 ? "h3" : headingLevel === 4 ? "h4" : headingLevel === 5 ? "h5" : "h6";
  const linked = person.href !== undefined;
  if (linked) assertNoNestedInteractive("PeopleGrid", person.id, [person.name, person.bio, person.role]);
  const linkedClasses = linked ? cardLinkContainerClassName("plain", ground) : undefined;
  const fallbackClasses = person.portrait == null ? initialsClasses : undefined;
  return <SemanticContent as="li" className={cx(itemClasses, linkedClasses)} style={{ minBlockSize: linked ? UI_LAYOUT_TAP_TARGET : undefined }}>
    <SemanticContent as="span" aria-hidden="true" className={cx(mediaClasses, fallbackClasses)}>{person.portrait ?? person.initials}</SemanticContent>
    <SemanticContent as="div" className="flex min-w-0 flex-col gap-xs">
      <SemanticContent as={Heading} className={cx("m-0 text-body-l font-medium", colors.primary)}>
        {person.href === undefined ? person.name : <CardLinkTitle href={person.href} frame="plain" ground={ground}>{person.name}</CardLinkTitle>}
      </SemanticContent>
      {person.role != null ? <SemanticContent as="p" className={cx("m-0 text-body-s", colors.secondary)}>{person.role}</SemanticContent> : null}
      {person.bio != null ? <SemanticContent as="div" className={cx("text-body-s", colors.primary)}>{person.bio}</SemanticContent> : null}
    </SemanticContent>
  </SemanticContent>;
}

/** People with decorative media and one optional stretched name link per card. */
export function PeopleGrid({ people, media = "avatar", columns = 3, headingLevel = 3, ground = "base", className, style, ...rest }: PeopleGridProps) {
  if (!Array.isArray(people) || people.length < 2 || people.length > 12) throw new TypeError("PeopleGrid: requires two through twelve people.");
  if (ground !== "base" && ground !== "sunken" && ground !== "inverse") throw new TypeError("PeopleGrid: unknown ground.");
  if (media !== "avatar" && media !== "photo") throw new TypeError("PeopleGrid: unknown media.");
  if (columns !== 2 && columns !== 3 && columns !== 4) throw new TypeError("PeopleGrid: unknown columns.");
  if (headingLevel !== 3 && headingLevel !== 4 && headingLevel !== 5 && headingLevel !== 6) throw new TypeError("PeopleGrid: unknown heading level.");
  const colors = SECTION_GROUND_CLASSES[ground];
  const photo = media === "photo";
  const baseColumns = photo ? "grid-cols-2" : "grid-cols-1";
  return (
    <SemanticContent as="ul" {...SECTION_STAMP} {...rest} role="list" className={cx("m-0 grid list-none gap-x-lg gap-y-xl p-0", baseColumns, COLUMN_CLASSES[columns], colors.primary, className)} style={style}>
      {people.map(person => <PersonCard key={person.id} person={person} media={media} headingLevel={headingLevel} ground={ground} />)}
    </SemanticContent>
  );
}
