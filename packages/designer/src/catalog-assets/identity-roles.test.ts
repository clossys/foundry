// @vitest-environment node
import {describe,it,expect} from 'vitest';
import sharp from 'sharp';
import {loadCatalog} from '../catalog-core/index.js';
import {applyLibraryChange} from '../catalog-core/library.js';
import {resolve,libraryHash} from '../catalog-core/resolve.js';
import type {LibraryData,DtcgToken} from '../catalog-core/types.js';
import {withAssetCatalog} from './catalog.js';
import {createConsumerIdentitySeeds,deriveIdentity,checkIdentityDerivations} from './identity.js';
import {inspectSvg} from './svg.js';

/*
 * Identity roles from a plate-and-star mark whose star paint is inherited from its group,
 * the shape real brand marks are exported in. Every role is judged by its rendered pixels.
 */
const catalog=withAssetCatalog(loadCatalog());
const INK='#111111', ON_INVERSE='#ffffff';
function base():LibraryData{
 let library:LibraryData={source:{id:'example',kind:'consumer',author:'consumer',license:'MIT',extends:'foundry'},fills:[],adoptedAt:'2026-10-23',rubricVersion:'test',strategy:{posture:'proven'},direction:{rule:'identity-mark@1'}};
 const token=(value:string,dark?:string):DtcgToken=>({$type:'color',$value:value,$extensions:{'com.clossys.css':{raw:value},...(dark?{'com.clossys.modes':{dark}}:{})}});
 library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:'author',slot:'tokens.text-color',tokens:{primary:token(INK,ON_INVERSE),'on-inverse':token(ON_INVERSE),'on-accent':token(ON_INVERSE)}},{op:'author',slot:'tokens.surface-color',tokens:{base:token(ON_INVERSE,INK),inverse:token(INK)}},{op:'author',slot:'tokens.accent-color',tokens:{default:token('#2255aa')}},{op:'author',slot:'tokens.typeface',tokens:{display:{$type:'fontFamily',$value:['sans-serif']}}}]});
 return library;
}
const spoke=(deg:number)=>`<rect x="-5.75" y="-32" width="11.5" height="32" transform="rotate(${deg})"/>`;
/** A rounded ink plate and a five-spoke star whose fill is inherited from its group. */
const MARK=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="Example" data-clear-space="0.2"><rect width="100" height="100" rx="21.875" fill="#0A0A0A"/><g transform="translate(50 50)" fill="#FAFAFA">${[0,72,144,216,288].map(spoke).join('')}</g></svg>`;
function members(){
 const library=deriveIdentity(catalog,createConsumerIdentitySeeds(catalog,base(),{name:'Example',suppliedSvg:MARK,fontLicence:{family:'sans-serif',outlining:'unknown'}}));
 expect(checkIdentityDerivations(catalog,library)).toEqual([]);
 const resolved=resolve({catalog,library}).members;
 return (id:string):string=>{const svg=resolved[id]!.value.light as string;inspectSvg(svg,{favicon:id==='assets.favicon.vector'});return svg;};
}
type Pixel=[number,number,number,number];
async function raster(svg:string,width:number,height=width){
 const data=await sharp(Buffer.from(svg),{density:288}).resize(width,height,{fit:'fill'}).ensureAlpha().raw().toBuffer();
 return (x:number,y:number):Pixel=>{const i=(Math.round(y)*width+Math.round(x))*4;return [data[i]!,data[i+1]!,data[i+2]!,data[i+3]!];};
}
const hex=(p:Pixel)=>'#'+p.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');
/** At favicon sizes a spoke is under two pixels wide, so a sample is judged by the nearer of the two paints. */
const nearer=(p:Pixel,a:string,b:string)=>{const d=(h:string)=>[1,3,5].reduce((sum,i,k)=>sum+Math.abs(parseInt(h.slice(i,i+2),16)-p[k]!),0);return d(a)<=d(b)?a:b;};
// On the 100-unit mark: a point on the top spoke of the star, a point on the plate, and the plate's corner.
const STAR={x:50,y:30},PLATE={x:12,y:50},CORNER={x:1,y:1};

describe('identity roles derived from a group-painted two-tone mark',()=>{
 it('mono knocks the star out of the plate in one currentColor paint',async()=>{
  const mono=members()('assets.mark.mono');
  const paints=[...mono.replace(/<mask[\s\S]*?<\/mask>/g,'').matchAll(/\b(?:fill|stroke|color)="([^"]+)"/g)].map(m=>m[1]);
  expect(new Set(paints)).toEqual(new Set(['currentColor']));
  const px=await raster(mono,100);
  expect(px(PLATE.x,PLATE.y)[3]).toBe(255);
  expect(px(STAR.x,STAR.y)[3]).toBe(0);
  expect(px(CORNER.x,CORNER.y)[3]).toBe(0);
 });
 it('reversed paints the ink star on the inverse plate, never plate-on-plate',async()=>{
  const px=await raster(members()('assets.mark.reversed'),100);
  expect(hex(px(PLATE.x,PLATE.y))).toBe(ON_INVERSE);
  expect(hex(px(STAR.x,STAR.y))).toBe('#0a0a0a');
  expect(px(CORNER.x,CORNER.y)[3]).toBe(0);
 });
 it('favicon has no square backing and its star is the opposite of its plate in both schemes',async()=>{
  const favicon=members()('assets.favicon.vector');
  const dark=/@media \(prefers-color-scheme: dark\)\{svg\{color:([^;]+);fill:([^}]+)\}\}/.exec(favicon)!;
  expect(dark).not.toBeNull();
  const schemes={light:favicon.replace(/<style>.*?<\/style>/,''),dark:favicon.replace(/<style>.*?<\/style>/,'').replace(/color="[^"]+"/,`color="${dark[1]}"`).replace(/ fill="[^"]+"/,` fill="${dark[2]}"`)};
  for(const [scheme,svg] of Object.entries(schemes)) for(const size of [16,32,48]){
   const px=await raster(svg,size),k=size/100;
   const plate=nearer(px(PLATE.x*k,PLATE.y*k),INK,ON_INVERSE),star=nearer(px(STAR.x*k,STAR.y*k),INK,ON_INVERSE);
   expect(px(0,0)[3],`${scheme} ${size} corner`).toBe(0);
   expect(plate,`${scheme} ${size} plate`).toBe(scheme==='light'?INK:ON_INVERSE);
   expect(star,`${scheme} ${size} star`).toBe(scheme==='light'?ON_INVERSE:INK);
  }
 });
 it('app icons carry the star in the inverse ink on the ink plate',async()=>{
  const get=members();
  for(const id of ['assets.app-icon.standard','assets.app-icon.maskable']){
   const px=await raster(get(id),512);
   // The mark sits at 116..396 on the 512 canvas.
   const at=(p:{x:number;y:number})=>px(116+p.x*2.8,116+p.y*2.8);
   expect(hex(at(STAR)),id).toBe(ON_INVERSE);
   expect(hex(at(PLATE)),id).toBe(INK);
  }
 });
 it('reversed lockup keeps the two-tone mark and sets the wordmark in the inverse ink',async()=>{
  const lockup=members()('assets.lockup.reversed');
  expect(lockup).toMatch(/<text[^>]*fill="#ffffff"/);
  const width=Number(/viewBox="0 0 ([\d.]+) 48"/.exec(lockup)![1]);
  const px=await raster(lockup,width*4,192);
  const at=(p:{x:number;y:number})=>px(p.x*0.48*4,p.y*0.48*4);
  expect(hex(at(PLATE))).toBe(ON_INVERSE);
  expect(hex(at(STAR))).toBe('#0a0a0a');
 });
 it('lockup wordmark is set at weight 600 with negative tracking in a viewBox trimmed to its content',()=>{
  const lockup=members()('assets.lockup.positive');
  const text=/<text\b[^>]*>/.exec(lockup)![0];
  expect(text).toContain('font-weight="600"');
  expect(Number(/letter-spacing="([^"]+)"/.exec(text)![1])).toBeLessThan(0);
  const width=Number(/^<svg[^>]*viewBox="0 0 ([\d.]+) 48"/.exec(lockup)![1]);
  expect(width).toBeGreaterThanOrEqual(56+7*22*0.5);
  expect(width).toBeLessThanOrEqual(56+7*22*0.7);
  expect(width%4).toBe(0);
 });
});
