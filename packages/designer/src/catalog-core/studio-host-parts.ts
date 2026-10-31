import themeSlots from '../catalog/slots/themes.json' with { type: 'json' };
import type { Resolved, ResolvedMember, Slot, TokenContract } from './types.js';

/** Studio infrastructure identities are separate from consumer design leaves. */
export const STUDIO_SPECIMEN_HOST_PARTS = {
  'studio.specimen-swatch': {
    module: '@clossys/designer/studio',
    export: 'renderSpecimenSwatchHostPart',
    source: 'studio/specimen-token-host-parts.tsx',
    tokenInputs: ['memberId'],
    styleProperties: ['background'],
    styleConstructor: { module: '@clossys/designer/studio', export: 'studioSpecimenTokenStyle' },
  },
  'studio.specimen-contrast': {
    module: '@clossys/designer/studio',
    export: 'renderSpecimenContrastHostPart',
    source: 'studio/specimen-token-host-parts.tsx',
    tokenInputs: ['backgroundMemberId', 'colorMemberId', 'pairMemberId'],
    styleProperties: ['background', 'color'],
    styleConstructor: { module: '@clossys/designer/studio', export: 'studioSpecimenTokenStyle' },
  },
} as const;
export type StudioSpecimenHostPartId = keyof typeof STUDIO_SPECIMEN_HOST_PARTS;

declare const referenceBrand: unique symbol;
export type StudioTokenReference = { readonly [referenceBrand]: true };
type Mode = 'light' | 'dark';
interface ReferenceFact { readonly values: Resolved; readonly selectionHash: string; readonly member: ResolvedMember; readonly memberId: string; readonly mode: Mode; readonly property: string }
const references = new WeakMap<object, ReferenceFact>();
const registry = themeSlots as unknown as readonly Slot<TokenContract>[];

function registered(values: Resolved, memberId: string, mode: Mode, types: readonly string[] = ['color', 'gradient']) {
  const member = values.members[memberId], slot = registry.find(slot => slot.id === member?.slot);
  const name = slot && memberId.startsWith(slot.id + '.') ? memberId.slice(slot.id.length + 1) : undefined;
  const property = name === undefined ? undefined : slot?.contract.emit?.[name];
  const type = name === undefined ? undefined : slot?.contract.memberTypes?.[name] ?? slot?.contract.$type;
  if (!member || !slot || !name || !property || member.emit !== property || !/^--[a-zA-Z][a-zA-Z0-9-]*$/.test(property)
    || member.$type !== type || !types.includes(member.$type) || !['light', 'dark'].includes(mode) || !slot.contract.modes.includes(mode)
    || (slot.contract.members.mode === 'closed' && !slot.contract.members.names.includes(name))
    || (slot.contract.members.mode === 'open' && !new RegExp(slot.contract.members.pattern).test(name))) {
    throw new Error(`NEED: ${memberId}: the selected token has no matching registered color reference.`);
  }
  return { member, property, slot: slot.id };
}

/** Internal mint. No CSS string or property supplied by a resolver is trusted. */
export function createStudioTokenReference(values: Resolved, memberId: string, mode: Mode): StudioTokenReference {
  const { member, property } = registered(values, memberId, mode);
  const reference = Object.freeze({}) as StudioTokenReference;
  references.set(reference, { values, selectionHash: values.selectionHash, member, memberId, mode, property });
  return reference;
}
function read(values: Resolved, memberId: string, mode: Mode, reference: StudioTokenReference, colorOnly = false): string {
  const expected = registered(values, memberId, mode, colorOnly ? ['color'] : ['color', 'gradient']);
  const fact = reference && references.get(reference);
  if (!fact || fact.values !== values || fact.selectionHash !== values.selectionHash || fact.member !== expected.member
    || fact.memberId !== memberId || fact.mode !== mode || fact.property !== expected.property) throw new Error(`NEED: ${memberId}: the Studio token reference is not bound to this selected member and mode.`);
  return `var(${expected.property})`;
}
type SwatchInput = { readonly memberId: string; readonly mode: Mode };
type ContrastInput = { readonly backgroundMemberId: string; readonly colorMemberId: string; readonly pairMemberId: string; readonly mode: Mode };
type SwatchReferences = { readonly member: StudioTokenReference };
type ContrastReferences = { readonly background: StudioTokenReference; readonly color: StudioTokenReference; readonly pair: StudioTokenReference };

/** Fixed registered-part styling, independently authenticated at every use. */
export function studioSpecimenTokenStyle(part: 'studio.specimen-swatch', values: Resolved, input: SwatchInput, refs: SwatchReferences): { display: 'inline-block'; inlineSize: string; blockSize: string; background: string };
export function studioSpecimenTokenStyle(part: 'studio.specimen-contrast', values: Resolved, input: ContrastInput, refs: ContrastReferences): { background: string; color: string };
export function studioSpecimenTokenStyle(part: StudioSpecimenHostPartId, values: Resolved, input: SwatchInput | ContrastInput, refs: SwatchReferences | ContrastReferences) {
  if (part === 'studio.specimen-swatch') {
    const request = input as SwatchInput, references = refs as SwatchReferences;
    const width = registered(values, 'themes.spacing.default', 'light', ['dimension']), height = registered(values, 'themes.spacing.default', 'light', ['dimension']);
    if (width.property !== '--spacing-5xl' || height.property !== '--spacing-4xl') throw new Error('NEED: the Studio swatch layout token mapping differs.');
    return { display: 'inline-block' as const, inlineSize: 'var(--spacing-5xl)', blockSize: 'var(--spacing-4xl)', background: read(values, request.memberId, request.mode, references.member) };
  }
  if (part === 'studio.specimen-contrast') {
    const request = input as ContrastInput, references = refs as ContrastReferences;
    if (![request.backgroundMemberId, request.colorMemberId].includes(request.pairMemberId)) throw new Error('NEED: the contrast pair is absent from the declared token references.');
    read(values, request.pairMemberId, request.mode, references.pair, true);
    return { background: read(values, request.backgroundMemberId, request.mode, references.background), color: read(values, request.colorMemberId, request.mode, references.color, true) };
  }
  throw new Error('NEED: no registered Studio token style part.');
}
