import type { ReactNode } from 'react';
import { componentSpecimenPreview, renderSpecimenContrastHostPart, renderSpecimenSwatchHostPart, STUDIO_SPECIMEN_HOST_PARTS, type DesignerSpecimenContext, type SpecimenContrastHostRequest, type SpecimenNativeViewportRequest, type SpecimenSwatchHostRequest, type SpecimenTokenHostParts } from '@clossys/designer/studio';
import { NativeSpecimenViewport } from './native-specimen-preview';

function selectedContent(context: DesignerSpecimenContext): SpecimenNativeViewportRequest['Content'] {
  const selected = componentSpecimenPreview({ ...context.componentOptions, modules: context.modules }).bind('components.semantic-content', context.profile);
  if ('refusal' in selected) throw new Error(`NEED: components.semantic-content: ${selected.refusal.detail}`);
  return selected.binding.Component as SpecimenNativeViewportRequest['Content'];
}

/** The existing live viewport owns the actual mode document and selected stylesheet. */
function NativeSpecimenSwatch({ context, input }: { context: DesignerSpecimenContext; input: SpecimenSwatchHostRequest }): ReactNode {
  const Content = selectedContent(context);
  return <Content as="div" style={{ inlineSize: 'var(--spacing-5xl)', blockSize: 'var(--spacing-4xl)' }}>
    <NativeSpecimenViewport Content={Content} leaf="studio.specimen-swatch" documentMode={input.mode} need={({ reason }) => <Content as="div" data-ds-specimen-need="true">{reason}</Content>} children={() => renderSpecimenSwatchHostPart(context, input)} />
  </Content>;
}
function NativeSpecimenContrast({ context, input }: { context: DesignerSpecimenContext; input: SpecimenContrastHostRequest }): ReactNode {
  const Content = selectedContent(context);
  return <NativeSpecimenViewport Content={Content} leaf="studio.specimen-contrast" documentMode={input.mode} need={({ reason }) => <Content as="div" data-ds-specimen-need="true">{reason}</Content>} children={() => renderSpecimenContrastHostPart(context, input)} />;
}

export function nativeSpecimenTokenHostParts(context: DesignerSpecimenContext): SpecimenTokenHostParts {
  const swatch = STUDIO_SPECIMEN_HOST_PARTS['studio.specimen-swatch'], contrast = STUDIO_SPECIMEN_HOST_PARTS['studio.specimen-contrast'];
  if (swatch?.module !== '@clossys/designer/studio' || swatch.export !== 'renderSpecimenSwatchHostPart' || contrast?.module !== swatch.module || contrast.export !== 'renderSpecimenContrastHostPart') throw new Error('NEED: the selected Studio token host part registration is unavailable.');
  return {
    'studio.specimen-swatch': input => <NativeSpecimenSwatch context={context} input={input} />,
    'studio.specimen-contrast': input => <NativeSpecimenContrast context={context} input={input} />,
  };
}
