import type { ReactNode } from 'react';
import type { DesignerSpecimenContext, DesignerSpecimenNeed, SpecimenPagePreviewPort } from '@clossys/designer/studio';
import { ProducerSpecimenComponent } from '../components/ProducerSpecimenComponent';
import { ProducerSpecimenViewport } from '../components/ProducerSpecimenViewport';

type Need = (need: DesignerSpecimenNeed) => ReactNode;
type ComponentInput = Omit<Parameters<typeof ProducerSpecimenComponent>[0], 'context'>;
type ViewportInput = Omit<Parameters<typeof ProducerSpecimenViewport>[0], 'context'>;
interface SurfaceInput { leaf: string; width: number; state: string; need: Need }
interface ContentInput { leaf: 'sections.section-header' | 'sections.empty-state'; props: Readonly<Record<string, unknown>>; need: Need }

/** Separate section signatures preserve the native and published-page viewport ABIs. */
export interface ProducerSpecimenRenderParts {
  'sections.specimen-variant-matrix': { renderComponentState(input: ComponentInput): ReactNode };
  'sections.specimen-section-viewports': { renderSurface(input: SurfaceInput): ReactNode; renderViewport(input: ViewportInput): ReactNode };
  'sections.specimen-frame-viewports': { renderSurface(input: SurfaceInput): ReactNode; renderViewport(input: ViewportInput): ReactNode };
  'sections.specimen-copy-in-context': { renderContent(input: ContentInput): ReactNode };
  'sections.specimen-page-viewports': { renderViewport(input: Parameters<SpecimenPagePreviewPort['renderViewport']>[0]): ReactNode };
}

/** Exact selected callbacks supply the declared parts; no implementation is selected here. */
export function producerSpecimenRenderParts(context: DesignerSpecimenContext): ProducerSpecimenRenderParts {
  const renderSurface = ({ leaf, width, state, need }: SurfaceInput): ReactNode => {
    const selected = context.profile.surfaces?.fills[leaf as `sections.${string}` | `frames.${string}`];
    const surface = context.surfaces?.[leaf];
    if (!selected || !surface || surface.descriptorHash !== selected.descriptorHash) return need({ leaf, reason: 'The selected surface has no matching executable fixture binding.' });
    if (state !== 'default' && !surface.states?.includes(state)) return need({ leaf, reason: `No registered fixture for panel state ${state}.` });
    return surface.render({ width, state });
  };
  const renderViewport = (input: ViewportInput) => <ProducerSpecimenViewport {...input} context={context} />;
  return {
    'sections.specimen-variant-matrix': { renderComponentState: input => <ProducerSpecimenComponent {...input} context={context} /> },
    'sections.specimen-section-viewports': { renderSurface, renderViewport },
    'sections.specimen-frame-viewports': { renderSurface, renderViewport },
    'sections.specimen-copy-in-context': { renderContent: ({ leaf, props, need }) => {
      const selected = context.profile.surfaces?.fills[leaf], surface = context.surfaces?.[leaf];
      return selected && surface?.descriptorHash === selected.descriptorHash && surface.renderContent ? surface.renderContent(props) : need({ leaf, reason: 'The selected surface has no descriptor-matched native content renderer.' });
    } },
    'sections.specimen-page-viewports': { renderViewport: input => context.pagePreview?.renderViewport(input) ?? null },
  };
}
