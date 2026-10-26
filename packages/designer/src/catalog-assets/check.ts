import type { CatalogData, DtcgToken, LibraryData, Resolved } from '../catalog-core/types.js';
import { resolve, libraryHash } from '../catalog-core/resolve.js';
import { applyLibraryChange } from '../catalog-core/library.js';
import { contrastRatio, colorAlpha } from '../tokens/color.js';
import { checkClearSpace, checkMinimumSize, checkSingleColourLegibility } from '../tokens/identity-checks.js';
import { inspectSvg, inspectGlyph, type SvgElement } from './svg.js';
import { checkIdentityDerivations } from './identity.js';
import { flatten } from '../catalog-core/model.js';
export type AssetCheckCode = `A${1|2|3|4|5|6|7|8|9|10|11|12}`;
export interface AssetFinding {code:AssetCheckCode;subject:string;verdict:'satisfied'|'violated'|'indeterminate'|'exempt';message:string}
export interface ImageRecord {id:string;width:number;height:number;alt?:string;decorative?:boolean;bakedCorners?:boolean;format:string;bytes:number;maxBytes?:number}
const LICENSES=new Set(['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC','OFL-1.1','CC0-1.0','UNLICENSED']);
function colors(elements:readonly SvgElement[]):string[]{
 const paints=new Set<string>();const rootColor=elements[0]?.attrs.color;const maskDepths:number[]=[];
 for(const e of elements){while(maskDepths.length&&e.depth<=maskDepths.at(-1)!)maskDepths.pop();if(e.tag==='mask')maskDepths.push(e.depth);if(maskDepths.length)continue;for(const name of ['fill','stroke']){let paint=e.attrs[name];if(paint==='currentColor')paint=e.attrs.color??rootColor;if(paint&&!['none','transparent','currentColor'].includes(paint))paints.add(paint);}}
 if(!paints.size&&rootColor)paints.add(rootColor);return [...paints];
}
export function checkAssetProfile(catalog:CatalogData,library:LibraryData,input:{resolved?:Resolved;images?:readonly ImageRecord[];glyphBounds?:Readonly<Record<string,{x:number;y:number;width:number;height:number}>>}={}):readonly AssetFinding[]{
 return checkAssetProfileWithContext(catalog,library,input,()=>checkIdentityDerivations(catalog,library));
}
/** Internal: only the engine check supplies identity findings from its independent fresh resolution. */
export function checkAssetProfileWithContext(catalog:CatalogData,library:LibraryData,input:NonNullable<Parameters<typeof checkAssetProfile>[2]>,identityErrors:()=>readonly string[]):readonly AssetFinding[]{
 const profile=input.resolved??resolve({catalog,library});const findings:AssetFinding[]=[];
 const add=(code:AssetCheckCode,subject:string,verdict:AssetFinding['verdict'],message:string):void=>{findings.push({code,subject,verdict,message});};
 const exemptions=new Map<string,unknown>();
 for(const fill of library.fills.filter(fill=>!!fill.assets))for(const [id,token] of Object.entries(flatten(fill))){
  const member=profile.members[id],meta=fill.$extensions['com.clossys.fill'];
  if(member?.fill===meta.id&&member.source===meta.source&&token.$extensions&&Object.hasOwn(token.$extensions,'com.clossys.contrast-exemption'))exemptions.set(id,token.$extensions['com.clossys.contrast-exemption']);
 }
 const parsed=new Map<string,readonly SvgElement[]>();
 for(const [id,member] of Object.entries(profile.members).filter(([id])=>id.startsWith('assets.'))){
  if(exemptions.has(id)&&!/^assets\.(?:lockup|mark)\.(?:positive|reversed)$/.test(id))add('A5',id,'violated','Invalid A5 contrast exemption: only logo contrast assets support logotype metadata');
  const origin=member.origin;let license:string|undefined;
  if(origin?.kind==='adopted')license=origin.license;else if(origin?.kind==='authored')license=origin.license;else if(origin?.kind==='derived')license=library.source.license;
  add('A1',id,license&&LICENSES.has(license)&&(origin?.kind!=='adopted'||(license!=='UNLICENSED'&&!!origin.pin&&!!origin.sha256))?'satisfied':'violated','Member licence and adopted pin/hash trail required');
  if(id.startsWith('assets.lockup.')&&typeof member.value.light==='string'&&/<text\b/.test(member.value.light))add('A1',id,'indeterminate','Live text is not outlined; consumer must retain its font licence and provide the font at rendering time');
  if(member.$type==='svg')try{if(typeof member.value.light!=='string')throw Error('SVG must be text');parsed.set(id,inspectSvg(member.value.light,{favicon:id==='assets.favicon.vector'}));add('A2',id,'satisfied','SVG passed the closed grammar');}catch(error){add('A2',id,'violated',String(error));}
  if(member.$type==='glyph'){
   try{inspectGlyph(member.value.light);add('A3',id,'satisfied','24-grid shell owns fill, currentColor stroke and stroke width');}catch(error){add('A3',id,'violated',String(error));}
   const bound=input.glyphBounds?.[id];add('A4',id,bound?(bound.x>=2&&bound.y>=2&&bound.x+bound.width<=22&&bound.y+bound.height<=22?'satisfied':'violated'):'indeterminate',bound?'Measured geometry must stay within the 2px inset':'Path bounds require a geometry measurement; shell supports 16/24/32px and stroke 1.5–2.5');
  }
 }
 const iconSources=new Set(Object.entries(profile.members).filter(([id])=>id.startsWith('assets.icon-')).map(([,m])=>m.origin?.kind==='adopted'?m.origin.source:library.source.id));
 if(iconSources.size>1)add('A4','assets.icons','indeterminate',`Mixed icon sources: ${[...iconSources].sort().join(', ')}`);
 for(const leaf of ['lockup','mark'])for(const ground of ['positive','reversed']){
  const id=`assets.${leaf}.${ground}`,elements=parsed.get(id),paints=elements&&colors(elements);
  if(exemptions.has(id)){
   const value=exemptions.get(id);
   if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='kind,reason'&&(value as {kind?:unknown}).kind==='logotype'&&typeof (value as {reason?:unknown}).reason==='string'&&(value as {reason:string}).reason.trim())add('A5',id,'exempt',`exempt: logotype, ${(value as {reason:string}).reason.trim()}`);
   else add('A5',id,'violated','Invalid A5 contrast exemption: kind must be logotype and reason must be non-empty');
   continue;
  }
  const backgrounds=ground==='positive'?[profile.members['tokens.surface-color.base']?.css.light]:[profile.members['tokens.surface-color.inverse']?.css.light,profile.members['tokens.surface-color.base']?.css.dark];
  try{if(!paints?.length||backgrounds.some(bg=>!bg))throw Error('unmeasured paint or ground');const ratios=paints.flatMap(paint=>backgrounds.map(bg=>contrastRatio(paint,bg!)));add('A5',id,ratios.every(r=>r>=3)?'satisfied':'violated',`Minimum contrast ${Math.min(...ratios).toFixed(2)}:1`);}catch{add('A5',id,'indeterminate','Cannot measure paint against every light, inverse and dark ground');}
 }
 const favicon=profile.members['assets.favicon.vector']?.value.light;
 add('A6','assets.favicon',typeof favicon==='string'&&parsed.has('assets.favicon.vector')&&/<svg\b[^>]*\bcolor="(?!currentColor)[^"]+"/.test(favicon)&&/<style>@media \(prefers-color-scheme: dark\)\{svg\{color:/.test(favicon)?'satisfied':'violated','Favicon needs explicit light ink and an isolated dark-scheme ink rule');
 add('A6','assets.favicon','indeterminate','16px optical legibility requires browser inspection; no automated browser result is implied');
 const mono=profile.members['assets.mark.mono']?.value.light;
 if(typeof mono==='string'){const verdict=checkSingleColourLegibility(mono);add('A7','assets.mark.mono',verdict.ok?'satisfied':'violated',verdict.reason??'Single-colour mark');}
 const mask=parsed.get('assets.app-icon.maskable'),standard=parsed.get('assets.app-icon.standard');
 const backdrop=mask?.find(e=>e.tag==='rect'&&e.depth===1);const inset=mask?.find(e=>e.tag==='svg'&&e.depth===1);
 const paint=backdrop?.attrs.fill;const hexAlpha=paint&&/^#(?:[a-fA-F0-9]{4}|[a-fA-F0-9]{8})$/.test(paint)?(paint.length===5?parseInt(paint.slice(-1).repeat(2),16):parseInt(paint.slice(-2),16))/255:undefined;const alpha=paint?(hexAlpha??colorAlpha(paint)):undefined;const full=(e:SvgElement|undefined)=>!!e&&Number(e.attrs.opacity??1)===1&&Number(e.attrs['fill-opacity']??1)===1&&!e.attrs.transform;
 const opaque=alpha===1&&full(backdrop)&&full(mask?.[0])&&backdrop?.attrs.width==='512'&&backdrop?.attrs.height==='512'&&Number(backdrop?.attrs.x??0)===0&&Number(backdrop?.attrs.y??0)===0&&!backdrop?.attrs.rx&&mask?.[0]?.attrs.viewBox==='0 0 512 512'&&mask.filter(e=>e.depth===1).every(e=>e===backdrop||e===inset);
 const bounds=inset&&['x','y','width','height'].map(key=>Number(inset.attrs[key]));
 const safe=inset&&!inset.attrs.transform&&bounds&&bounds.every(Number.isFinite)&&[0,1].every(x=>[0,1].every(y=>Math.hypot(bounds[0]!+x*bounds[2]!-256,bounds[1]!+y*bounds[3]!-256)<=204.8));
 const standardDirect=standard?.filter(e=>e.depth===1);const transparent=standardDirect?.length===2&&standardDirect.every(e=>e.tag==='rect'||e.tag==='svg')&&standard?.find(e=>e.tag==='rect'&&e.depth===1&&Number(e.attrs.x)>0&&Number(e.attrs.y)>0&&Number(e.attrs.width)<512&&Number(e.attrs.height)<512&&Number(e.attrs.rx)>0);
 add('A8','assets.app-icon',opaque&&safe&&transparent?'satisfied':!mask||!standard?'indeterminate':'violated','Maskable art stays in the 80% circle on an opaque full-bleed ground; standard corners stay transparent');
 for(const mode of ['light','dark'] as const){const fg=profile.members['tokens.text-color.primary']?.css[mode],bg=profile.members['tokens.surface-color.base']?.css[mode];try{if(!fg||!bg)throw Error();const ratio=contrastRatio(fg,bg);add('A9',`assets.icons.${mode}`,ratio>=3?'satisfied':'violated',`Inherited text ink contrast ${ratio.toFixed(2)}:1`);}catch{add('A9',`assets.icons.${mode}`,'indeterminate','Inherited icon ink and ground require parseable token values');}}
 const status={success:'success',warning:'warning',danger:'danger',info:'info'};
 for(const [icon,color] of Object.entries(status)){
  if(!profile.members[`assets.icon-${icon}.default`])continue;
  const fg=profile.members[`tokens.status-color.${color}`],bg=profile.members[`tokens.status-color.${color}-tint`];
  try{if(!fg||!bg)throw Error();const ratios=['light','dark'].map(mode=>contrastRatio(fg.css[mode as 'light'|'dark']??fg.css.light,bg.css[mode as 'light'|'dark']??bg.css.light));add('A9',`assets.icon-${icon}`,ratios.every(r=>r>=3)?'satisfied':'violated',`Status paint contrast minimum ${Math.min(...ratios).toFixed(2)}:1`);}catch{add('A9',`assets.icon-${icon}`,'indeterminate','Status ink or tint is absent or cannot be parsed');}
 }
 for(const [id,member] of Object.entries(profile.members).filter(([id])=>id.startsWith('assets.image-ratio.'))){const v=member.value.light as Record<string,unknown>|null;const valid=v&&typeof v==='object'&&!Array.isArray(v)&&typeof v.width==='number'&&typeof v.height==='number'&&Number.isFinite(v.width)&&Number.isFinite(v.height)&&v.width>0&&v.height>0;add('A10',id,valid?'satisfied':'violated','Image ratio must have finite positive width and height');}
 const ratios=Object.entries(profile.members).filter(([id])=>id.startsWith('assets.image-ratio.')).map(([,m])=>m.value.light).filter((v):v is {width:number;height:number}=>!!v&&typeof v==='object'&&!Array.isArray(v)&&typeof (v as Record<string,unknown>).width==='number'&&typeof (v as Record<string,unknown>).height==='number');
 for(const image of input.images??[]){const crop=image.width/image.height;const match=Number.isFinite(crop)&&image.width>0&&image.height>0&&ratios.some(r=>Math.abs(crop/(r.width/r.height)-1)<=.01);add('A10',image.id,match&&(image.decorative||!!image.alt?.trim())&&!image.bakedCorners?'satisfied':'violated','Crop within 1%; meaningful alt unless decorative; no baked corners');if(!['avif','webp','png','jpeg','svg'].includes(image.format)||image.maxBytes===undefined||image.bytes>image.maxBytes)add('A10',image.id,'indeterminate','Review image format and weight budget');}
 for(const leaf of ['lockup','mark'])for(const member of ['positive','reversed']){const id=`assets.${leaf}.${member}`,value=profile.members[id]?.value.light;if(typeof value!=='string')continue;const clear=checkClearSpace(value),size=checkMinimumSize(value);add('A11',id,clear.indeterminate?'indeterminate':clear.ok?'satisfied':'violated',clear.reason??'Clear-space declaration is sufficient');add('A11',id,size.indeterminate?'indeterminate':size.ok?'satisfied':'violated',size.reason??'Minimum size is sufficient');}
 for(const slot of catalog.slots.filter(s=>s.layer==='assets')){
  const members=Object.entries(profile.members).filter(([,m])=>m.slot===slot.id);const missing=slot.contract.kind==='asset'&&slot.contract.members.mode==='closed'?slot.contract.members.names.filter(name=>!(slot.contract.kind==='asset'&&slot.contract.optional?.includes(name))&&!profile.members[`${slot.id}.${name}`]):[];add('A12',slot.id,members.length&&!missing.length?'satisfied':'violated',missing.length?`Missing required members: ${missing.join(', ')}`:members.length?'Leaf has materialized consumer members':'Leaf has no consumer members');
  if(['assets.lockup','assets.mark'].includes(slot.id)) { const origins=new Set(members.map(([,m])=>m.origin?.kind==='adopted'?m.origin.source:library.source.id));add('A12',slot.id,origins.size<=1?'satisfied':'violated','Logo leaf members must come from one artwork source'); }
 }
 for(const error of identityErrors())add('A12','assets.identity','violated',error);
 return findings.sort((a,b)=>a.code.localeCompare(b.code)||a.subject.localeCompare(b.subject)||a.message.localeCompare(b.message));
}
/** Explicit consumer crop choice; no Foundry candidate and no mandatory square member. */
export function authorImageRatios(catalog:CatalogData,library:LibraryData,input:{ratios:Readonly<Record<string,{width:number;height:number}>>;source:string;rationale:string}):LibraryData{
 if(!input.source.trim()||!input.rationale.trim()||!Object.keys(input.ratios).length)throw Error('consumer crop source, rationale and ratios required');
 const values:Record<string,DtcgToken>={};for(const [name,ratio] of Object.entries(input.ratios)){if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)||!Number.isFinite(ratio.width)||!Number.isFinite(ratio.height)||ratio.width<=0||ratio.height<=0)throw Error('invalid image ratio');values[name]={$type:'rules',$value:ratio,$extensions:{'com.clossys.origin':{kind:'authored',license:library.source.license,note:`${input.source}: ${input.rationale}`}}};}
 return applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:'author',slot:'assets.image-ratio',tokens:values}]});
}
export function assetCoverageReport(catalog:CatalogData,library:LibraryData):{total:number;served:number;leaves:readonly {slot:string;members:readonly string[];sources:readonly string[];reads:readonly string[]}[]}{
 const profile=resolve({catalog,library});const leaves=catalog.slots.filter(s=>s.layer==='assets').map(slot=>{const members=Object.entries(profile.members).filter(([,m])=>m.slot===slot.id);return {slot:slot.id,members:members.map(([id])=>id).sort(),sources:[...new Set(members.map(([,m])=>m.origin?.kind==='adopted'?m.origin.source:library.source.id))].sort(),reads:[...new Set(members.flatMap(([,m])=>m.origin?.kind==='derived'?m.origin.inputs:m.reads??[]))].sort()};}).sort((a,b)=>a.slot<b.slot?-1:1);return {total:leaves.length,served:leaves.filter(l=>l.members.length).length,leaves};
}
