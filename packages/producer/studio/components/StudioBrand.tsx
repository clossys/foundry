'use client';

import { useEffect, type ReactNode } from 'react';
import { loadTheme } from '../lib/config-client';

/** Bind Producer's compiler output without adding a visual element or theme owner. */
export function StudioBrand({ children }: { children: ReactNode }) {
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
          document.documentElement.dataset.themeHash = theme.hash;
        }
      }).catch(() => {
        // The server-rendered official theme remains bound if Producer is unavailable.
      });
    };
    refresh();
    const events = new EventSource('/api/events');
    events.addEventListener('ready', refresh);
    events.addEventListener('change', refresh);
    return () => { request?.abort(); events.close(); };
  }, []);
  return children;
}
