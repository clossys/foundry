"use client";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { I18nProvider, useLocale } from "react-aria-components";

/** The host supplies Writer's canonical page locale; absent an override, retain its context. */
export function ShellI18nProvider({ locale, children }: { locale?: string; children: ReactNode }) {
  const inherited = useLocale();
  return <I18nProvider locale={locale ?? inherited.locale}>{children}</I18nProvider>;
}

/** Stamp the existing shell root without introducing a wrapper or deriving direction again. */
export function ShellLocaleRoot({ children }: { children: ReactElement<{ lang?: string; dir?: "ltr" | "rtl" }> }) {
  const { locale, direction } = useLocale();
  return cloneElement(children, { lang: children.props.lang ?? locale, dir: children.props.dir ?? direction });
}
