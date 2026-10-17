/** Literal recipes are separate from interpolated geometry so the class scanner sees every responsive rule. */
export const ORDER_LAYOUT_CLASSES = {
  root: "items-connected pb-2xl", ordinal: "absolute items-order-ordinal", stackedTrack: "items-track-stacked",
  inverseOutline: "border-solid forced-colors:border-solid forced-colors:border-current",
  forcedLine: "border-none forced-colors:border-solid forced-colors:border-current",
  columns: "tablet:[--items-wide:1]",
  lanes3: "tablet-lg:[--items-wide:1] tablet-lg:grid tablet-lg:grid-cols-3",
  lanes4: "desktop:[--items-wide:1] desktop:grid desktop:grid-cols-4",
  lanes5: "desktop:[--items-wide:1] desktop:grid desktop:grid-cols-5",
  transition: "pointer-events-none contents",
  narrowColumns: "contents tablet:hidden",
  narrowLanes3: "contents tablet-lg:hidden",
  narrowLanesDesktop: "contents desktop:hidden",
  wideColumns2: "hidden tablet:contents",
  wideTablet2: "hidden tablet:contents tablet-lg:hidden",
  wideColumns3: "hidden tablet-lg:contents",
  wideLanes3: "hidden tablet-lg:contents",
  wideLanesDesktop: "hidden desktop:contents",
} as const;

/** Responsive display is literal; numeric grid placement is inert in the narrow ordered list. */
export const MULTI_LANE_CLASSES: Record<"three" | "four" | "list" | "label" | "cell" | "chip" | "body" | "linkedBody", string> = {
  three: "min-w-0 tablet-lg:grid tablet-lg:gap-x-lg tablet-lg:gap-y-2xl",
  four: "min-w-0 tablet-lg:grid tablet-lg:gap-x-lg tablet-lg:gap-y-2xl",
  list: "m-0 flex min-w-0 list-none flex-col gap-2xl p-0 tablet-lg:grid tablet-lg:gap-x-lg",
  label: "hidden min-w-0 self-start text-body-s font-medium uppercase tracking-label wrap-anywhere tablet-lg:block",
  cell: "relative min-w-0 wrap-anywhere ps-2xl tablet-lg:ps-0",
  chip: "ms-lg inline-flex rounded-pill border border-solid px-sm py-xs text-caption font-medium tablet-lg:ms-0 tablet-lg:sr-only tablet-lg:focus-within:not-sr-only",
  body: "ms-lg min-w-0 wrap-anywhere tablet-lg:ms-0",
  linkedBody: "pe-sm tablet:pe-md",
};
