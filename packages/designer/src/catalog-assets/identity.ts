import { generateIdentityDirections, adoptSuppliedMark, recolorSvg, composeLockup, identityPlateSvg, identityStarterSeeds, isIdentityStarterSlot, type IdentityTokenInput, type LockupFontLicence } from '../tokens/identity-kit.js';
import { resolve, libraryHash } from '../catalog-core/resolve.js';
import { applyLibraryChange, createDerivationInputsHasher } from '../catalog-core/library.js';
import { cssText, flatten } from '../catalog-core/model.js';
import { defaultPreset, presetValues, sourceRoster, tokenContract } from '../catalog-core/token-contract.js';
import type { CatalogData, CatalogRule, DtcgToken, LibraryData, Resolved } from '../catalog-core/types.js';
import { AssetValidationError, escapeXml, inspectSvg, safeColor, svgBody, svgViewBox } from './svg.js';
export const IDENTITY_RULES = ['identity-lockup@1','identity-mark@1','identity-favicon@1','identity-app-icon@1'] as const;
export type IdentityRuleId = typeof IDENTITY_RULES[number];
const ADOPT_INPUTS = ['tokens.text-color.primary','tokens.text-color.on-inverse','tokens.surface-color.base','tokens.surface-color.inverse','tokens.accent-color.default','tokens.text-color.on-accent','tokens.typeface.display'] as const;
const INPUTS: Record<IdentityRuleId,readonly string[]> = {
 'identity-lockup@1':['assets.lockup.positive',...ADOPT_INPUTS],
 'identity-mark@1':['assets.mark.positive',...ADOPT_INPUTS],
 'identity-favicon@1':['assets.mark.positive','tokens.text-color.primary','tokens.text-color.on-inverse'],
 'identity-app-icon@1':['assets.mark.positive','tokens.text-color.primary','tokens.text-color.on-inverse'],
};
/** Public serializable registration; concrete values are instantiated only during explicit derive. */
export function identityRuleDefinition(id: string): CatalogRule | undefined {
 if(!IDENTITY_RULES.includes(id as IdentityRuleId)) return undefined;
 return {id,slot:'assets.'+id.slice(9,-2),inputs:[...INPUTS[id as IdentityRuleId]],values:{}};
}
const string = (profile: Resolved,id: string): string => { const value=profile.members[id]?.value.light; if(typeof value!=='string') throw new AssetValidationError(`missing string library input ${id}`); return value; };
function ink(profile: Resolved,id: string, dark=false): string { const member=profile.members[id]; if(!member) throw new AssetValidationError(`missing token input ${id}`); return safeColor(cssText(member.$type,(dark ? member.value.dark : member.value.light)??member.value.light)); }
function tokens(profile: Resolved): IdentityTokenInput { const font=profile.members['tokens.typeface.display']; return {ink:ink(profile,'tokens.text-color.primary'),onInverse:ink(profile,'tokens.text-color.on-inverse'),surfaceBase:ink(profile,'tokens.surface-color.base'),surfaceInverse:ink(profile,'tokens.surface-color.inverse'),accent:ink(profile,'tokens.accent-color.default'),onAccent:ink(profile,'tokens.text-color.on-accent'),fontFamily:font ? cssText(font.$type,font.value.light) : ''}; }
function normalizeGenerated(svg: string): string { const result=svg.replace(/style="color:([^";]+)"/g,(_,color:string)=>`color="${escapeXml(safeColor(color))}"`); inspectSvg(result); return result; }
function named(svg: string,name: string,favicon=false): string { const elements=inspectSvg(svg,{favicon}); const attrs=elements[0]!.attrs; const existing=attrs['aria-label']; if(existing) return svg.replace(/\saria-label=(?:"[^"]*"|'[^']*')/,` aria-label="${escapeXml(name)}"`); return svg.replace(/^\s*<svg\b/,`<svg aria-label="${escapeXml(name)}"`); }
/** Explicit consumer creation. Name and artwork become authored seed members, never direction fields. */
export function createConsumerIdentitySeeds(catalog: CatalogData, library: LibraryData, input: { name: string; suppliedSvg?: string; fontLicence: LockupFontLicence }): LibraryData {
 if(!input.name.trim()||input.name.length>160) throw new AssetValidationError('consumer name is required (maximum 160 characters)');
 const profile=resolve({catalog,library}); const t=tokens(profile); const generated=generateIdentityDirections({name:input.name},t)[0];
 let mark=normalizeGenerated(generated.variants.mark); let lockup=normalizeGenerated(generated.variants.primary);
 if(input.suppliedSvg) {
  inspectSvg(input.suppliedSvg); const spec=composeLockup({brand:{name:input.name},suppliedSvg:input.suppliedSvg,tokens:t,wordmark:input.name,fontLicence:input.fontLicence,header:'lockup'});
  mark=spec.mark; lockup=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wordmarkWidth(input.name)} 48" data-clear-space="0.2"><svg x="0" y="0" width="48" height="48" viewBox="${svgViewBox(mark)}">${svgBody(mark)}</svg><text x="56" y="31" font-size="${WORDMARK_SIZE}" font-weight="600" letter-spacing="${WORDMARK_TRACKING}" font-family="${escapeXml(t.fontFamily)}" fill="${escapeXml(t.ink)}">${escapeXml(input.name)}</text></svg>`;
 }
 const token=(svg:string): DtcgToken => ({$type:'svg',$value:named(svg,input.name),$extensions:{'com.clossys.origin':{kind:'authored',license:library.source.license,note:`Consumer identity seed; live text; font outlining ${input.fontLicence.outlining}; family ${input.fontLicence.family}`}}});
 return applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:'author',slot:'assets.mark',tokens:{positive:token(mark)}},{op:'author',slot:'assets.lockup',tokens:{positive:token(lockup)}}]});
}
/** Starter inputs: the library's own tokens, else the default preset's contract value, so a fresh library can start. */
function starterTokens(profile: Resolved): IdentityTokenInput {
 const preset=defaultPreset(sourceRoster);
 const pick=(id: string): string => { if(profile.members[id]) return ink(profile,id); const [layer,leaf,...member]=id.split('.'); const value=presetValues(tokenContract,preset,`${layer}.${leaf}`)[member.join('.')]?.light; if(value===undefined) throw new AssetValidationError(`missing token input ${id}`); return safeColor(value); };
 const font=profile.members['tokens.typeface.display'];
 return {ink:pick('tokens.text-color.primary'),onInverse:pick('tokens.text-color.on-inverse'),surfaceBase:pick('tokens.surface-color.base'),surfaceInverse:pick('tokens.surface-color.inverse'),accent:pick('tokens.accent-color.default'),onAccent:pick('tokens.text-color.on-accent'),fontFamily:font ? cssText(font.$type,font.value.light) : 'sans-serif'};
}
/** The brand name a starter writes: the label an existing brand member carries, else the library id. */
function brandName(library: LibraryData): string {
 for(const fill of library.fills) { if(!fill.assets) continue; const label=/aria-label=\\"([^"\\]+)\\"/.exec(JSON.stringify(fill.assets))?.[1]; if(label) return label.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'); }
 return library.source.id;
}
/**
 * Generate starter for one brand slot: the identity kit's starter members as one `author` change, every
 * token an authored Custom value under the library's own licence. Never an adoption: brand rows offer no source.
 */
export function identityStarterChange(catalog: CatalogData, library: LibraryData, slot: string): { op: 'author'; slot: string; tokens: Record<string, DtcgToken> } {
 if(!isIdentityStarterSlot(slot)) throw new AssetValidationError(`${slot} has no identity starter`);
 const name=brandName(library); const t=starterTokens(resolve({catalog,library})); const seeds=identityStarterSeeds({name},t);
 const lockup=normalizeGenerated(seeds.lockup), mark=normalizeGenerated(seeds.mark);
 const members: Record<string,string> = slot==='assets.lockup' ? {positive:lockup,reversed:reversedLockup(lockup,t.onInverse)}
  : slot==='assets.mark' ? {positive:mark,reversed:reversedMark(mark,t.onInverse),mono:monoGlyph(mark)}
  : slot==='assets.favicon' ? {vector:identityPlateSvg(mark,t.ink,t.onInverse,true)}
  : {standard:badge(mark,t.ink,t.onInverse,false),maskable:badge(mark,t.ink,t.onInverse,true)};
 for(const svg of Object.values(members)) inspectSvg(svg,{favicon:slot==='assets.favicon'});
 const values=Object.fromEntries(Object.entries(members).map(([member,svg]) => [member,{$type:'svg',$value:named(svg,name,slot==='assets.favicon'),$extensions:{'com.clossys.origin':{kind:'authored' as const,license:library.source.license,note:'Identity kit starter; edit freely'}}} as DtcgToken]));
 return {op:'author',slot,tokens:values};
}
/** Live-text wordmark: 22px at weight 600, tracked -0.02em (the tight tracking token). */
const WORDMARK_SIZE=22, WORDMARK_TRACKING=-0.44;
/**
 * The lockup's width trimmed to its wordmark: the 56px mark column plus an
 * advance estimate per character (capitals and figures 0.72em, spaces 0.28em,
 * the rest 0.6em, less the tracking), rounded up to the 4px grid. Live text
 * cannot be measured here; an outlined wordmark replaces this estimate.
 */
function wordmarkWidth(name:string):number {
 let em=0; for(const ch of name) em+=/[A-Z0-9]/.test(ch)?0.72:/\s/.test(ch)?0.28:0.6;
 return Math.ceil((56+em*WORDMARK_SIZE+[...name].length*WORDMARK_TRACKING)/4)*4;
}
/**
 * Reversed mark: one on-inverse paint. A recognised two-tone mark becomes a knockout
 * (the plate in the on-inverse ink with the glyph cut through it), so the glyph shows
 * as whatever dark ground the mark sits on and A5 measures the only paint there is,
 * the plate against that ground. Painting the glyph in the mark's own plate tone would
 * vanish on a ground of that tone (1.00:1). Any other mark is recoloured flat.
 */
function reversedMark(svg:string,onInverse:string):string { return recolour(svg,onInverse); }
/** A recognised two-tone mark's foreground is the mono glyph, without its backing plate.
 * recolorSvg emits validated layers in paint order; only its generated foreground layer is extracted.
 * Arbitrary single-tone artwork retains the existing safe recolouring path.
 */
function monoGlyph(svg:string):string {
 const mono=recolour(svg,'currentColor');
 const foreground=/<g mask="url\(#recolor-[a-f0-9]+-b\)">([\s\S]*)<\/g><\/svg>$/.exec(mono);
 if(!foreground) return mono;
 const root=/^\s*<svg\b[^>]*>/.exec(mono)![0];
 const glyph=root+foreground[1]+'</svg>'; inspectSvg(glyph); return glyph;
}

/**
 * Reversed lockup: the nested mark is reversed as {@link reversedMark} does and the
 * rest (the wordmark) is recoloured flat. A lockup without exactly one nested mark
 * directly after its root tag is recoloured flat as a whole, as before.
 */
function reversedLockup(seed:string,onInverse:string):string {
 const root=/^\s*<svg\b[^>]*>/.exec(seed)?.[0]; const nested=root?/^<svg\b([^>]*)>([\s\S]*?)<\/svg>/.exec(seed.slice(root.length)):null;
 if(!root||!nested||/<svg\b/.test(nested[2]!)) return recolour(seed,onInverse);
 const box=/\bviewBox="([^"]*)"/.exec(nested[1]!)?.[1]; if(box===undefined) return recolour(seed,onInverse);
 const reversed=reversedMark(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${nested[2]}</svg>`,onInverse);
 const markTag=`<svg${nested[1]!.replace(/\s(?:color|fill)="[^"]*"/g,'')}>${svgBody(reversed)}</svg>`;
 const rest=recolour(root+seed.slice(root.length+nested[0].length),onInverse); const restRoot=/^\s*<svg\b[^>]*>/.exec(rest)![0];
 return restRoot+markTag+rest.slice(restRoot.length);
}
function recolour(svg:string,color:string):string { return recolorSvg(svg,color).replace(/\bcolor=(?:"[^"]*"|'[^']*')/g,`color="${escapeXml(safeColor(color))}"`); }
function badge(mark: string, background: string, foreground: string, maskable: boolean): string {
 const shape=maskable?'<rect width="512" height="512" fill="'+background+'"/>':'<rect x="16" y="16" width="480" height="480" rx="104" fill="'+background+'"/>';
 // A square of side 280 lies wholly inside the mandated 409.6px safe circle (diagonal 396px).
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${shape}<svg x="116" y="116" width="280" height="280" viewBox="${svgViewBox(mark)}" color="${foreground}" fill="${background}">${svgBody(identityPlateSvg(mark,background,foreground))}</svg></svg>`;
}
/** Native adoption keeps the existing consumer name and positive SVG as its only artwork input. */
function adopted(seed: string, profile: Resolved) {
 const name=inspectSvg(seed)[0]!.attrs['aria-label'];
 if(!name?.trim()) throw new AssetValidationError('consumer positive identity must carry its public name');
 return adoptSuppliedMark({brand:{name},suppliedSvg:seed,tokens:tokens(profile)});
}
/** Pure builtin rules are instantiated from the consumer profile, then materialized by the generic engine. */
export function instantiateIdentityRule(catalog: CatalogData, library: LibraryData, id: IdentityRuleId): { rule: CatalogRule; inputs: readonly string[] } {
 if(!IDENTITY_RULES.includes(id)) throw new AssetValidationError('unknown identity rule');
 return instantiateIdentityRuleFromResolved(resolve({catalog,library}),id);
}
/** Internal: instantiate against the check's independently resolved consumer values. */
export function instantiateIdentityRuleFromResolved(profile: Resolved, id: IdentityRuleId): { rule: CatalogRule; inputs: readonly string[] } {
 if(!IDENTITY_RULES.includes(id)) throw new AssetValidationError('unknown identity rule');
 const inputs=INPUTS[id]; for(const member of inputs) if(!profile.members[member]) throw new AssetValidationError(`missing consumer input ${member}`);
 const values: Record<string,DtcgToken>={}; const put=(member:string,svg:string):void=>{inspectSvg(svg,{favicon:id==='identity-favicon@1'});values[member]={$type:'svg',$value:svg};};
 if(id==='identity-lockup@1') { const seed=string(profile,'assets.lockup.positive'); put('reversed',adopted(seed,profile).variants.dark); }
 else {
  const seed=string(profile,'assets.mark.positive'); inspectSvg(seed);
  if(id==='identity-mark@1') { const variants=adopted(seed,profile).variants; put('reversed',variants.dark); put('mono',variants.mono); }
  if(id==='identity-favicon@1') put('vector',identityPlateSvg(seed,ink(profile,'tokens.text-color.primary'),ink(profile,'tokens.text-color.on-inverse'),true));
  if(id==='identity-app-icon@1') { const bg=ink(profile,'tokens.text-color.primary'),fg=ink(profile,'tokens.text-color.on-inverse'); put('standard',badge(seed,bg,fg,false));put('maskable',badge(seed,bg,fg,true)); }
 }
 return {rule:{...identityRuleDefinition(id)!,values},inputs:[...inputs]};
}
/** Re-derive is explicit. No resolve or check mutates the saved library. */
export function deriveIdentity(catalog: CatalogData, library: LibraryData, ids: readonly IdentityRuleId[] = IDENTITY_RULES): LibraryData {
 let result=library;
 for(const id of ids) {
  const rule=identityRuleDefinition(id); if(!rule) throw new AssetValidationError('unknown identity rule');
  result=applyLibraryChange(catalog,result,{baseHash:libraryHash(result),changes:[{op:'derive',slot:rule.slot,rule:id,inputs:rule.inputs!}]});
 }
 return result;
}
/** Check materialization against the builtin, not an editable concrete template or only its self-hash. */
export function checkIdentityDerivations(catalog: CatalogData,library: LibraryData): string[] {
 let fresh: Resolved | undefined;
 const profile=():Resolved=>fresh??=resolve({catalog,library});
 return checkIdentityDerivationsWithContext(library,profile,createDerivationInputsHasher(profile));
}
/** Internal context belongs to one invocation; never use caller-supplied resolved evidence here. */
export function checkIdentityDerivationsWithContext(library: LibraryData, profile: () => Resolved, hashInputs: (inputs: readonly string[]) => string, tokensOf: typeof flatten = flatten): string[] {
 const errors: string[]=[];
 const rules=new Map<string,ReturnType<typeof instantiateIdentityRuleFromResolved>>();
 for(const fill of library.fills) for(const [member,token] of Object.entries(tokensOf(fill))) {
  const origin=token.$extensions?.['com.clossys.origin']; if(origin?.kind!=='derived'||!IDENTITY_RULES.includes(origin.rule as IdentityRuleId)) continue;
  try {
   let instantiated=rules.get(origin.rule);
   if(!instantiated) { instantiated=instantiateIdentityRuleFromResolved(profile(),origin.rule as IdentityRuleId);rules.set(origin.rule,instantiated); }
   const {rule,inputs}=instantiated;
   if(JSON.stringify([...origin.inputs].sort())!==JSON.stringify([...inputs].sort())||origin.inputsHash!==hashInputs(inputs)) errors.push(`${member}: stale or altered identity inputs`);
   const expected=rule.values[member.split('.').slice(2).join('.')]; if(!expected||expected.$value!==token.$value) errors.push(`${member}: identity output differs from builtin rule`);
  } catch(error) {errors.push(`${member}: ${String(error)}`);}
 }
 return errors.sort();
}
