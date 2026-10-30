import { lazy } from "react";

// Server shell modules retain their import boundary; locale is supplied by the existing client island.
export const ShellI18nProvider = lazy(async () => ({ default: (await import("./i18n.client.js")).ShellI18nProvider }));
export const ShellLocaleRoot = lazy(async () => ({ default: (await import("./i18n.client.js")).ShellLocaleRoot }));
