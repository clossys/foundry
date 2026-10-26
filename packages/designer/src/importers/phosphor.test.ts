// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import raw from './phosphor-raw.json' with {type:'json'};
import roster from './phosphor-pin.json' with {type:'json'};
import {importPhosphor,importPhosphorSvg,scalePhosphorPath,PHOSPHOR_SOURCE} from './phosphor.js';
import {PHOSPHOR_NOTICES} from './phosphor-license.js';
import {inspectGlyph,glyphSvg} from '../catalog-assets/svg.js';
import {assetNotices,emitGlyphModule} from '../catalog-assets/emit.js';
import {loadCatalog} from '../catalog-core/index.js';
import {flatten} from '../catalog-core/model.js';
import {applyLibraryChange} from '../catalog-core/library.js';
import {resolve,libraryHash} from '../catalog-core/resolve.js';
import type {LibraryData} from '../catalog-core/types.js';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const fills=importPhosphor();
const glyph=(index:number)=>Object.values(flatten(fills[index]!))[0]!.$value;
function adopted() {
 const catalog=loadCatalog();
 let library:LibraryData={source:{id:'example',kind:'consumer',author:'consumer',license:'MIT',extends:'foundry'},fills:[],adoptedAt:'2026-10-24',rubricVersion:'test',strategy:{posture:'proven'},direction:{}};
 library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:fills.map(fill=>({op:'adopt' as const,slot:fill.$extensions['com.clossys.fill'].slot,source:'phosphor'}))});
 return {catalog,library,profile:resolve({catalog,library})};
}
describe('pinned raw Phosphor data and runtime coverage',()=>{
 it('binds git raw bytes, roster and license without claiming registry artifact equivalence',()=>{
  expect(PHOSPHOR_SOURCE.pin!.commit).toBe('fe23e2534cdb7bec24bd8e6bd99b3676bcf0d54f');
  expect(PHOSPHOR_SOURCE.pin!.sha256).toBe(digest(readFileSync(new URL('./phosphor-pin.json',import.meta.url),'utf8')));
  const notice=readFileSync(new URL('./vendor/phosphor/LICENSE',import.meta.url),'utf8');expect(PHOSPHOR_NOTICES.endsWith(notice)).toBe(true);
  const provenance=JSON.parse(readFileSync(new URL('./vendor/phosphor/provenance.json',import.meta.url),'utf8'));expect(provenance.registryArtifactBinding).toMatch(/unverified/);
  for(const file of provenance.files){const local=file.path==='package.json'?'upstream-package.json.txt':file.path;expect(digest(readFileSync(new URL(`./vendor/phosphor/${local}`,import.meta.url),'utf8'))).toBe(file.sha256);}
  for(const row of roster){const bytes=readFileSync(new URL(`./vendor/phosphor/raw/regular/${row.upstream}.svg`,import.meta.url),'utf8');expect(bytes).toBe((raw as Record<string,string>)[row.upstream]);expect(digest(bytes)).toBe(row.pin.sha256);expect(row.pin.url).toContain(`/${row.pin.commit}/raw/regular/`);}
 });
 it('offers all 40 icon leaves including the approved seal-check, and roundtrips adoption/emission',()=>{
  const {catalog,profile}=adopted();expect(fills).toHaveLength(40);expect(new Set(roster.map(row=>row.leaf)).size).toBe(40);
  expect(catalog.sources.filter(s=>s.id==='phosphor')).toHaveLength(1);expect(catalog.fills.filter(f=>f.$extensions['com.clossys.fill'].source==='phosphor')).toHaveLength(40);
  expect(catalog.slots.filter(s=>s.layer==='assets')).toHaveLength(48);expect(roster.some(row=>row.leaf==='assets.icon-document-approved'&&row.upstream==='seal-check')).toBe(true);
  const emitted=JSON.parse(emitGlyphModule(profile).split('export const glyphs = ')[1]!.split(' as const;')[0]!);
  for(const fill of fills){const meta=fill.$extensions['com.clossys.fill'];expect(JSON.parse(readFileSync(new URL(`../catalog/fills/phosphor/${meta.slot}.json`,import.meta.url),'utf8'))).toEqual(fill);const value=Object.values(flatten(fill))[0]!.$value;expect(profile.members[`${meta.slot}.default`]!.value.light).toEqual(value);expect(emitted[meta.slot.slice(7)]).toEqual(value);}
  expect(assetNotices(profile)).toContain(PHOSPHOR_NOTICES);expect(assetNotices({...profile,members:{}})).not.toContain(PHOSPHOR_NOTICES);
 });
 it('scales every coordinate by exactly 3/32 while preserving arc rotation and flags',()=>{
  expect(scalePhosphorPath('M128 256a16 32 45 1 0 -64 128Z')).toBe('M 12 24 a 1.5 3 45 1 0 -6 12 Z');
  expect(importPhosphorSvg(raw.house)[0]).toEqual(['path',{d:'M 9.75 20.25 V 14.25 h 4.5 v 6 h 6 V 11.25 a 0.75 0.75 0 0 0 -0.219375 -0.530625 l -7.5 -7.5 a 0.75 0.75 0 0 0 -1.06125 0 l -7.5 7.5 A 0.75 0.75 0 0 0 3.75 11.25 v 9 Z'}]);
 });
 it('only removes monitor half-turn when the rounded rectangle is exactly invariant',()=>{
  expect(importPhosphorSvg(raw.monitor)[0]).toEqual(['rect',{x:'3',y:'4.5',width:'18',height:'13.5',rx:'1.5'}]);
  expect(()=>importPhosphorSvg(raw.monitor.replace('translate(256 240)','translate(255 240)'))).toThrow(/non-invariant/);
 });
 it('retains the three actual solid dots with original radius and center',()=>{
  for(const [name,cx,cy] of [['info','11.625','7.875'],['warning','12','16.875'],['lock','12','14.25']])expect(importPhosphorSvg((raw as Record<string,string>)[name!]!)).toContainEqual(['circle',{cx,cy,r:'1.125',fill:'currentColor',stroke:'none'}]);
 });
 it.each(roster)('renders an independent upstream golden for $upstream at native/token stroke and 16/24/32px',async row=>{
  const original=(raw as Record<string,string>)[row.upstream]!;const index=roster.indexOf(row);
  for(const stroke of [1.5,2])for(const size of [16,24,32]){
   const upstream=original.replace('<svg ','<svg width="'+size+'" height="'+size+'" ').replaceAll('stroke-width="16"',`stroke-width="${stroke*256/24}"`);
   const [a,b]=await Promise.all([sharp(Buffer.from(upstream)).ensureAlpha().raw().toBuffer(),sharp(Buffer.from(glyphSvg(glyph(index),size,stroke))).ensureAlpha().raw().toBuffer()]);
   expect(a.equals(b),`${row.upstream}, size ${size}, stroke ${stroke}`).toBe(true);
  }
 });
});
describe('Phosphor refusal boundaries',()=>{
 it.each(['fill="currentColor"','fill="#000000"','opacity="0.2"','style="fill:red"','transform="scale(0.9)"'])('refuses expanded upstream paint/geometry %s',attr=>expect(()=>importPhosphorSvg(raw.house.replace('fill="none" stroke',`${attr} stroke`))).toThrow());
 it.each(['M1 2 A3 4 0 2 0 5 6','M1 2 L3','M1 2 R3 4','M1 2z3','M1 2a1 2 0 0 0 NaN 2'])('refuses malformed paths %s',path=>expect(()=>scalePhosphorPath(path)).toThrow());
 it.each([
  ['path',{d:'M1 1h2',fill:'currentColor'}],['rect',{x:'1',y:'1',width:'2',height:'2',fill:'currentColor'}],
  ['circle',{cx:'12',cy:'12',r:'1.125',fill:'red',stroke:'none'}],['circle',{cx:'12',cy:'12',r:'2',fill:'currentColor',stroke:'none'}],
  ['circle',{cx:'12',cy:'12',r:'1.125',fill:'currentColor'}],['circle',{cx:'Infinity',cy:'12',r:'1.125',fill:'currentColor',stroke:'none'}],
  ['circle',{cx:'12',cy:'12',r:'1.125',fill:'currentColor',stroke:'none',style:'opacity:1'}],
  ['circle',{cx:'12',cy:'12',r:'1.125',fill:'currentColor',stroke:'none','stroke-width':'2'}],
  ['circle',{cx:'12',cy:'12',r:'1.125',fill:'currentColor',stroke:'none',transform:'translate(1 1)'}],
 ].map(node=>[node]))('refuses everything beyond the exact solid-dot exception %s',node=>expect(()=>inspectGlyph([node])).toThrow());
});
