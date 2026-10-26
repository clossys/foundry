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
import {checkAssetProfile} from './check.js';

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
 it('reversed paints the inverse plate with the star cut through to the ground, never plate-on-plate',async()=>{
  const px=await raster(members()('assets.mark.reversed'),100);
  expect(hex(px(PLATE.x,PLATE.y))).toBe(ON_INVERSE);
  expect(px(PLATE.x,PLATE.y)[3]).toBe(255);
  expect(px(STAR.x,STAR.y)[3]).toBe(0);
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
  expect(at(PLATE)[3]).toBe(255);
  expect(at(STAR)[3]).toBe(0);
 });
 it('reversed roles pass the A5 contrast check on every inverse and dark ground',()=>{
  const library=deriveIdentity(catalog,createConsumerIdentitySeeds(catalog,base(),{name:'Example',suppliedSvg:MARK,fontLicence:{family:'sans-serif',outlining:'unknown'}}));
  const a5=checkAssetProfile(catalog,library).filter(f=>f.code==='A5'&&f.subject.endsWith('.reversed'));
  expect(a5.map(f=>[f.subject,f.verdict])).toEqual([['assets.lockup.reversed','satisfied'],['assets.mark.reversed','satisfied']]);
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

/*
 * The consumer kit as a real product library holds it: the mark exported with whitespace between
 * tags, the star inheriting the inverse ink from its group, the plate in the primary ink, and a
 * lockup seed nesting that mark beside a live-text wordmark. Tokens are the product's own values.
 */
const K={primary:'#0A0A0A',primaryDark:'#FAFAFA',onInverse:'#FAFAFA',base:'#F5F5F5',baseDark:'#0F0F0F',inverse:'#0A0A0A'};
const KIT_BODY=`\n  <rect width="100" height="100" rx="21.875" fill="#0A0A0A"/>\n  <g transform="translate(50 50)" fill="#FAFAFA">${[0,72,144,216,288].map(d=>`<rect x="-5.75" y="-32" width="11.5" height="32" transform="rotate(${d.toFixed(1)})"/>`).join('')}</g>\n`;
const KIT_MARK=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="Example" data-clear-space="0.2">${KIT_BODY}</svg>\n`;
const KIT_LOCKUP=`<svg aria-label="Example" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 48" data-clear-space="0.2"><svg x="0" y="0" width="48" height="48" viewBox="0 0 100 100">${KIT_BODY}</svg><text x="56" y="31" font-size="22" font-family="sans-serif" fill="#0A0A0A">Example</text></svg>`;
function kitLibrary():LibraryData{
 let library:LibraryData={source:{id:'example',kind:'consumer',author:'consumer',license:'MIT',extends:'foundry'},fills:[],adoptedAt:'2026-10-23',rubricVersion:'test',strategy:{posture:'proven'},direction:{rule:'identity-mark@1'}};
 const color=(value:string,dark?:string):DtcgToken=>({$type:'color',$value:value,$extensions:{'com.clossys.css':{raw:value},...(dark?{'com.clossys.modes':{dark}}:{})}});
 const svg=(value:string):DtcgToken=>({$type:'svg',$value:value,$extensions:{'com.clossys.origin':{kind:'authored',license:'MIT',note:'Consumer identity seed'}}});
 library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[
  {op:'author',slot:'tokens.text-color',tokens:{primary:color(K.primary,K.primaryDark),'on-inverse':color(K.onInverse,K.inverse),'on-accent':color(K.onInverse)}},
  {op:'author',slot:'tokens.surface-color',tokens:{base:color(K.base,K.baseDark),inverse:color(K.inverse,K.primaryDark)}},
  {op:'author',slot:'tokens.accent-color',tokens:{default:color('#6E3FC7')}},
  {op:'author',slot:'tokens.typeface',tokens:{display:{$type:'fontFamily',$value:['sans-serif']}}},
  {op:'author',slot:'assets.mark',tokens:{positive:svg(KIT_MARK)}},
  {op:'author',slot:'assets.lockup',tokens:{positive:svg(KIT_LOCKUP)}},
 ]});
 return deriveIdentity(catalog,library);
}
describe('identity roles derived from the product-shaped consumer kit',()=>{
 const library=kitLibrary();
 const get=(id:string):string=>resolve({catalog,library}).members[id]!.value.light as string;
 /** Composite a role onto a ground, as the specimen and a page do. */
 async function on(svg:string,ground:string,width:number,height=width){
  const data=await sharp(Buffer.from(svg),{density:288}).resize(width,height,{fit:'fill'}).flatten({background:ground}).raw().toBuffer();
  return (x:number,y:number):string=>{const i=(Math.round(y)*width+Math.round(x))*3;return '#'+[data[i]!,data[i+1]!,data[i+2]!].map(v=>v.toString(16).padStart(2,'0')).join('');};
 }
 it('materializes exactly the builtin rule output (no A12 identity drift)',()=>{
  expect(checkIdentityDerivations(catalog,library)).toEqual([]);
  expect(checkAssetProfile(catalog,library).filter(f=>f.code==='A12'&&['assets.identity','assets.mark','assets.lockup','assets.favicon','assets.app-icon'].includes(f.subject)&&f.verdict!=='satisfied')).toEqual([]);
 });
 it('reversed mark and lockup measure at least 3:1 against every inverse and dark ground',()=>{
  const a5=checkAssetProfile(catalog,library).filter(f=>f.code==='A5'&&f.subject.endsWith('.reversed'));
  expect(a5.map(f=>f.subject)).toEqual(['assets.lockup.reversed','assets.mark.reversed']);
  for(const f of a5){expect(f.verdict,f.subject).toBe('satisfied');expect(Number(/Minimum contrast ([\d.]+):1/.exec(f.message)![1]),f.subject).toBeGreaterThanOrEqual(3);}
 });
 it('reversed mark shows the star on every dark ground: a light plate with the star cut through to the ground',async()=>{
  for(const ground of [K.inverse,K.baseDark,'#1a1a1a']){
   const px=await on(get('assets.mark.reversed'),ground,100);
   expect(px(PLATE.x,PLATE.y),ground).toBe(K.onInverse.toLowerCase());
   expect(px(STAR.x,STAR.y),ground).toBe(ground.toLowerCase());
  }
 });
 it('reversed lockup keeps the star visible in its mark and sets the wordmark in the inverse ink',async()=>{
  const lockup=get('assets.lockup.reversed');
  expect(lockup).toMatch(/<text[^>]*fill="#FAFAFA"/i);
  const px=await on(lockup,K.inverse,320*4,192);
  const at=(p:{x:number;y:number})=>px(p.x*0.48*4,p.y*0.48*4);
  expect(at(PLATE)).toBe(K.onInverse.toLowerCase());
  expect(at(STAR)).toBe(K.inverse.toLowerCase());
 });
 it('mono is one currentColor paint with the star knocked out, never a solid block',async()=>{
  const mono=get('assets.mark.mono');
  expect(new Set([...mono.replace(/<mask[\s\S]*?<\/mask>/g,'').matchAll(/\b(?:fill|stroke|color)="([^"]+)"/g)].map(m=>m[1]))).toEqual(new Set(['currentColor']));
  expect(checkAssetProfile(catalog,library).find(f=>f.code==='A7')?.verdict).toBe('satisfied');
  const px=await on(mono.replace('<svg ','<svg color="#000000" '),'#ffffff',100);
  expect(px(PLATE.x,PLATE.y)).toBe('#000000');
  expect(px(STAR.x,STAR.y)).toBe('#ffffff');
 });
 it('favicon and app icons keep the star in the opposite ink of their plate',async()=>{
  const favicon=await on(get('assets.favicon.vector'),'#ffffff',100);
  expect(favicon(PLATE.x,PLATE.y)).toBe(K.primary.toLowerCase());
  expect(favicon(STAR.x,STAR.y)).toBe(K.onInverse.toLowerCase());
  for(const id of ['assets.app-icon.standard','assets.app-icon.maskable']){
   const px=await on(get(id),'#ffffff',512);
   const at=(p:{x:number;y:number})=>px(116+p.x*2.8,116+p.y*2.8);
   expect(at(PLATE),id).toBe(K.primary.toLowerCase());
   expect(at(STAR),id).toBe(K.onInverse.toLowerCase());
  }
 });
});
