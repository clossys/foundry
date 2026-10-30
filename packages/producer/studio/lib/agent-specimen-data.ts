import type { AgentCells, CellDetail, CellContentScope } from './cells-client';
import { directorProjection } from './director-specimen';
import { safePreviewUrl, selectedPublishedPage, type PublicationResponse } from './publisher-preview';
import { writerProjection } from './writer-specimen';

/** Source inventory only. A registered Designer section decides whether each item renders. */
export interface AgentSpecimenAxis { id: string; label: string; values: { id: string; label: string }[] }

export interface AgentSpecimenPlan {
  cellId: string;
  scope?: CellContentScope;
  items: Record<string, unknown>[];
  expectedVariantIds: string[];
  issues: string[];
  axes?: AgentSpecimenAxis[];
}

/** Preserve every source variant before the selected-section binding checks readiness. */
export function agentSpecimenPlan(index: AgentCells, cell: CellDetail, publication?: PublicationResponse): AgentSpecimenPlan {
  const plan: AgentSpecimenPlan = { cellId: cell.id, ...(index.contentScope ? { scope: index.contentScope } : {}), items: [], expectedVariantIds: [], issues: [] };
  if (index.agent !== cell.agent || !index.cells.some(entry => entry.id === cell.id)) {
    plan.issues.push('The specimen cell does not belong to this agent index.');
    return plan;
  }
  if (index.state !== 'ready') plan.issues.push(index.error ?? 'The agent cell index is unavailable.');
  if (cell.agent === 'director') {
    const projection = directorProjection(cell.content);
    plan.issues.push(...projection.issues);
    plan.items = projection.sections.map((section, position) => ({ id: `${cell.id}:${section.title.toLowerCase()}:${position + 1}`, kind: 'director', title: section.title, value: section.value }));
    plan.expectedVariantIds = plan.items.map(item => String(item.id));
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
      return { id, kind: 'writer', role: copy.role, context: copy.context, locale: copy.locale, coordinates: { string: id, context: copy.context }, ...(copy.text === undefined ? {} : { value: copy.text }), record: copy.record };
    });
    plan.expectedVariantIds = plan.items.map(item => String(item.id));
    if (!records.length) plan.issues.push('No English Writer records are available.');
    if (records.length > 1) {
      const contexts = [...new Set(records.map(record => record.context))];
      if (contexts.some(context => !context.trim())) plan.issues.push('A Writer matrix record has no source context.');
      else plan.axes = [
        { id: 'string', label: 'String', values: plan.items.map((item, position) => ({ id: String(item.id), label: records[position]!.id })) },
        { id: 'context', label: 'Context', values: contexts.map(context => ({ id: context, label: context })) },
      ];
    }
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
