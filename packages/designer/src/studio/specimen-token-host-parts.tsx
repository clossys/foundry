import type { ReactNode } from 'react';
import { componentSpecimenPreview } from './component-specimens.js';
import type { DesignerSpecimenContext } from './DesignerSpecimen.js';
import type { SpecimenContrastHostRequest, SpecimenSwatchHostRequest } from './specimen-token-host-part-types.js';
import { specimenTokenReference } from './specimen-token-reference.js';

function selectedContent(context: DesignerSpecimenContext) {
  const selected = componentSpecimenPreview({ ...context.componentOptions, modules: context.modules }).bind('components.semantic-content', context.profile);
  if ('refusal' in selected) throw new Error(`NEED: components.semantic-content: ${selected.refusal.detail}`);
  return selected.binding.Component;
}

/** Producer renders this content in the requested mode's real stylesheet document. */
export function renderSpecimenSwatchHostPart(context: DesignerSpecimenContext, input: SpecimenSwatchHostRequest): ReactNode {
  const Content = selectedContent(context);
  const reference = specimenTokenReference(context.profile.values, input.memberId, input.mode);
  return <Content as="span" role="img" aria-label={`${input.memberId} ${input.mode}`} style={{ display: 'inline-block', inlineSize: 'var(--spacing-5xl)', blockSize: 'var(--spacing-4xl)', background: reference.css }} />;
}

/** Every style channel is a current selected member reference, including the contrast pair. */
export function renderSpecimenContrastHostPart(context: DesignerSpecimenContext, input: SpecimenContrastHostRequest): ReactNode {
  const Content = selectedContent(context);
  const background = specimenTokenReference(context.profile.values, input.backgroundMemberId, input.mode);
  const color = specimenTokenReference(context.profile.values, input.colorMemberId, input.mode);
  const pair = specimenTokenReference(context.profile.values, input.pairMemberId, input.mode);
  if (![background.memberId, color.memberId].includes(pair.memberId)) throw new Error('NEED: the selected contrast pair is absent from the declared token references.');
  return <Content as="p" data-contrast-pair={pair.memberId} style={{ background: background.css, color: color.css }}>{input.children}</Content>;
}
