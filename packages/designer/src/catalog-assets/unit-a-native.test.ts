// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyLibraryChange, check, libraryHash, loadBuildCatalog, loadCatalog, resolve, type LibraryData } from '../catalog-core/index.js';
import { sha256 } from '../catalog-core/digest.js';
import { cssText, flatten, metaOf } from '../catalog-core/model.js';
import { completedTokenLibrary } from '../importers/__fixtures__/completed-token-library.js';
import { importLucide } from '../importers/lucide.js';
import roster from '../importers/lucide-pin.json' with { type: 'json' };
import { loadNativeDefaultSources } from '../library-cli/native-catalog.js';
import { adoptSuppliedMark, type IdentityTokenInput } from '../tokens/identity-kit.js';
import { createConsumerIdentitySeeds, deriveIdentity, instantiateIdentityRule, checkIdentityDerivations } from './identity.js';
import { checkAssetProfile } from './check.js';
import { faviconForScheme } from './emit.js';
import { inspectSvg } from './svg.js';

const catalog=loadCatalog();
const iconNames='arrow-right external-link home settings list-view grid-view theme-light theme-dark theme-system success warning danger info user team organization website institution guide document document-approved folder time payment receipt business security locked legal package layers integration panel-left'.split(' ');
const foundrySlots=['app-icon','favicon','image','image-ratio','pattern'];
const policies=Object.fromEntries([...iconNames.map(name=>[`assets.icon-${name}`,'lucide']),...foundrySlots.map(name=>[`assets.${name}`,'foundry'])]);
const start=():LibraryData=>completedTokenLibrary(catalog,{id:'example',kind:'consumer',author:'consumer',license:'MIT'},'2026-10-23');
const adopt=(library:LibraryData,slot:string,source='foundry')=>applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:'adopt',slot,source}]});
const videoA1=(c:typeof catalog,library:LibraryData)=>checkAssetProfile(c,library).find(row=>row.subject==='assets.video.default'&&row.code==='A1');

describe('H3 UNIT A native source and construction decisions',()=>{
 it('preserves the exact mixed Lucide manifest, file bytes and native adoption for all 33 decided icons',()=>{
  expect(sha256(readFileSync(new URL('../importers/lucide-pin.json',import.meta.url),'utf8'))).toBe('f3231b3ab02590141fd04ccad77aeae9e5944449bf2c8e85762d03974534582e');
  expect(loadNativeDefaultSources(loadBuildCatalog())).toMatchObject(policies);
  let library=start();
  for(const name of iconNames){
   const slot=`assets.icon-${name}`,row=roster.find(row=>row.leaf===slot)!;
   expect(row).toBeDefined();
   expect(sha256(readFileSync(new URL('../'+row.pin.file.replace(/^src\//,''),import.meta.url),'utf8'))).toBe(row.pin.sha256);
   const candidate=importLucide().find(fill=>metaOf(fill).slot===slot)!;
   expect(metaOf(candidate)).toMatchObject({id:`lucide/${slot}`,license:'ISC',pin:row.pin});
   library=adopt(library,slot,'lucide');
   expect(resolve({catalog,library}).members[slot+'.default']!.origin).toMatchObject({kind:'adopted',source:'lucide',license:'ISC',pin:row.pin});
  }
 });
 it('genuinely supplies the Foundry square ratio and existing pattern recipes, independent of alternatives',()=>{
  let library=adopt(start(),'assets.image-ratio'); library=adopt(library,'assets.pattern'); library=adopt(library,'assets.image');
  const profile=resolve({catalog,library});
  expect(profile.members['assets.image-ratio.square']!.value.light).toEqual({width:1,height:1});
  expect(Object.keys(profile.members).filter(id=>id.startsWith('assets.image-ratio.'))).toHaveLength(6);
  expect(Object.keys(profile.members).filter(id=>id.startsWith('assets.pattern.'))).toHaveLength(6);
  expect(metaOf(catalog.fills.find(fill=>metaOf(fill).id==='foundry/assets.pattern')!)).toMatchObject({pin:{sha256:'5cde189c7941f787042b61fe3ac9575b9d34918fa0d20d3f7740548d10aa5852'},reads:{tokens:['themes.border.default','tokens.border-width.hairline','themes.spacing.default'],assets:[]}});
  expect(sha256(readFileSync(new URL('./image-default.svg',import.meta.url),'utf8'))).toBe('aa230bccd0af384371603a0ed1fb3fc0cf19ea3172e6793440fa21bb345151fd');
 });
 it('derives identity roles from unchanged consumer positives through the existing native adoption implementation',()=>{
  const seeds=createConsumerIdentitySeeds(catalog,start(),{name:'Example Co.',fontLicence:{family:'sans-serif',outlining:'unknown'}});
  const before=resolve({catalog,library:seeds}), value=(id:string)=>before.members[id]!.value.light as string;
  const raw=(id:string)=>cssText(before.members[id]!.$type,before.members[id]!.value.light);
  const t:IdentityTokenInput={ink:raw('themes.foreground.default'),onInverse:raw('themes.foreground.default'),surfaceBase:raw('themes.background.default'),surfaceInverse:raw('themes.background.default'),accent:raw('themes.primary.default'),onAccent:raw('themes.accent-foreground.default'),fontFamily:raw('themes.font-heading.default')};
  const derived=deriveIdentity(catalog,seeds),profile=resolve({catalog,library:derived});
  const mark=adoptSuppliedMark({brand:{name:'Example Co.'},suppliedSvg:value('assets.mark.positive'),tokens:t});
  const lockup=adoptSuppliedMark({brand:{name:'Example Co.'},suppliedSvg:value('assets.lockup.positive'),tokens:t});
  expect(profile.members['assets.mark.positive']!.value.light).toBe(value('assets.mark.positive'));
  expect(profile.members['assets.lockup.positive']!.value.light).toBe(value('assets.lockup.positive'));
  expect(profile.members['assets.mark.mono']!.value.light).toBe(mark.variants.mono);
  expect(profile.members['assets.mark.reversed']!.value.light).toBe(mark.variants.dark);
  expect(profile.members['assets.lockup.reversed']!.value.light).toBe(lockup.variants.dark);
  for(const id of ['identity-mark@1','identity-lockup@1'] as const){
   const {rule,inputs}=instantiateIdentityRule(catalog,seeds,id);
   for(const [name,token] of Object.entries(rule.values)){
    const actual=profile.members[`${rule.slot}.${name}`]!;
    expect(actual.value.light).toBe(token.$value); expect(actual.origin).toMatchObject({kind:'derived',rule:id,inputs:[...inputs].sort()});
   }
   expect(inputs).toEqual(expect.arrayContaining(['themes.foreground.default','themes.foreground.default','themes.background.default','themes.background.default','themes.primary.default','themes.accent-foreground.default','themes.font-heading.default']));
  }
  expect(checkIdentityDerivations(catalog,derived)).toEqual([]);
  const decisions={...policies,'assets.lockup':'foundry','assets.mark':'foundry','assets.video':'foundry'};
  let batch=derived;
  for(const [slot,source] of Object.entries(decisions)) if(!['assets.lockup','assets.mark','assets.app-icon','assets.favicon'].includes(slot)) batch=adopt(batch,slot,source);
  expect(Object.keys(decisions)).toHaveLength(41);
  const a12=checkAssetProfile(catalog,batch).filter(row=>row.code==='A12'&&row.subject in decisions);
  expect(new Set(a12.map(row=>row.subject)).size).toBe(41);
  expect(a12.every(row=>row.verdict==='satisfied')).toBe(true);
  const findings=checkAssetProfile(catalog,derived);
  expect(findings).toContainEqual(expect.objectContaining({code:'A7',subject:'assets.mark.mono',verdict:'satisfied'}));
  for(const subject of ['assets.mark.reversed','assets.lockup.reversed']) expect(findings).toContainEqual(expect.objectContaining({code:'A5',subject,verdict:'satisfied'}));
  expect(findings).toContainEqual(expect.objectContaining({code:'A6',subject:'assets.favicon',verdict:'satisfied'}));
  expect(findings).toContainEqual(expect.objectContaining({code:'A8',subject:'assets.app-icon',verdict:'satisfied'}));
  for(const scheme of ['light','dark'] as const) expect(()=>inspectSvg(faviconForScheme(profile.members['assets.favicon.vector']!.value.light as string,scheme))).not.toThrow();
  const missing=structuredClone(seeds); missing.fills=missing.fills.filter(fill=>metaOf(fill).slot!=='themes.font-sans');
  expect(()=>deriveIdentity(catalog,missing)).toThrow(/missing consumer input/);
 });
 it('adopts the unchanged packaged video with an authentic A1/C10 trail and rejects missing pins or tampering',()=>{
  const candidate=catalog.fills.find(fill=>metaOf(fill).id==='foundry/assets.video')!;
  const upstream=flatten(candidate)['assets.video.default']!;
  const value=upstream.$value as {src:string};
  const bytes=Buffer.from(value.src.split(',')[1]!,'base64');
  for(const path of ['../../../../LICENSE','../../LICENSE']) expect(sha256(readFileSync(new URL(path,import.meta.url),'utf8'))).toBe('2fb06c60d79b0be483fd2dc0c907f58edb27afbc716e9d6c678384c38cf58544');
  expect(bytes).toHaveLength(542); expect(readFileSync(new URL('./video-default.webm',import.meta.url))).toEqual(bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('eb8b3203371df6fcfa9a857b3622b29d183845a86fca943bd8ed9e8ed2a400a5');
  const library=adopt(start(),'assets.video');
  expect(videoA1(catalog,library)?.verdict).toBe('satisfied');
  expect(resolve({catalog,library}).members['assets.video.default']!.origin).toMatchObject({kind:'adopted',license:'MIT',pin:metaOf(candidate).pin,sha256:'2670f85afb4391c423375c533842e40c392dfabb53c21bc0bf923cfe8e15d37d'});
  expect(check({catalog,library}).findings.filter(row=>row.code==='C10'&&row.subject.includes('assets.video'))).toEqual([]);
  const unpinned=structuredClone(catalog); delete metaOf(unpinned.fills.find(fill=>metaOf(fill).id==='foundry/assets.video')!).pin;
  expect(videoA1(unpinned,applyLibraryChange(unpinned,start(),{baseHash:libraryHash(start()),changes:[{op:'adopt',slot:'assets.video',source:'foundry'}]}))?.verdict).toBe('violated');
  const damaged=structuredClone(library); (flatten(damaged.fills.find(fill=>metaOf(fill).slot==='assets.video')!)['assets.video.default']!.$value as Record<string,unknown>).width=321;
  expect(check({catalog,library:damaged}).findings.some(row=>row.code==='C10'&&row.subject==='assets.video.default')).toBe(true);
  expect(videoA1(catalog,library)?.verdict).toBe('satisfied');
 });
});
