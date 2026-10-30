import tokenSlots from '../catalog/slots/tokens.json' with { type: 'json' };
import type { Resolved, Slot, TokenContract } from '../catalog-core/types.js';

/** The token's registered emit mapping supplies the property; a caller supplies only its member id. */
export function specimenTokenReference(values: Resolved, memberId: string, mode: 'light' | 'dark') {
  const member = values.members[memberId];
  const slot = (tokenSlots as readonly Slot<TokenContract>[]).find(slot => slot.id === member?.slot);
  const name = slot && memberId.startsWith(slot.id + '.') ? memberId.slice(slot.id.length + 1) : undefined;
  const property = name === undefined ? undefined : slot?.contract.emit?.[name];
  const type = name === undefined ? undefined : slot?.contract.memberTypes?.[name] ?? slot?.contract.$type;
  if (!member || !slot || !name || !property || property !== member.emit || !/^--[a-zA-Z][a-zA-Z0-9-]*$/.test(property)
    || member.$type !== type || !['color', 'gradient'].includes(member.$type)
    || !['light', 'dark'].includes(mode) || (mode === 'dark' && !slot.contract.modes.includes('dark'))
    || (slot.contract.members.mode === 'closed' && !slot.contract.members.names.includes(name))
    || (slot.contract.members.mode === 'open' && !new RegExp(slot.contract.members.pattern).test(name))) {
    throw new Error(`NEED: ${memberId}: the selected token has no matching registered color reference.`);
  }
  return Object.freeze({ memberId, slot: slot.id, property, css: `var(${property})` as `var(--${string})`, selectionHash: values.selectionHash });
}
