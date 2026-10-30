import type { ReactNode } from 'react';
import type { DesignerSpecimenContext, SpecimenContentRenderRequest, SpecimenRenderParts, SpecimenSurfaceRenderRequest } from '@clossys/designer/studio';
import { renderNativeSpecimenComponentState, renderNativeSpecimenViewport } from './native-specimen-preview';
import { nativeSpecimenTokenHostParts } from './native-specimen-token-parts';

/** Descriptor-matched selected callbacks implement the section's declared callable parts. */
export function producerSpecimenRenderParts(context: DesignerSpecimenContext): SpecimenRenderParts {
  const renderSurface = ({ leaf, width, state }: SpecimenSurfaceRenderRequest): ReactNode => {
    const selected = context.profile.surfaces?.fills[leaf as `sections.${string}` | `frames.${string}`];
    const surface = context.surfaces?.[leaf];
    if (!selected || !surface || surface.descriptorHash !== selected.descriptorHash) throw new Error(`NEED: ${leaf}: the selected surface has no matching executable fixture binding.`);
    if (state !== 'default' && !surface.states?.includes(state)) throw new Error(`NEED: ${leaf}: no registered fixture for panel state ${state}.`);
    return surface.render({ width, state });
  };
  const renderContent = ({ leaf, ...props }: SpecimenContentRenderRequest): ReactNode => {
    const selected = context.profile.surfaces?.fills[leaf], surface = context.surfaces?.[leaf];
    if (!selected || surface?.descriptorHash !== selected.descriptorHash || !surface.renderContent) throw new Error(`NEED: ${leaf}: the selected surface has no descriptor-matched native content renderer.`);
    return surface.renderContent(props);
  };
  return {
    ...nativeSpecimenTokenHostParts(context),
    'sections.specimen-variant-matrix': { renderComponentState: renderNativeSpecimenComponentState },
    'sections.specimen-section-viewports': { renderSurface, renderViewport: renderNativeSpecimenViewport },
    'sections.specimen-frame-viewports': { renderSurface, renderViewport: renderNativeSpecimenViewport },
    'sections.specimen-copy-in-context': { renderContent },
    'sections.specimen-page-viewports': { renderViewport: context.pagePreview?.renderViewport },
  };
}
