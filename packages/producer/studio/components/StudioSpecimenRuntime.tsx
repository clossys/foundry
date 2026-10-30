'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import * as DesignerStudio from '@clossys/designer/studio';
import { nativeSpecimenSDK, nativeSpecimenContext, bindNativeAgentSpecimen, bindNativeDesignerSpecimen, type NativeSpecimenContext } from '../lib/native-specimen-runtime';
import { validateDirectorNativeSpecimen } from './director-specimen-ds';
import { producerPagePreview } from '../lib/producer-page-preview';
import { SpecimenLeafProvider, type ResolveSpecimenLeaf } from './AgentL3Specimen';
import { useStudioSelection, useStudioUI } from './StudioSelection';

interface NativeRuntime { context?: NativeSpecimenContext; issues: string[] }
const NativeRuntimeContext = createContext<NativeRuntime>({ issues: ['The selected native specimen provider is unavailable.'] });
export function useNativeSpecimenRuntime(): NativeRuntime { return useContext(NativeRuntimeContext); }

/** One selected-runtime bridge serves both Studio rows and content-only routes. */
export function StudioSpecimenRuntimeProvider({ children }: { children: ReactNode }) {
  const { profile, runtime } = useStudioSelection();
  const { EmptyState } = useStudioUI();
  const sdk = nativeSpecimenSDK(DesignerStudio as unknown as Record<string, unknown>);
  const native = useMemo(() => nativeSpecimenContext(sdk, profile, runtime), [sdk, profile, runtime]);
  const need = useCallback(({ leaf, reason }: { leaf: string; reason: string }) => <EmptyState role="status" title={`NEED: ${leaf}`} description={reason} />, [EmptyState]);
  const resolve = useCallback<ResolveSpecimenLeaf>(({ index, cell, plan, publication, expanded }) => {
    const pagePreview = publication && typeof window !== 'undefined' ? producerPagePreview(publication, window.location.origin) : undefined;
    const context = native.context && pagePreview ? { ...native.context, pagePreview } : native.context;
    const common = { sdk, context, expanded, need, labels: { showAllVariants: (count: number) => `Show all ${count} variants` } };
    const bound = index.agent === 'designer' ? bindNativeDesignerSpecimen({ ...common, cell }) : bindNativeAgentSpecimen({ ...common, agent: index.agent, plan, ...(typeof cell.fields?.specimen === 'string' ? { specimen: cell.fields.specimen } : {}) });
    const result = index.agent === 'director' ? validateDirectorNativeSpecimen(bound) : bound;
    return { sourcePlan: result.sourcePlan, Component: result.Component, props: result.props, evidence: { sectionId: result.sectionId ?? '', registered: result.registered, span: result.span, items: result.items, variantIds: result.variantIds, issues: [...native.issues, ...result.issues] } };
  }, [sdk, native, need]);
  return <NativeRuntimeContext.Provider value={native}><SpecimenLeafProvider resolve={resolve}>{children}</SpecimenLeafProvider></NativeRuntimeContext.Provider>;
}
