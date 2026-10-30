'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadTheme, type StudioTheme } from '../lib/config-client';

const BrandContext = createContext<StudioTheme | undefined>(undefined);

export function useStudioBrand(): StudioTheme {
  const theme = useContext(BrandContext);
  if (!theme) throw new Error('StudioFrame requires StudioBrand.');
  return theme;
}

/** Bind Producer's compiler output without adding a visual element or theme owner. */
export function StudioBrand({ children, initialTheme }: { children: ReactNode; initialTheme: StudioTheme | undefined }) {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    let request: AbortController | undefined;
    const refresh = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      void loadTheme(controller.signal).then(theme => {
        if (controller.signal.aborted) return;
        const style = document.getElementById('studio-brand-theme');
        if (style) {
          style.textContent = theme.css;
          document.documentElement.setAttribute('data-brand-bound', '');
          document.documentElement.dataset.themeHash = theme.hash;
          document.documentElement.dataset.themeState = 'ready';
          setTheme(theme);
        }
      }).catch(() => {
        if (!controller.signal.aborted) {
          document.documentElement.dataset.themeState = 'unavailable';
          setTheme(current => current ? { ...current, message: 'The consumer theme could not be refreshed. The last compiled theme remains applied.' } : undefined);
        }
      });
    };
    refresh();
    const events = new EventSource('/api/events');
    events.addEventListener('ready', refresh);
    events.addEventListener('change', refresh);
    return () => { request?.abort(); events.close(); };
  }, []);
  return theme ? <BrandContext.Provider value={theme}>{children}</BrandContext.Provider> : null;
}
