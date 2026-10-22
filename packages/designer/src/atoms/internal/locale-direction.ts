import { useLocale } from "react-aria-components";

/**
 * The writing direction of the nearest `I18nProvider` (the browser locale's
 * without one). Blocks may not import react-aria-components at runtime, so a
 * block that portals content outside the provider's DOM subtree reads the
 * provider's direction through this atom-layer hook.
 */
export function useLocaleDirection(): "ltr" | "rtl" {
  return useLocale().direction;
}
