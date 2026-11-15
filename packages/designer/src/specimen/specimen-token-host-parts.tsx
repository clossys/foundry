import type { ReactNode } from 'react';
import { componentSpecimenPreview } from './component-specimens.js';
import type { DesignerSpecimenContext } from './DesignerSpecimen.js';
import type { SpecimenContrastHostRequest, SpecimenSwatchHostRequest } from './specimen-token-host-part-types.js';
import { specimenTokenReference } from './specimen-token-reference.js';
import { studioSpecimenTokenStyle } from '../catalog-core/studio-host-parts.js';

function selectedContent(context: DesignerSpecimenContext) {
  const selected = componentSpecimenPreview({ ...context.componentOptions, modules: context.modules }).bind('components.semantic-content', context.profile);
  if ('refusal' in selected) throw new Error(`NEED: components.semantic-content: ${selected.refusal.detail}`);
  return selected.binding.Component;
}

/** Producer renders this content in the requested mode's real stylesheet document. */
export function renderSpecimenSwatchHostPart(context: DesignerSpecimenContext, input: SpecimenSwatchHostRequest): ReactNode {
  const Content = selectedContent(context);
  const reference = specimenTokenReference(context.profile.values, input.memberId, input.mode);
  return <Content as="span" role="img" aria-label={`${input.memberId} ${input.mode}`} style={studioSpecimenTokenStyle('studio.specimen-swatch', context.profile.values, input, { member: reference })} />;
}

/** Every style channel is a current selected member reference, including the contrast pair. */
export function renderSpecimenContrastHostPart(context: DesignerSpecimenContext, input: SpecimenContrastHostRequest): ReactNode {
  const Content = selectedContent(context);
  const background = specimenTokenReference(context.profile.values, input.backgroundMemberId, input.mode);
  const color = specimenTokenReference(context.profile.values, input.colorMemberId, input.mode);
  const pair = specimenTokenReference(context.profile.values, input.pairMemberId, input.mode);
  return <Content as="p" data-contrast-pair={input.pairMemberId} style={studioSpecimenTokenStyle('studio.specimen-contrast', context.profile.values, input, { background: background, color: color, pair: pair })}>{input.children}</Content>;
}
