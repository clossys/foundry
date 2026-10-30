import type { AgentCells, CellDetail } from './cells-client';
import { directorSections } from './director-specimen';
import { safePreviewUrl, selectedPublishedPage, type PublicationResponse } from './publisher-preview';
import { writerProjection } from './writer-specimen';

/** Source inventory only. A registered Designer section decides whether each item renders. */
export interface AgentSpecimenPlan {
  cellId: string;
  items: Record<string, unknown>[];
  expectedVariantIds: string[];
  issues: string[];
}

/** Preserve every source variant before the selected-section binding checks readiness. */
export function agentSpecimenPlan(index: AgentCells, cell: CellDetail, publication?: PublicationResponse): AgentSpecimenPlan {
  const plan: AgentSpecimenPlan = { cellId: cell.id, items: [], expectedVariantIds: [], issues: [] };
  if (index.agent !== cell.agent || !index.cells.some(entry => entry.id === cell.id)) {
    plan.issues.push('The specimen cell does not belong to this agent index.');
    return plan;
  }
  if (index.state !== 'ready') plan.issues.push(index.error ?? 'The agent cell index is unavailable.');
  if (cell.agent === 'director') {
    const sections = directorSections(cell.content);
    plan.items = sections.map((section, position) => ({ id: `${cell.id}:${section.title.toLowerCase()}:${position + 1}`, kind: 'director', title: section.title, value: section.value }));
    plan.expectedVariantIds = plan.items.map(item => String(item.id));
    // An empty declared passage must not disappear into a passing nonempty inventory.
    const body = cell.content.replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
    let fenced = false;
    let declared = 0;
    for (const line of body.split(/\r?\n/)) {
      if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
      if (!fenced && /^#{1,6}\s+(?:Direction|Because|Watch)\s*$/.test(line)) declared++;
    }
    if (declared > sections.length) plan.issues.push('A declared Director passage has no supported semantic content.');
    if (!plan.items.length) plan.issues.push('No Director semantic passages are available.');
    return plan;
  }
  if (cell.agent === 'writer') {
    const projection = writerProjection(cell);
    plan.issues.push(...projection.gaps);
    const records = projection.records.filter(copy => {
      if (!/^en(?:-|$)/i.test(copy.locale)) return false;
      // VoiceRules and glossary records feed Inspector, not the copy specimen stage.
      const voiceOnly = copy.text === undefined && copy.role === 'unknown' &&
        (copy.record.rules !== null && typeof copy.record.rules === 'object' && !Array.isArray(copy.record.rules) || Array.isArray(copy.record.glossary));
      return !voiceOnly;
    });
    plan.items = records.map((copy, position) => {
      const id = `${cell.id}:${copy.locale}:${copy.id}:${position + 1}`;
      if (copy.role === 'unknown') plan.issues.push(`Writer context has no supported specimen role: ${copy.context}`);
      if (typeof copy.text !== 'string' || !copy.text.trim()) plan.issues.push(`Writer context has no produced copy: ${copy.context}`);
      return { id, kind: 'writer', role: copy.role, context: copy.context, locale: copy.locale, ...(copy.text === undefined ? {} : { value: copy.text }), record: copy.record };
    });
    plan.expectedVariantIds = plan.items.map(item => String(item.id));
    if (!records.length) plan.issues.push('No English Writer records are available.');
    return plan;
  }
  if (cell.agent === 'publisher') {
    const viewports = [{ id: 'desktop', width: 1440, height: 900 }, { id: 'mobile', width: 390, height: 844 }];
    plan.expectedVariantIds = viewports.map(viewport => `${cell.id}:${viewport.id}`);
    if (!publication || publication.state !== 'ready') {
      plan.issues.push(publication ? publication.message : 'The emitted publication is unavailable.');
      return plan;
    }
    // Cell detail can carry the route linkage absent from the generic index summary.
    const detailedIndex = { ...index, cells: index.cells.map(entry => entry.id === cell.id ? { ...entry, ...cell } : entry) };
    const page = selectedPublishedPage(detailedIndex, cell.id, publication.pages);
    if (!page?.emitted || !safePreviewUrl(page.previewUrl)) {
      plan.issues.push('No browser-renderable emitted page is available for this Publisher cell.');
      return plan;
    }
    plan.items = viewports.map(viewport => ({ id: `${cell.id}:${viewport.id}`, kind: 'publisher', page, viewport }));
    return plan;
  }
  plan.issues.push('The Designer specimen source capability is not available.');
  return plan;
}
