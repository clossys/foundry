import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveSectionedViewDocument, desugarRecipe } from '../../core/index.js';
import { LandingView } from '../../web/views/LandingView.server.js';
import type { LandingViewProps } from '../../web/views/LandingView.js';
import { SectionedView } from '../../web/views/SectionedView.server.js';
import type { ResolvedSectionedViewContentSection } from '../../core/sectioned-view.js';
import type { ContentCatalogStylesheets } from '../render-content-catalog.js';
import { CATALOG_FIXTURES, OTHER_KIND_LINKS, catalogCopyResolver, type CatalogFixture } from './index.js';
import { renderCatalogFixture as renderReferenceFixture } from '../render-functional-catalog.js';
import { READER_SAMPLES, READER_COMPOSITION, readerCopyResolver, readerPage, deriveCatalogFunction, type ReaderPage } from './reader-data.js';

export const READER_PAGES = [
  {id:'overview',label:'Overview',purpose:'The information is an introduction, a visual, parallel ideas, a reference, a sequence, or a comparison.'},
  {id:'introduce',label:'Introduce',purpose:'Use when the reader needs to know what the page is about or choose the next action.'},
  {id:'show',label:'Show',purpose:'Use when one product visual or a piece of evidence leads the explanation.'},
  {id:'explain',label:'Explain',purpose:'Use when the reader needs to understand several related ideas of equal or unequal weight.'},
  {id:'index',label:'Index',purpose:'Use when the reader needs to scan, find a destination, or look up an answer.'},
  {id:'sequence',label:'Sequence',purpose:'Use when the reader needs to follow an order or a hand-off between roles.'},
  {id:'compare',label:'Compare',purpose:'Use when the reader needs to weigh two options side by side.'},
  {id:'frame',label:'Frame',purpose:'Shared reference for ground, direction, measure, actions, and supporting copy.'},
  {id:'parts',label:'Parts',purpose:'Shared reference for specimen parts, record context, scene templates, badges, and meter history.'},
] as const;
const escape = (text:string):string => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const chrome = `body{margin:0;background:var(--color-surface-base);color:var(--color-ink-primary);font-family:var(--font-body);font-size:var(--text-body-s);line-height:1.5}.catalog-nav,.catalog-note{padding:var(--spacing-xl);background:var(--color-surface-sunken);overflow-wrap:anywhere}.catalog-nav h1{font-size:var(--text-h2)}.catalog-nav ul,.catalog-config-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--ui-width-prose-max)),1fr));gap:var(--spacing-lg);padding:0;list-style:none}.catalog-compact-nav{display:flex;flex-wrap:wrap;gap:var(--spacing-sm)}.catalog-nav a,.catalog-note a{color:inherit}.catalog-chip{display:inline-block;font-family:var(--font-mono);font-size:var(--text-caption);border:var(--ui-border-hairline) solid var(--color-line-base);padding:var(--spacing-xs) var(--spacing-sm);margin:var(--spacing-xs)}.catalog-example>div{min-width:0;padding-inline:var(--ui-width-page-padding-x)}.catalog-config-grid{margin:var(--spacing-xl)}.catalog-config-cell{min-width:0;border:var(--ui-border-hairline) solid var(--color-line-base)}.catalog-config-cell>header{padding:var(--spacing-md)}.catalog-config-cell [data-content-section]{padding-block:var(--spacing-xl)}.catalog-config-cell [data-landing-hero]{min-height:0!important}.catalog-note table{width:100%;border-collapse:collapse}.catalog-note th,.catalog-note td{text-align:start;vertical-align:top;padding:var(--spacing-sm);border-block-end:var(--ui-border-hairline) solid var(--color-line-base)}.catalog-published{font-family:var(--font-mono);font-size:var(--text-caption)}`;
function page(title:string,body:string,sheets:ContentCatalogStylesheets):string {
 const links=[sheets.designerTokens,sheets.utilities,...(sheets.brand===null?[]:[sheets.brand])].map(h=>`<link rel="stylesheet" href="${escape(h)}" />`).join('\n');
 return `<!DOCTYPE html><html lang="en" data-brand-bound><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escape(title)} — Content catalog</title>${links}<style>${chrome}</style></head><body><main id="catalog-page">${body}</main></body></html>\n`;
}
function nav(current?:string):string {if(current!==undefined)return `<nav aria-label="Catalog functions" class="catalog-compact-nav">${READER_PAGES.map(p=>`<a href="${p.id}.html"${p.id===current?' aria-current="page"':''}>${p.label}</a>`).join(' · ')}</nav>`;return `<nav aria-label="Catalog functions"><ul>${READER_PAGES.map(p=>`<li data-catalog-function="${p.id}"><a href="${current===undefined?'catalog/':''}${p.id}.html">${p.label}</a><p>${p.purpose}</p><span class="catalog-chip" data-catalog-axis="${p.id}">${p.id}</span></li>`).join('')}</ul></nav>`;}
export function buildFunctionalCatalogIndex(sheets:ContentCatalogStylesheets):string {return page('Content catalog',`<header class="catalog-nav"><h1>Content catalog</h1><p>The information is… Choose its reader job, then a recipe and configuration.</p>${nav()}</header>`,sheets);}
function closeProps(section:ResolvedSectionedViewContentSection):NonNullable<LandingViewProps['callToAction']> {
 const actions=(section.actions??[]).map(action=>{if(action.emphasis==='tertiary')throw new Error('Closing actions require a supported emphasis.');return {...action,emphasis:action.emphasis};});
 return {id:section.id,eyebrow:section.eyebrow,heading:section.heading,description:section.description,actions,footnote:section.footnote===undefined?undefined:section.footnote.text===undefined?{text:createElement('a',{href:section.footnote.link.href},section.footnote.link.label)}:section.footnote};
}
export function renderReaderSample(fixture:CatalogFixture):string {
 const composition=fixture.id==='recipes-nav-composition';
 const document=composition?READER_COMPOSITION:{id:`reader-${fixture.id}`,sections:[fixture.section]};
 const resolved=resolveSectionedViewDocument(document,readerCopyResolver);
 if(composition){const close=resolved.sections.at(-1);if(close?.kind!=='content-section')throw new Error('A composition requires a closing band.');return renderToStaticMarkup(createElement(LandingView,{document:{...resolved,sections:resolved.sections.slice(0,-1)},header:'reserved',peek:false,landmark:'none',callToAction:closeProps(close)}));}
 if(fixture.section.kind==='hero')return renderToStaticMarkup(createElement(LandingView,{document:resolved,header:'reserved',peek:false,landmark:'none'}));
 if(fixture.id==='say-close'){
   const hero=READER_SAMPLES.find(f=>f.id==='say-hero-display');const close=resolved.sections[0];if(!hero||close?.kind!=='content-section')throw new Error('A close requires its context.');
   const context=resolveSectionedViewDocument({id:'reader-close',sections:[hero.section]},readerCopyResolver);const html=renderToStaticMarkup(createElement(LandingView,{document:context,header:'reserved',peek:false,landmark:'none',callToAction:closeProps(close)}));return html.slice(html.indexOf(`<section id="${close.id}"`),html.lastIndexOf('</div>'));
 }
 return renderToStaticMarkup(createElement(SectionedView,{document:resolved,landmark:'none'}));
}
const published:Record<string,ReaderPage>={hero:'Introduce','feature-grid':'Explain',faq:'Index','status-list':'Index','ordered-step-sequence':'Sequence',pricing:'Compare','stat-grid':'Show',stat:'Show',testimonial:'Show'};
function recipe(fixture:CatalogFixture):string {
 if(fixture.id==='recipes-nav-composition')return 'page composition';
 if(fixture.id==='frame-actions')return 'actions and footnote';
 if(fixture.id==='items-badge-meta')return 'badge and metadata';
 if(fixture.id==='media-meter-previous')return 'meter history';
 if(fixture.id==='say-close')return 'close';
 if(fixture.section.kind==='hero')return fixture.section.size==='compact'?'hero-compact':'hero';
 if(fixture.section.kind!=='content-section')return 'published';
 const block=fixture.section.block;
 if(block?.type==='matrix')return 'comparison';
 if(fixture.section.media&&deriveCatalogFunction(fixture.section)==='Show')return fixture.section.layout==='stacked'?'showcase':'showcase-split';
 if(block?.type==='items'){const effective=desugarRecipe(block);return block.lanes?'lanes':block.recipe==='specimen-stack'?'stack':block.recipe??(effective.order==='numbered'?'numbered':effective.order==='connected'?'steps':effective.arrangement==='columns'?'features':effective.arrangement==='bento'?'cards':effective.arrangement==='stacked'?'stack':'topics');}
 return fixture.section.media?'showcase'+(fixture.section.layout==='stacked'?'':'-split'):fixture.section.layout==='stacked'?'intro':'intro-split';
}
function config(fixture:CatalogFixture,reference=false):string {
 if(fixture.id==='recipes-nav-composition')return 'six bands · approval-chain';
 const section=resolveSectionedViewDocument({id:'reader-caption',sections:[fixture.section]},reference?catalogCopyResolver:readerCopyResolver).sections[0]!;
 if(section.kind==='hero')return `${section.size} · ${section.ground}`;
 if(section.kind!=='content-section')return '';
 const values:string[]=[`${section.layout} frame`,section.size,section.ground];const block=section.block;
 if(block?.type==='items') {
   const shape=block.order==='numbered'?'numbered list':block.lanes?'two lanes':block.order==='connected'?'connected line':block.arrangement==='columns'?`${Reflect.get(block,'recipe')==='link-index'?'tiles':'grid'}-${block.columns}`:block.arrangement==='rows'?`rows-${block.columns}`:block.arrangement==='stacked'?'stack':'bento';
   values.push(shape,block.treatment,...(block.reveal==='disclose'?['disclose']:[]),...(block.groups?[`${block.groups.length} groups`]:[]),...(block.end?[block.end]:[]));
 }
 if(block?.type==='matrix')values.push(block.sides[0]?.visual?'visuals':block.sides[0]?.points?'points':'description',block.featured?'featured':'unfeatured');
 const media=section.media;
 if(media?.type==='specimen')values.push(media.key?'specimen + key':'specimen');
 if(media?.type==='record'){const n=media.columns??1;values.push(`record · ${n} column${n===1?'':'s'}`);}
 if(media?.type==='scene')values.push(`scene · ${media.input.template}`);
 return values.join(' · ');
}
function rules(label:ReaderPage):string {
 const content:Record<ReaderPage,[string,string][]>={
 Overview:[['Choose a function','Start with the reader’s job; recipes fill compatible defaults.'],['Compose a page','Alternate explicit base and sunken grounds; inverse is a deliberate focal band.']],
 Introduce:[['Roles','Hero, intro, split intro, and close.'],['Actions','0–2 actions, at most one primary. A lone hero action is primary.']],
 Show:[['Specimen','One panel with 1–3 parts; a key names 3–5 distinct targets.'],['Record','1–3 groups with 1–6 rows each; multi-column records use stacked frames.']],
 Explain:[['Grid','2, 4 or 6 entries in two columns; 3 or 6 in three columns.'],['Bento / stack','Bento has 2–6 entries whose spans fill 12-unit rows; visual stacks have 2–4, with one part each.']],
 Index:[['Rows','2–8 entries in one or two columns; 2–4 groups each have 2–4 members.'],['FAQ','4–6 answers; every answer needs a description.']],
 Sequence:[['Line','3–5 steps; four warns. Visual steps need sample-caption copy.'],['Lanes','Exactly two roles and 3–5 steps; four warns. Use columns or a stacked frame and name the continuation when relevant.']],
 Compare:[['Points','Two sides with 2–4 equal-count points each.'],['Visuals','One panel per side with 1–3 parts; do not combine points and a panel.']],
 Frame:[['Directions','Stacked, split-start, or split-end.'],['Ground','Explicit base, sunken, or inverse; no automatic selection is implied.']],
 Parts:[['Specimen','Fields, status rows, meter, table, schedule, shares, and files.'],['Independent copy','Badge and metadata coexist; meter history retains previous value and text.']],
 };return `<section class="catalog-note"><h2>Count and slot rules</h2><table data-catalog-rules><thead><tr><th scope="col">Recipe or configuration</th><th scope="col">Counts and slots</th></tr></thead><tbody>${content[label].map(([a,b])=>`<tr><th scope="row">${escape(a)}</th><td>${escape(b)}</td></tr>`).join('')}</tbody></table></section>`;
}
function renderGroundReference(fixture:CatalogFixture):string { const reference=structuredClone(fixture);if(reference.section.kind==='content-section')Reflect.deleteProperty(reference.section,'align');return renderReferenceFixture(reference); }

/** Scope trusted native fragments when several independent renders share a preview page. */
export function namespaceNativeMarkup(html:string,prefix:string):string {
 const ids=new Map<string,string>();
 for(const match of html.matchAll(/\sid="([^"]+)"/g)){const id=match[1]!;if(ids.has(id))throw new Error('Native preview fragment contains duplicate IDs.');ids.set(id,`reader-${prefix.length}:${prefix}:${id}`);}
 return html.replace(/\s(id|aria-labelledby|aria-describedby|aria-controls|aria-owns|aria-details|aria-activedescendant|aria-flowto|aria-errormessage|headers|for|list|form|href|xlink:href)="([^"]*)"/g,(_all,key:string,value:string)=>{
   if(key==='id')return ` id="${ids.get(value)!}"`;
   if(key==='href'||key==='xlink:href')return ` ${key}="${value.startsWith('#')&&ids.has(value.slice(1))?'#'+ids.get(value.slice(1)):value}"`;
   return ` ${key}="${value.split(/\s+/).map(id=>ids.get(id)??id).join(' ')}"`;
 }).replace(/url\(#([^)]*)\)/g,(all,id:string)=>ids.has(id)?`url(#${ids.get(id)})`:all);
}
type ConfigCell={id:string;fixture:CatalogFixture;reference?:boolean};
export function readerConfigCells(label:ReaderPage):ConfigCell[] {
 const byId=(id:string):CatalogFixture=>{const sample=READER_SAMPLES.find(f=>f.id===id);if(!sample)throw new Error('Missing reader sample.');return sample;};
 const groups:Partial<Record<ReaderPage,string[]>>={Introduce:['say-hero-display','say-hero-compact','say-intro','say-header-split','say-close'],Show:['say-media-stacked','media-key','media-record-one','media-record-three','media-converge'],Explain:['items-plain','items-rule','items-columns','items-bento','items-stacked'],Index:['items-rows','items-icon-groups','items-plate','items-disclose'],Sequence:['items-numbered','items-connected','items-flow-five'],Compare:['matrix-points','matrix-visuals'],Parts:['items-badge-meta','media-meter-previous','say-media-stacked','media-key','frame-split-start','media-record-one','media-record-three','media-converge','media-evidence']};
 const result=(groups[label]??[]).map(id=>({id,fixture:byId(id)}));
 if(label==='Show'){const fixture=structuredClone(byId('say-media-stacked'));const companion=byId('frame-split-end');if(fixture.section.kind==='content-section'&&companion.section.kind==='content-section'){fixture.section.layout='split-end';fixture.section.block=structuredClone(companion.section.block);}result[0]={id:'show-companion',fixture};}
 if(label==='Show'){const fixture=structuredClone(byId('media-key'));const companion=byId('items-stacked');if(fixture.section.kind==='content-section'&&companion.section.kind==='content-section'){fixture.section.layout='split-start';fixture.section.block=structuredClone(companion.section.block);}result[1]={id:'media-key',fixture};}
 if(label==='Explain'){const fixture=structuredClone(byId('items-plain'));if(fixture.section.kind==='content-section'&&fixture.section.block?.type==='items')fixture.section.block.treatment='plate';result.push({id:'features-plate',fixture});}
 if(label==='Compare'){const fixture=structuredClone(byId('matrix-points'));if(fixture.section.kind==='content-section'&&fixture.section.block?.type==='matrix')delete fixture.section.block.featured;result.splice(1,0,{id:'comparison-unfeatured',fixture});}
 if(label==='Parts'){const section=READER_COMPOSITION.sections.find(s=>s.kind==='content-section'&&s.media?.type==='scene'&&s.media.input.template==='approval-chain');if(!section)throw new Error('Missing approval reference.');const reference=structuredClone(section);Reflect.deleteProperty(reference,'block');result.push({id:'parts-approval',fixture:{...byId('media-converge'),id:'parts-approval',section:reference}});}
 if(label==='Frame')return [...CATALOG_FIXTURES.filter(f=>['frame-ground-base','frame-ground-sunken','frame-ground-inverse'].includes(f.id)).map(f=>({id:f.id,fixture:f,reference:true})),{id:'frame-display',fixture:byId('say-media-stacked')},{id:'frame-direction-start',fixture:byId('frame-split-start')},{id:'frame-direction-end',fixture:byId('frame-split-end')}];
 return result;
}

export function buildCatalogFunctionPages(sheets:ContentCatalogStylesheets):Array<{file:string;content:string}> {
 const nested={designerTokens:`../${sheets.designerTokens}`,utilities:`../${sheets.utilities}`,brand:sheets.brand===null?null:`../${sheets.brand}`};
 return READER_PAGES.map(p=>{
 const label:ReaderPage=p.label;
 let body=`<header class="catalog-nav"><a href="../content-catalog.html">Content catalog</a><h1>${label}</h1><p>${p.purpose}</p>${nav(p.id)}</header>`;
 for(const sample of READER_SAMPLES.filter(f=>readerPage(f)===label))body+=`<article class="catalog-example" id="example-${sample.id}" data-catalog-fixture="${sample.id}"><header class="catalog-note"><h2 data-catalog-caption>${label} › ${recipe(sample)} · ${config(sample)}</h2></header><div data-catalog-native${label==='Overview'?' data-catalog-composition':''}>${namespaceNativeMarkup(renderReaderSample(sample),`sample-${p.id}-${sample.id}`)}</div></article>`;
 const cells=readerConfigCells(label);
 if(cells.length)body+=`<section class="catalog-note"><h2>Configuration reference</h2><p>These thumbnails show actual compatible configurations of the same reader job.</p></section><div class="catalog-config-grid">${cells.map(cell=>`<article class="catalog-config-cell" data-catalog-config-cell="${cell.id}"${cell.fixture.section.kind==='content-section'?` data-config-ground="${cell.fixture.section.ground}" data-config-size="${cell.fixture.section.size}"`:''}><header data-config-caption>${label} › ${recipe(cell.fixture)} · ${config(cell.fixture,cell.reference)}</header><div data-config-native>${namespaceNativeMarkup(cell.reference?renderGroundReference(cell.fixture):renderReaderSample(cell.fixture),`config-${p.id}-${cell.id}`)}</div></article>`).join('')}</div>`;
 body+=rules(label);
 const aliases=OTHER_KIND_LINKS.filter(link=>published[link.kind]===label);
 if(aliases.length)body+=`<section class="catalog-note"><h2>Published kinds</h2><ul>${aliases.map(link=>`<li data-published-kind="${link.kind}"><span class="catalog-published">published</span> <a href="${link.href}">${link.kind}</a></li>`).join('')}</ul></section>`;
 return {file:`catalog/${p.id}.html`,content:page(label,body,nested)};
 });
}
