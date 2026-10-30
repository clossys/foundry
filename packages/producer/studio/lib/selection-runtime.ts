'use client';

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as JSXRuntime from 'react/jsx-runtime';
import * as JSXDevRuntime from 'react/jsx-dev-runtime';
import * as ReactDOMClient from 'react-dom/client';
import type { CompositeResolved } from '@clossys/designer/catalog';

/** Emitted consumer modules share the host React instance. */
export function bindStudioRuntimeDependencies() {
  Object.assign(globalThis, { __studioDesignerRuntime: {
    react: React, 'react-dom': ReactDOM, 'react/jsx-runtime': JSXRuntime, 'react/jsx-dev-runtime': JSXDevRuntime,
    'react-dom/client': ReactDOMClient,
  } });
}

export interface StudioRuntimeModule {
  ComponentProvider?: React.ComponentType<{ profile: CompositeResolved; children: React.ReactNode }>;
  components: Record<string, unknown>;
  surfaces: Record<string, unknown>;
  tree: Record<string, unknown>;
  disclosure: Record<string, unknown>;
  table?: Record<string, unknown>;
}
export async function importStudioRuntime(url: string): Promise<StudioRuntimeModule> {
  bindStudioRuntimeDependencies();
  // Producer serves the compiled, content-addressed module outside Next's build graph.
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as Promise<StudioRuntimeModule>;
}
