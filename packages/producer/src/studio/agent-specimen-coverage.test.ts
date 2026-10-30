import { describe, expect, it } from 'vitest';
import { agentSpecimenCoverage, type ResolvedSpecimenEvidence } from '../../studio/lib/agent-specimen-coverage';
import type { AgentSpecimenPlan } from '../../studio/lib/agent-specimen-data';

// Anonymous contract controls are not evidence of a consumer-selected leaf registration.
const plan: AgentSpecimenPlan = { cellId: 'sample.page', items: [{ id: 'one' }, { id: 'two' }], expectedVariantIds: ['one', 'two'], issues: [] };
const binding: ResolvedSpecimenEvidence = { sectionId: 'sections.specimen-example', registered: true, span: 'full', items: plan.items, variantIds: ['one', 'two'] };
describe('bound specimen consumer contract', () => {
  it('counts all variants independently from the visible item group', () => {
    expect(agentSpecimenCoverage(plan, binding)).toMatchObject({ ready: true, itemCount: 2, expectedVariantIds: ['one', 'two'], variants: [{ id: 'one', renderable: true }, { id: 'two', renderable: true }] });
  });
  it('fails an absent or unregistered binding instead of counting fallback output', () => {
    expect(agentSpecimenCoverage(plan).ready).toBe(false);
    expect(agentSpecimenCoverage(plan, { ...binding, registered: false }).ready).toBe(false);
    expect(agentSpecimenCoverage(plan, { ...binding, sectionId: 'sections.content' }).ready).toBe(false);
  });
  it.each(['full', 'half', 'third'] as const)('passes through only the actual declared %s span', span => {
    expect(agentSpecimenCoverage(plan, { ...binding, span })).toMatchObject({ ready: true, span });
  });
  it('fails missing or invalid leaf spans without assigning a default', () => {
    for (const span of [undefined, 'quarter', 'FULL', ''] as const) {
      const result = agentSpecimenCoverage(plan, { ...binding, span } as ResolvedSpecimenEvidence);
      expect(result.ready).toBe(false); expect(result.span).toBeUndefined();
      expect(result.variants.every(variant => !variant.renderable)).toBe(true);
    }
  });
  it('fails zero items even when the adapter declares every expected variant', () => {
    expect(agentSpecimenCoverage(plan, { ...binding, items: [] })).toMatchObject({ ready: false, itemCount: 0 });
    expect(agentSpecimenCoverage(plan, { ...binding, items: undefined as unknown as [] }).ready).toBe(false);
  });
  it('detects a hidden missing variant without shrinking the expected source inventory', () => {
    const result = agentSpecimenCoverage(plan, { ...binding, variantIds: ['one'] });
    expect(result.ready).toBe(false); expect(result.expectedVariantIds).toEqual(['one', 'two']);
    expect(result.variants.find(variant => variant.id === 'two')?.renderable).toBe(false);
  });
  it('refuses empty, duplicated, unknown, and failed source inventories', () => {
    expect(agentSpecimenCoverage({ ...plan, items: [], expectedVariantIds: [] }, binding).ready).toBe(false);
    expect(agentSpecimenCoverage({ ...plan, expectedVariantIds: ['one', 'one'] }, binding).ready).toBe(false);
    expect(agentSpecimenCoverage(plan, { ...binding, variantIds: ['one', 'two', 'two'] }).ready).toBe(false);
    expect(agentSpecimenCoverage(plan, { ...binding, variantIds: ['one', 'two', 'invented'] }).ready).toBe(false);
    expect(agentSpecimenCoverage({ ...plan, issues: ['Actual source incomplete.'] }, binding).ready).toBe(false);
  });
});
