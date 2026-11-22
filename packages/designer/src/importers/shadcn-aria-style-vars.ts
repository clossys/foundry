/**
 * shadcn@aria style axis (nova). A derived rewrite (`shadcn-aria-rewrite@5`) writes token reads only
 * into the consumer properties a themes member emits (`themes.json` `contract.emit`).
 *
 * Stacking, timing, opacity, weight and border width have no consumer member, so their stock nova
 * utilities return unchanged: no Foundry-only property (`--ui-z-*`, `--ui-duration-*`, `--ui-alpha-*`,
 * `--ui-border-*`, `--ui-focus-offset`) is introduced for them. Each pattern matches a whole class
 * atom after its variant prefix.
 */
export const SHADCN_ARIA_STOCK_UTILITIES: Readonly<Record<string, RegExp>> = Object.freeze({
  "stacking": /^z-\d+$/,
  "duration": /^duration-\d+$/,
  "timing": /^ease-(?:linear|in|out|in-out)$/,
  "opacity": /^opacity-(?:50|70)$/,
  "weight": /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  "transition": /^transition(?:-(?:all|colors|opacity|shadow|transform|\[[a-z-]+(?:,[a-z-]+)*\]))?$/,
  "border width": /^border(?:-[trblxyse])?(?:-1|-\[1px\])?$/,
});

/** True when `base` (a class atom without its variant prefix) keeps its stock nova utility. */
export function isShadcnAriaStockUtility(base: string): boolean {
  return Object.values(SHADCN_ARIA_STOCK_UTILITIES).some(pattern => pattern.test(base));
}
