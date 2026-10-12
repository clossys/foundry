import { createCopyResolver, type CopyRef, type CopyRegistryEntry } from '@clossys/writer';
import { READER_COPY } from './reader-copy.js';
import { desugarRecipe } from '../../core/content-contract.js';
import type { SectionedViewSection } from '../../core/sectioned-view.js';
import { CATALOG_FIXTURES, CATALOG_COPY_REGISTRY, CATALOG_COMPOSITIONS, catalogCopyResolver, type CatalogFixture } from './index.js';

export const READER_FUNCTIONS = ['Introduce', 'Show', 'Explain', 'Index', 'Sequence', 'Compare'] as const;
export type ReaderFunction = typeof READER_FUNCTIONS[number];
export type ReaderPage = ReaderFunction | 'Overview' | 'Frame' | 'Parts';
export function deriveCatalogFunction(section: SectionedViewSection): ReaderFunction {
  if (section.kind === 'hero') return 'Introduce';
  if (section.kind !== 'content-section') throw new Error('Reader samples require a canonical band.');
  const block = section.block;
  if (block?.type === 'matrix') return 'Compare';
  if (block?.type === 'items') {
    const effective = desugarRecipe(block);
    if (effective.order !== 'none') return 'Sequence';
    if (section.media !== undefined && section.layout !== 'stacked' && effective.reveal !== 'disclose' && (effective.arrangement === 'rows' || effective.arrangement === 'stacked')) return 'Show';
    if (effective.reveal === 'disclose' || effective.arrangement === 'rows' || block.recipe === 'link-index') return 'Index';
    return 'Explain';
  }
  return section.media === undefined ? 'Introduce' : 'Show';
}
const titles: Record<string, string> = {
  'say-hero-display':'Bring scattered work into focus', 'say-hero-compact':'A guide to your shared workspace', 'say-intro':'A clear place to begin', 'say-header-split':'Built for everyday coordination', 'say-close':'Start with one shared workspace',
  'say-media-stacked':'See the project at a glance', 'media-key':'Read every part of the record', 'frame-split-start':'Keep source files close', 'media-record-one':'Focus on the next review', 'media-record-three':'Put context beside the owner', 'media-converge':'Turn scattered inputs into one record', 'media-evidence':'Trace each result to its source',
  'items-plain':'Find, share, and remember your work', 'items-rule':'Two ways to stay aligned', 'items-columns':'Three principles for clear work', 'items-bento':'A workspace for the whole project', 'items-stacked':'Context for each decision',
  'items-rows':'Explore the tools in your workspace', 'items-icon-groups':'Find the right reference for today', 'items-plate':'Choose your next step', 'items-disclose':'Questions before you begin', 'frame-split-end':'Find the right starting point',
  'items-numbered':'Prepare your first review', 'items-connected':'From draft to a clear decision', 'items-flow-five':'A clear hand-off between roles', 'matrix-points':'Compare two ways to coordinate', 'matrix-visuals':'See the difference in context',
  'recipes-nav-composition':'Build a shared workspace together', 'frame-actions':'Move from reading to doing', 'items-badge-meta':'Read state beside useful context', 'media-meter-previous':'See how review capacity changes',
};
export const READER_PRUNED = ['media-specimen','items-eyebrow','items-visual','items-link','items-featured','items-two-lane-list','matrix-featured-description','frame-ground-base','frame-ground-sunken','frame-ground-inverse','frame-compact','frame-center'] as const;
const entries: CopyRegistryEntry[] = [];
let serial = 0;
function ref(sample: string, text: string): CopyRef {
  const id = `catalog.reader.${sample}.copy-${++serial}`;
  entries.push({id,text,context:'Reader catalog example',status:'approved'});
  return {id};
}
function rewrite(value: unknown, sample: string, path = ''): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach((item,index) => rewrite(item,sample,`${path}.${index}`)); return; }
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 1 && 'id' in item && typeof item.id === 'string') {
      const previous = catalogCopyResolver({id:item.id});
      if (previous !== undefined) {
        const slot = `${path}.${key}`;
        let text = previous.text.replaceAll('Sample','Project').replaceAll('sample','project');
        if (slot === '.heading') text = titles[sample]!;
        else if (slot.match(/^\.actions\.\d+\.label$/)) text = slot.includes('.0.') ? 'Open workspace' : 'Read the guide';
        else if (slot === '.description') text = 'Keep project details together so teammates can find the context and choose the next action.';
        else if (slot.includes('.input.')) { const source = slot.match(/sources\.items\.(\d+)\.label$/); text = source ? ['Project brief','Team update','Task list','Meeting agenda','Review notes','Signed checklist','Review date'][Number(source[1])]! : /label$/.test(slot) ? 'Project brief' : /text$/.test(slot) ? 'Verified' : text; }
        else if (slot.endsWith('.description')) text = 'Keep this detail beside the record so the next reviewer has clear context.';
        else if (slot === '.media.label') text = ('type' in value && value.type === 'scene') ? 'Project documents connect to a shared result with clear labels, source details, and review relationships.' : 'Project details showing the owner, current state, and next review.';
        else if (slot.endsWith('.key.label')) text = 'A guide to the record details';
        else if (slot.endsWith('.key.items.0.heading')) text = 'Record identity';
        else if (slot.endsWith('.title')) text = 'Review record';
        else if (key === 'label' && 'tone' in value) text = ({neutral:'Draft',success:'Checked',warning:'Needs review',danger:'Blocked',info:'Updated'} as Record<string,string>)[String(value.tone)] ?? text;
        else if (slot.endsWith('.meta')) text = 'Due tomorrow';
        else if (slot.endsWith('.eyebrow')) text = 'Project work';
        // Numeric meter text and initials keep their existing truthful value.
        const target = value as Record<string, unknown>;
        target[key] = ref(sample,text);
      }
    } else rewrite(item,sample,`${path}.${key}`);
  }
}
const itemTitles: Record<string, string[]> = {
  'items-plain':['Search records','Share a workspace','Keep a history'], 'items-rule':['Clear ownership','Visible progress'], 'items-columns':['One source','Shared context','Visible next steps'],
  'items-bento':['Project overview','Review queue','Source library','Team calendar','Decision history','Access settings'], 'items-stacked':['Gather the brief','Record the outcome'], 'items-rows':['Projects','Reviews','Documents','Decisions'],
  'items-icon-groups':['Quick start','Workspace setup','Source library','Review queue','Team roles','Shared calendar','Access rules','Audit checks'], 'items-plate':['Open the guide','Browse examples','Read the checklist'],
  'items-disclose':['Where do files live?','Who can review a record?','Can a review be reopened?','How do I find older decisions?'], 'frame-split-end':['Quick start','Workspace reference'], 'items-numbered':['Gather the brief','Check the details','Assign a reviewer'],
  'items-connected':['Prepare brief','Review details','Record outcome'], 'items-flow-five':['Submit brief','Check details','Request changes','Update brief','Resubmit review'], 'items-badge-meta':['Source library','Review queue','Shared calendar','Decision history','Access settings','Project archive'],
};
function applyCopyOverrides(section:SectionedViewSection,sample:string):void {
  for (const [slot,text] of Object.entries(READER_COPY[sample] ?? {})) {
    const keys=slot.slice(1).split('.'); const last=keys.pop()!; let node:unknown=section;
    for (const key of keys) {if(node===null||typeof node!=='object'||!(key in node))throw new Error(`Missing catalog copy slot ${sample}${slot}.`);node=(node as Record<string,unknown>)[key];}
    if(node===null||typeof node!=='object'||!(last in node))throw new Error(`Missing catalog copy slot ${sample}${slot}.`);
    const record=node as Record<string,unknown>;const previous=record[last];
    if(previous!==null&&typeof previous==='object'&&'id' in previous)record[last]=ref(sample,text);
    else if(last==='icon'&&typeof previous==='string')record[last]=text;
    else throw new Error(`Catalog copy slot ${sample}${slot} is not copy or an icon.`);
  }
}
function prepare(fixture: CatalogFixture, index: number): CatalogFixture {
  const section = structuredClone(fixture.section);
  rewrite(section,fixture.id);
  if (section.kind === 'content-section') {
    Reflect.deleteProperty(section,'align');
    section.size = ['say-media-stacked','media-converge','items-connected'].includes(fixture.id) ? 'display' : 'standard';
    section.ground = ['say-close','items-columns'].includes(fixture.id) ? 'inverse' : index % 2 ? 'sunken' : 'base';
    if (fixture.id === 'media-record-one') section.layout = 'split-start';
    if (section.media?.type === 'specimen' && section.media.key) Reflect.deleteProperty(section.media.key,'side');
    if (section.block?.type === 'items') {
      const block = section.block;
      Reflect.deleteProperty(block,'emphasis');
      if (block.recipe === 'cards') delete block.treatment;
      block.items.forEach((item,itemIndex) => {
        Reflect.deleteProperty(item,'featured');
        item.heading = ref(fixture.id,itemTitles[fixture.id]?.[itemIndex] ?? `Project detail ${itemIndex+1}`);
        if (item.description !== undefined) item.description = ref(fixture.id,['Gather the current source material before you begin the next review.','Keep updates together so every teammate can follow the same decisions.','Give the next reviewer enough context to choose a clear action.'][itemIndex % 3]!);
        if (fixture.id === 'items-plain' && item.icon) item.icon = (['search','users','clock'] as const)[itemIndex];
        if (fixture.id === 'items-rule') item.eyebrow = ref(fixture.id,itemIndex ? 'Work' : 'People');
      });
    }
    if (section.block?.type === 'matrix') {
      section.block.sides.forEach((side,sideIndex) => {
        side.label = ref(fixture.id,sideIndex ? 'After' : 'Before');
        side.heading = ref(fixture.id,sideIndex ? 'One shared record' : 'Scattered notes');
      });
      if (fixture.id === 'matrix-points') section.block.featured = section.block.sides[1]!.id;
    }
  } else if (section.kind === 'hero') section.ground = fixture.id === 'say-hero-display' ? 'inverse' : 'base';
  applyCopyOverrides(section,fixture.id);
  return {...fixture,section};
}
export const READER_SAMPLES = CATALOG_FIXTURES.filter(f => !READER_PRUNED.some(id => id === f.id)).map(prepare);
export function readerPage(fixture: CatalogFixture): ReaderPage {
  if (fixture.id === 'recipes-nav-composition') return 'Overview';
  if (fixture.id === 'frame-actions') return 'Frame';
  if (['items-badge-meta','media-meter-previous'].includes(fixture.id)) return 'Parts';
  return deriveCatalogFunction(fixture.section);
}
export const READER_COMPOSITION = structuredClone(CATALOG_COMPOSITIONS['recipes-nav-composition']!);
READER_COMPOSITION.sections.forEach((section,index) => {
  rewrite(section,'recipes-nav-composition');
  if (section.kind === 'hero' || section.kind === 'content-section') section.heading = ref('recipes-nav-composition',['Build a shared workspace together','Getting started with your team','Keep daily work moving','Find a trusted reference','Answers before your first review','Choose your next useful step'][index]!);
  if (section.kind === 'content-section') {
    Reflect.deleteProperty(section,'align');
    if(section.media?.type==='scene'&&section.media.input.template==='approval-chain'){
      const input=section.media.input;
      input.prepared.heading=ref('recipes-nav-composition','Review preparation');
      section.media.label=ref('recipes-nav-composition','Two checks on the brief and source files lead to a review decision.');
      input.findings.forEach((finding,i)=>{finding.status.text=ref('recipes-nav-composition',i?'Checked':'Complete');finding.title=ref('recipes-nav-composition',i?'Files checked':'Brief complete');finding.fn=ref('recipes-nav-composition',i?'Verify':'Review');finding.subjectOf=ref('recipes-nav-composition',i?'Source files':'Project brief');});
      input.node.label=ref('recipes-nav-composition','Decision');
      input.decision.title=ref('recipes-nav-composition','Ready for review');
      input.decision.status.text=ref('recipes-nav-composition','Ready');
      input.decision.person.name=ref('recipes-nav-composition','Review team');
      input.decision.person.note=ref('recipes-nav-composition','Preparation checks');
      input.decision.person.initials='RT';
      input.decision.rows.forEach((row,i)=>{row.label=ref('recipes-nav-composition',i?'Next step':'Owner');row.value=ref('recipes-nav-composition',i?'Assign reviewer':'Workspace team');});
    }
    if (section.media?.type==='specimen' && section.media.key) Reflect.deleteProperty(section.media.key,'side');
    if (section.block?.type==='items') {
      const block=section.block;Reflect.deleteProperty(block,'emphasis');block.items.forEach(item=>Reflect.deleteProperty(item,'featured'));
      if(block.recipe==='faq') {applyCopyOverrides(section,'items-disclose');block.items.forEach((item,i)=>item.heading=ref('recipes-nav-composition',itemTitles['items-disclose']![i]!));}
      if(block.recipe==='topics') {
        const headings=[['Quick start','Workspace setup','Source library','Review queue','Team roles','Shared calendar','Access rules','Audit checks'],['Current projects','Open reviews','Recent documents','Pending decisions','Team updates','Upcoming dates','Assigned tasks','Completed checks'],['Writing guide','Review checklist','Document formats','State glossary','Owner roles','Source history','Access guide','Decision archive']][index-1]!;
        block.items.forEach((item,i)=>item.heading=ref('recipes-nav-composition',headings[i]!));
        block.groups?.forEach((group,i)=>group.label=ref('recipes-nav-composition',[['Getting started','Records','Collaboration','Protection'],['Work queue','Current context','Team activity','Task progress'],['Guides','Reference','Accountability','History']][index-1]![i]!));
      }
    }
  }
});
export const READER_COPY_REGISTRY = {...CATALOG_COPY_REGISTRY,id:'reader-catalog',entries};
export const readerCopyResolver = createCopyResolver(READER_COPY_REGISTRY);
