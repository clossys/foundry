/** Literal recipes are separate from interpolated geometry so the class scanner sees every responsive rule. */
export const ORDER_LAYOUT_CLASSES = {
  root: "items-connected pb-2xl", ordinal: "absolute items-order-ordinal", stackedTrack: "items-track-stacked",
  forcedLine: "forced-colors:border-solid forced-colors:border-current",
  columns: "tablet:[--items-wide:1]",
  lanes3: "tablet-lg:[--items-wide:1] tablet-lg:grid tablet-lg:grid-cols-3",
  lanes5: "desktop:[--items-wide:1] desktop:grid desktop:grid-cols-5",
  transition: "pointer-events-none contents",
  narrowColumns: "contents tablet:hidden",
  narrowLanes3: "contents tablet-lg:hidden",
  narrowLanes5: "contents desktop:hidden",
  wideColumns2: "hidden tablet:contents",
  wideTablet2: "hidden tablet:contents tablet-lg:hidden",
  wideColumns3: "hidden tablet-lg:contents",
  wideLanes3: "hidden tablet-lg:contents",
  wideLanes5: "hidden desktop:contents",
} as const;
