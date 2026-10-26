// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import sharp from 'sharp';
import {loadCatalog} from '../catalog-core/index.js';
import {applyLibraryChange,generateSelection} from '../catalog-core/library.js';
import {resolve,libraryHash} from '../catalog-core/resolve.js';
import {flatten} from '../catalog-core/model.js';
import {parseFill} from '../catalog-core/cell.js';
import {check} from '../catalog-core/check.js';
import {sha256} from '../catalog-core/digest.js';
import {importLucide} from '../importers/lucide.js';
import roster from '../importers/lucide-pin.json' with {type:'json'};
import {withAssetCatalog} from './catalog.js';
import {createConsumerIdentitySeeds,deriveIdentity,instantiateIdentityRule,checkIdentityDerivations} from './identity.js';
import {inspectSvg,inspectGlyph,glyphSvg} from './svg.js';
import {authorImageRatios,authorMediaResources,assetCoverageReport,checkAssetProfile} from './check.js';
import {importPatterns} from '../importers/pattern.js';
import {PATTERN_RECIPES} from '../tokens/pattern.js';
import {stableStringify} from '../catalog-core/stable.js';
import {emitWebIcons,emitIdentityFiles,emitGlyphModule,pngDimensions,assetNotices} from './emit.js';
import type {LibraryData,DtcgToken} from '../catalog-core/types.js';
const catalog=withAssetCatalog(loadCatalog());
function base():LibraryData{
 let library:LibraryData={source:{id:'example',kind:'consumer',author:'consumer',license:'MIT',extends:'foundry'},fills:[],adoptedAt:'2026-10-23',rubricVersion:'test',strategy:{posture:'proven'},direction:{rule:'identity-mark@1'}};
 const token=(value:string,dark?:string):DtcgToken=>({$type:'color',$value:value,$extensions:{'com.clossys.css':{raw:value},...(dark?{'com.clossys.modes':{dark}}:{})}});
 library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:'author',slot:'tokens.text-color',tokens:{primary:token('#111111','#ffffff'),'on-inverse':token('#ffffff'),'on-accent':token('#ffffff')}},{op:'author',slot:'tokens.surface-color',tokens:{base:token('#ffffff','#111111'),inverse:token('#111111')}},{op:'author',slot:'tokens.accent-color',tokens:{default:token('#2255aa')}},{op:'author',slot:'tokens.typeface',tokens:{display:{$type:'fontFamily',$value:['sans-serif']}}}]});
 return library;
}
function identity():LibraryData {return deriveIdentity(catalog,createConsumerIdentitySeeds(catalog,base(),{name:'Example',fontLicence:{family:'sans-serif',outlining:'unknown'}}));}
function complete():LibraryData{
 let library=identity();library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:importLucide().map(fill=>({op:'adopt' as const,slot:fill.$extensions['com.clossys.fill'].slot,source:'lucide'}))});
 library=authorImageRatios(catalog,library,{ratios:{landscape:{width:3,height:2}},source:'Consumer editorial brief',rationale:'Landscape crop for editorial media'});
 return media(library);
}
const IMAGE={kind:'illustration',src:'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2040%2030%22%3E%3Crect%20width%3D%2240%22%20height%3D%2230%22%20fill%3D%22%23445566%22%2F%3E%3C%2Fsvg%3E',width:40,height:30,alt:'A flat slate panel'};
const VIDEO={src:'https://media.example.invalid/tour.mp4',mediaType:'video/mp4',width:1280,height:720,reducedMotion:'poster',captions:{src:'https://media.example.invalid/tour.en.vtt',srclang:'en',label:'English'}};
/** Consumer media through the producer pipeline: one authored image and video, the Foundry pattern recipes adopted. */
function media(prior:LibraryData):LibraryData{
 let library=authorMediaResources(catalog,prior,{slot:'assets.image',resources:{hero:IMAGE},source:'Consumer media brief',rationale:'Product illustration'});
 library=authorMediaResources(catalog,library,{slot:'assets.video',resources:{tour:VIDEO},source:'Consumer media brief',rationale:'Product tour'});
 return applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:'adopt',slot:'assets.pattern',source:'foundry'}]});
}
describe('frozen asset catalog and exact upstream mapping',()=>{
 it('registers 48 unique leaves, one IA home each, 40 Lucide and only one Foundry candidate (brand rows offer nothing)',()=>{const assets=catalog.slots.filter(s=>s.layer==='assets');expect(assets).toHaveLength(48);expect(new Set(assets.map(s=>s.id)).size).toBe(48);const collect=(node:any):string[]=>node.leaves??node.children.flatMap(collect);const placements=catalog.placements.find(p=>p.layer==='assets')!.nodes.flatMap(collect);expect([...placements].sort()).toEqual(assets.map(s=>s.id).sort());expect(catalog.fills.filter(f=>f.assets&&f.$extensions['com.clossys.fill'].source==='foundry').map(f=>f.$extensions['com.clossys.fill'].slot).sort()).toEqual(['assets.pattern']);expect(catalog.fills.filter(f=>f.assets&&f.$extensions['com.clossys.fill'].source==='lucide')).toHaveLength(40);expect(catalog.fills.some(f=>f.$extensions['com.clossys.fill'].id==='foundry/assets.image-ratio')).toBe(false);expect(assets.find(s=>s.id==='assets.image-ratio')!.contract.members).not.toHaveProperty('required');});
 it.each(roster)('copies $leaf path nodes byte for byte with exact source pin',row=>{const text=readFileSync(new URL('../'+row.pin.file.replace(/^src\//,''),import.meta.url),'utf8');expect(sha256(text)).toBe(row.pin.sha256);const expected=JSON.parse(/= (\[[\s\S]*\]) as const;/.exec(text)![1]!);const fill=importLucide().find(f=>f.$extensions['com.clossys.fill'].slot===row.leaf)!;expect(Object.values(flatten(fill))[0]!.$value).toEqual(expected);expect(fill.$extensions['com.clossys.fill'].license).toBe('ISC');const stored=JSON.parse(readFileSync(new URL(`../catalog/fills/lucide/${row.leaf}.json`,import.meta.url),'utf8'));expect(stored).toEqual(fill);});
 it('keeps the static Lucide source descriptor bound to its exact roster',()=>{const source=JSON.parse(readFileSync(new URL('../catalog/sources/lucide.json',import.meta.url),'utf8'));expect(source.pin.sha256).toBe(sha256(readFileSync(new URL('../importers/lucide-pin.json',import.meta.url),'utf8')));});
});
describe('closed SVG and glyph grammar',()=>{
 const safe='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z" fill="#111111"/></svg>';
 it('accepts geometry; shell owns paint, size and stroke',()=>{expect(inspectSvg(safe)).toHaveLength(2);const glyph=Object.values(flatten(importLucide()[0]!))[0]!.$value;expect(()=>inspectGlyph(glyph)).not.toThrow();for(const size of [16,24,32])expect(glyphSvg(glyph,size)).toContain(`width="${size}"`);expect(()=>glyphSvg(glyph,64)).toThrow();});
 it.each(['<script>alert(1)</script>','<foreignObject/>','<image href="https://example.invalid/x"/>','<style>path{fill:red}</style>','<path onclick="go()"/>','<path style="fill:red"/>','<use href="data:image/svg+xml,test"/>','<path fill="url(#paint)"/>','<g xmlns:evil="https://example.invalid"/>'])('refuses active or foreign markup %s',body=>expect(()=>inspectSvg(safe.replace(/<path[^>]*\/>/,body))).toThrow());
 it.each(['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///x">]>','<?xml version="1.0"?>'])('refuses XML declarations %s',prefix=>expect(()=>inspectSvg(prefix+safe)).toThrow());
 it('refuses caps, malformed XML and unknown entities',()=>{expect(()=>inspectSvg(safe,{maxBytes:3})).toThrow();expect(()=>inspectSvg(safe.replace('<path','<g><g><path').replace('</svg>','</g></g></svg>'),{maxDepth:2})).toThrow();for(const bad of [safe+'</svg>',safe.replace('fill="#111111"','fill="#111111" fill="#222222"'),safe.replace('M2 2','&unknown;'),safe+'<svg viewBox="0 0 2 2"/>'])expect(()=>inspectSvg(bad)).toThrow();});
 it('only permits the exact single dark-scheme favicon style exception',()=>{const library=identity(),favicon=resolve({catalog,library}).members['assets.favicon.vector']!.value.light as string;expect(()=>inspectSvg(favicon)).toThrow();expect(()=>inspectSvg(favicon,{favicon:true})).not.toThrow();expect(()=>inspectSvg(favicon.replace('fill:#ffffff','fill:url(https://example.invalid)'),{favicon:true})).toThrow();expect(()=>inspectSvg(favicon.replace('</style>','</style><style>@media (prefers-color-scheme: dark){svg{color:#ffffff}}</style>'),{favicon:true})).toThrow();});
 it('accepts only safe dark-scheme paints in favicon mode, including legacy color-only',()=>{
  const wrap=(rule:string)=>`<svg viewBox="0 0 24 24"><style>${rule}</style><path d="M2 2h20v20H2z" fill="currentColor"/></svg>`;
  const valid='@media (prefers-color-scheme: dark){svg{color:#111111;fill:#ffffff}}';
  expect(()=>inspectSvg(wrap(valid),{favicon:true})).not.toThrow();
  expect(()=>inspectSvg(wrap(valid))).toThrow();
  expect(()=>inspectSvg(wrap(valid.replace(';fill:#ffffff','')),{favicon:true})).not.toThrow();
  for(const bad of [
    valid.replace('#111111','url(https://example.invalid)'),valid.replace('#ffffff','var(--paint)'),
    valid.replace('#ffffff','#fff;stroke:#000'),valid.replace('svg{','path{'),
    valid+'@import "https://example.invalid/x";',
    valid.replace(';fill:#ffffff',';fill:#ffffff;fill:#000'),valid.replace('#ffffff','red'),
    valid.replace('#ffffff','#fff!important'),valid.replace('dark','light'),
  ])expect(()=>inspectSvg(wrap(bad),{favicon:true})).toThrow();
 });
 it.each(['fill','stroke','stroke-width','style','onload'])('rejects per-node paint or active attribute %s',attr=>expect(()=>inspectGlyph([['path',{d:'M2 2h20',[attr]:'red'}]])).toThrow());
});
describe('consumer identity and explicit refresh',()=>{
 it('preserves authored seeds, derives actual variants and remains deterministic',()=>{const first=identity();expect(first).toEqual(identity());const members=resolve({catalog,library:first}).members;expect(members['assets.mark.positive']!.origin!.kind).toBe('authored');expect(members['assets.mark.mono']!.origin!.kind).toBe('derived');expect(members['assets.mark.mono']!.value.light).not.toMatch(/color="(?!currentColor)/);expect(checkIdentityDerivations(catalog,first)).toEqual([]);for(const [id,m] of Object.entries(members))if(m.$type==='svg')expect(()=>inspectSvg(m.value.light as string,{favicon:id==='assets.favicon.vector'})).not.toThrow();expect(first.selection).toEqual(generateSelection(first));});
 it('keeps two-tone artwork geometry and inverts the favicon plate; app icons use ink',()=>{
  const artwork='<svg viewBox="0 0 48 48"><rect x="2" y="2" width="44" height="44" rx="8" fill="#0A0A0A"/><path d="M12 24h24M24 12v24" fill="#FAFAFA"/></svg>';
  const library=deriveIdentity(catalog,createConsumerIdentitySeeds(catalog,base(),{name:'Example',suppliedSvg:artwork,fontLicence:{family:'sans-serif',outlining:'unknown'}}));
  const members=resolve({catalog,library}).members;
  const favicon=members['assets.favicon.vector']!.value.light as string;
  expect(favicon).toContain('color="#ffffff"');expect(favicon).toContain('fill="#111111"');
  expect(favicon).toContain('@media (prefers-color-scheme: dark){svg{color:#111111;fill:#ffffff}}');
  expect(favicon).toContain('d="M12 24h24M24 12v24"');expect(favicon).toContain('rx="8"');expect(favicon).toContain('<mask');
  for(const id of ['assets.app-icon.standard','assets.app-icon.maskable']){
    const svg=members[id]!.value.light as string;expect(svg).toContain('fill="#111111"');expect(svg).not.toContain('#2255aa');
    expect(svg).toContain('d="M12 24h24M24 12v24"');
  }
  expect(members['assets.mark.positive']!.value.light).toContain(artwork.slice(artwork.indexOf('<rect')));
 });
 it('renders the unchanged two-tone artwork in both favicon schemes',async()=>{
  const artwork='<svg viewBox="0 0 48 48"><rect x="2" y="2" width="44" height="44" rx="8" fill="#0A0A0A"/><path d="M16 16h16v16H16z" fill="#FAFAFA"/></svg>';
  const library=deriveIdentity(catalog,createConsumerIdentitySeeds(catalog,base(),{name:'Example',suppliedSvg:artwork,fontLicence:{family:'sans-serif',outlining:'unknown'}}));
  const favicon=resolve({catalog,library}).members['assets.favicon.vector']!.value.light as string;
  for(const size of [16,32])for(const dark of [false,true]){
    const expected=artwork.replaceAll('#0A0A0A',dark?'#ffffff':'#111111').replaceAll('#FAFAFA',dark?'#111111':'#ffffff');
    const actual=favicon.replace(/<style>.*?<\/style>/,'').replace('color="#ffffff"',`color="${dark?'#111111':'#ffffff'}"`).replace('fill="#111111"',`fill="${dark?'#ffffff':'#111111'}"`);
    const render=(svg:string)=>sharp(Buffer.from(svg)).resize(size,size).ensureAlpha().raw().toBuffer();
    const [a,b]=await Promise.all([render(actual),render(expected)]);
    expect(a.equals(b),`favicon size ${size}, dark ${dark}`).toBe(true);
    expect(a[3]).toBe(0);
  }
 });
 it('fails for missing consumer inputs, unsafe supplied marks and empty names',()=>{expect(()=>instantiateIdentityRule(catalog,base(),'identity-favicon@1')).toThrow(/missing consumer/);expect(()=>createConsumerIdentitySeeds(catalog,base(),{name:'',fontLicence:{family:'sans',outlining:'unknown'}})).toThrow();expect(()=>createConsumerIdentitySeeds(catalog,base(),{name:'Example',suppliedSvg:'<svg viewBox="0 0 24 24"><script/></svg>',fontLicence:{family:'sans',outlining:'unknown'}})).toThrow();});
 it('keeps consumer text escaped and supplied artwork structurally checked',()=>{const library=createConsumerIdentitySeeds(catalog,base(),{name:'A & B',suppliedSvg:'<svg viewBox="0 0 24 24" data-clear-space="0.2"><circle cx="12" cy="12" r="9" fill="#111111"/></svg>',fontLicence:{family:'sans-serif',outlining:'restricted'}});expect(resolve({catalog,library}).members['assets.mark.positive']!.value.light).toContain('aria-label="A &amp; B"');expect(()=>deriveIdentity(catalog,library)).not.toThrow();});
 it('detects stale token inputs without changing output, then explicit rederive changes bytes',()=>{const before=identity();const old=resolve({catalog,library:before}).members['assets.favicon.vector']!.value.light;const changed=applyLibraryChange(catalog,before,{baseHash:libraryHash(before),changes:[{op:'author',slot:'tokens.text-color',tokens:{primary:{$type:'color',$value:'#223344',$extensions:{'com.clossys.css':{raw:'#223344'},'com.clossys.modes':{dark:'#ddeeff'}}}}}]});expect(resolve({catalog,library:changed}).members['assets.favicon.vector']!.value.light).toBe(old);expect(checkIdentityDerivations(catalog,changed).join()).toContain('stale');const fresh=deriveIdentity(catalog,changed);expect(checkIdentityDerivations(catalog,fresh)).toEqual([]);expect(resolve({catalog,library:fresh}).members['assets.favicon.vector']!.value.light).not.toBe(old);});
 it('detects a hand-edited materialized variant and forged builtin template',()=>{const library=identity();const fill=library.fills.find(f=>f.$extensions['com.clossys.fill'].slot==='assets.mark')!;const token=flatten(fill)['assets.mark.reversed']!;token.$value=(token.$value as string).replace(/#ffffff/g,'#ff0000');expect(checkIdentityDerivations({...catalog,rules:[{id:'identity-mark@1',slot:'assets.mark',values:{reversed:token}}]},library).join()).toContain('differs from builtin');});
});
describe('coverage, scorecard and real asset files',()=>{
 it('serves all 48 leaves through Lucide, consumer artwork, builtin rules, consumer crops and media, and Foundry patterns',()=>{const library=complete();const report=assetCoverageReport(catalog,library);expect(report.total).toBe(48);expect(report.served).toBe(48);expect(report.leaves.find(l=>l.slot==='assets.pattern')!.members).toEqual(['assets.pattern.dots','assets.pattern.grid','assets.pattern.lines']);expect(report.leaves.find(l=>l.slot==='assets.favicon')!.reads).toContain('tokens.text-color.primary');expect(report.leaves.find(l=>l.slot==='assets.image-ratio')!.sources).toEqual(['example']);const assetErrors=check({catalog,library}).findings.filter(f=>f.severity==='error'&&f.subject.includes('assets.'));expect(assetErrors).toEqual([]);});
 it('offers every A1–A12 judgement and never treats absent optical evidence as a pass',()=>{const library=complete();const findings=checkAssetProfile(catalog,library,{images:[{id:'hero',width:1200,height:800,alt:'A landscape',format:'webp',bytes:100,maxBytes:200}]});expect(new Set(findings.map(f=>f.code))).toEqual(new Set(Array.from({length:12},(_,i)=>`A${i+1}`)));expect(findings.some(f=>f.code==='A6'&&f.verdict==='indeterminate')).toBe(true);expect(findings.some(f=>f.code==='A8'&&f.verdict==='satisfied')).toBe(true);expect(findings.filter(f=>f.code==='A2'&&f.verdict==='violated')).toEqual([]);expect(findings.some(f=>f.code==='A10'&&f.verdict==='satisfied')).toBe(true);expect(findings.filter(f=>f.verdict==='violated')).toEqual([]);});
 it('checks crop shape, alt, clear space, glyph measurements and maskable geometry',()=>{const library=complete(),profile=resolve({catalog,library});const mark=profile.members['assets.mark.positive']!;mark.value.light=(mark.value.light as string).replace('data-clear-space="0.2"','data-clear-space="0.01"');const mask=profile.members['assets.app-icon.maskable']!;mask.value.light=(mask.value.light as string).replace('width="280"','width="480"');const findings=checkAssetProfile(catalog,library,{resolved:profile,images:[{id:'bad',width:1200,height:1200,format:'webp',bytes:100}],glyphBounds:{'assets.icon-check.default':{x:0,y:0,width:24,height:24}}});for(const code of ['A4','A8','A10','A11'])expect(findings.some(f=>f.code===code&&f.verdict==='violated')).toBe(true);});
 it('writes exact real PNG sizes, ICO16+32, SVG, manifest, glyphs and honest licences',async()=>{const profile=resolve({catalog,library:complete()});const files=await emitWebIcons(profile,{name:'Example',rasterize:async(svg,size)=>new Uint8Array(await sharp(Buffer.from(svg)).resize(size,size).png().toBuffer())});expect(files).toHaveLength(9);for(const f of files.filter(f=>f.path.endsWith('.png'))){const meta=await sharp(f.bytes).metadata();expect(meta.width).toBe(Number(/(\d+)\.png$/.exec(f.path)![1]));expect(meta.height).toBe(meta.width);expect(pngDimensions(f.bytes).width).toBe(meta.width);}const ico=files.find(f=>f.path.endsWith('.ico'))!.bytes;const view=new DataView(ico.buffer);expect(view.getUint16(4,true)).toBe(2);expect([ico[6],ico[22]]).toEqual([16,32]);for(let i=0;i<2;i++){const entry=6+i*16,offset=view.getUint32(entry+12,true),size=view.getUint32(entry+8,true);expect(pngDimensions(ico.slice(offset,offset+size)).width).toBe(i?32:16);}const manifest=JSON.parse(new TextDecoder().decode(files.at(-1)!.bytes));expect(manifest.theme_color).toBe(profile.members['tokens.surface-color.base']!.css.light);expect(manifest.icons.every((icon:any)=>files.some(file=>file.path===icon.src))).toBe(true);expect(emitIdentityFiles(profile)).toHaveLength(5);expect(emitGlyphModule(profile).match(/icon-/g)).toHaveLength(40);const notices=assetNotices(profile);expect(notices).toContain('ISC License');expect(notices).toContain('The MIT License');expect(notices).toContain('lucide/assets.icon-check');},20000);
 it('rejects non-PNG and incorrectly sized rasterizer results',async()=>{const profile=resolve({catalog,library:identity()});await expect(emitWebIcons(profile,{name:'Example',rasterize:async()=>new Uint8Array([1,2,3])})).rejects.toThrow(/PNG/);const png=await sharp({create:{width:8,height:8,channels:4,background:'#ffffff'}}).png().toBuffer();await expect(emitWebIcons(profile,{name:'Example',rasterize:async()=>png})).rejects.toThrow(/wrong size/);});
});
describe('Media resources and patterns',()=>{
 it('registers image, video and pattern under Media with the signed contracts and families',()=>{
  const slot=(id:string)=>catalog.slots.find(s=>s.id===id)!;
  expect(slot('assets.image').contract).toEqual({kind:'asset',valueKind:'rules',members:{mode:'open',pattern:'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'},modes:['light']});
  expect(slot('assets.video').contract).toEqual({kind:'asset',valueKind:'rules',members:{mode:'open',pattern:'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'},modes:['light']});
  expect(slot('assets.pattern').contract).toEqual({kind:'asset',valueKind:'rules',members:{mode:'closed',names:['dots','lines','grid']},modes:['light']});
  const media=catalog.placements.find(p=>p.layer==='assets')!.nodes.find(n=>n.id==='imagery') as {label:string;children:{id:string;label:string;leaves:string[]}[]};
  expect(media.label).toBe('Media');
  expect(media.children.map(f=>[f.id,f.label,f.leaves])).toEqual([['imagery-framing','Framing',['assets.image-ratio']],['imagery-resources','Resources',['assets.image','assets.video']],['imagery-patterns','Patterns',['assets.pattern']]]);
 });
 it('stores the Foundry pattern fill exactly as its importer builds it from the shared recipes, tokens only',()=>{
  const [fill]=importPatterns();
  expect(readFileSync(new URL('../catalog/fills/foundry/assets.pattern.json',import.meta.url),'utf8')).toBe(stableStringify(fill));
  expect(catalog.fills.find(f=>f.$extensions['com.clossys.fill'].id==='foundry/assets.pattern')).toEqual(fill);
  expect(Object.fromEntries(Object.entries(flatten(fill!)).map(([id,token])=>[id.slice('assets.pattern.'.length),token.$value]))).toEqual(PATTERN_RECIPES);
  for(const recipe of Object.values(PATTERN_RECIPES))for(const ref of [recipe.ink,recipe.weight,recipe.tile])expect(ref).toMatch(/^--[a-z][a-z0-9-]*$/);
  expect(Object.keys(PATTERN_RECIPES)).toEqual(['dots','lines','grid']);
 });
 const a10=(library:LibraryData,subject:string)=>checkAssetProfile(catalog,library).filter(f=>f.code==='A10'&&f.subject===subject);
 const authored=(slot:string,value:unknown)=>authorMediaResources(catalog,base(),{slot:slot as 'assets.image',resources:{sample:value as never},source:'Consumer media brief',rationale:'Check'});
 it('requires the photo|illustration kind facet, a source, real dimensions and alt or decorative on every image',()=>{
  expect(a10(authored('assets.image',IMAGE),'assets.image.sample').map(f=>f.verdict)).toEqual(['satisfied']);
  expect(a10(authored('assets.image',{...IMAGE,kind:'photo',alt:undefined,decorative:true}),'assets.image.sample').map(f=>f.verdict)).toEqual(['satisfied']);
  for(const bad of [{...IMAGE,kind:undefined},{...IMAGE,kind:'icon'},{...IMAGE,src:''},{...IMAGE,width:0},{...IMAGE,alt:'  '}])expect(a10(authored('assets.image',bad),'assets.image.sample').map(f=>f.verdict),JSON.stringify(bad)).toEqual(['violated']);
 });
 it('requires a playable video source, dimensions and an explicit reduced-motion policy; captions are associated, not a leaf',()=>{
  expect(a10(authored('assets.video',VIDEO),'assets.video.sample').map(f=>f.verdict)).toEqual(['satisfied']);
  for(const bad of [{...VIDEO,reducedMotion:undefined},{...VIDEO,reducedMotion:'autoplay'},{...VIDEO,mediaType:'image/gif'},{...VIDEO,height:-1},{...VIDEO,captions:{src:'',srclang:'en',label:'English'}}])expect(a10(authored('assets.video',bad),'assets.video.sample').map(f=>f.verdict),JSON.stringify(bad)).toEqual(['violated']);
 });
 it('accepts only token-referencing pattern recipes whose shape is the member',()=>{
  const adopted=applyLibraryChange(catalog,base(),{baseHash:libraryHash(base()),changes:[{op:'adopt',slot:'assets.pattern',source:'foundry'}]});
  expect(['dots','lines','grid'].map(name=>a10(adopted,`assets.pattern.${name}`).map(f=>f.verdict))).toEqual([['satisfied'],['satisfied'],['satisfied']]);
  const library=base();
  for(const bad of [{...PATTERN_RECIPES.dots,shape:'grid'},{...PATTERN_RECIPES.dots,ink:'#cccccc'},{...PATTERN_RECIPES.dots,tile:'24px'}]){
   const changed=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:'author',slot:'assets.pattern',tokens:{dots:{$type:'rules',$value:bad},lines:{$type:'rules',$value:PATTERN_RECIPES.lines},grid:{$type:'rules',$value:PATTERN_RECIPES.grid}}}]});
   expect(a10(changed,'assets.pattern.dots').map(f=>f.verdict),JSON.stringify(bad)).toEqual(['violated']);
  }
 });
 it('refuses media authoring without a source, rationale or resources, and invalid member names',()=>{
  expect(()=>authorMediaResources(catalog,base(),{slot:'assets.image',resources:{},source:'s',rationale:'r'})).toThrow();
  expect(()=>authorMediaResources(catalog,base(),{slot:'assets.image',resources:{hero:IMAGE as never},source:' ',rationale:'r'})).toThrow();
  expect(()=>authorMediaResources(catalog,base(),{slot:'assets.image',resources:{'Hero Shot':IMAGE as never},source:'s',rationale:'r'})).toThrow();
 });
});
describe('binary and opacity contracts',()=>{
 it('round-trips an optional authored raster object and uses its exact PNG32 bytes',async()=>{const bytes=await sharp({create:{width:32,height:32,channels:4,background:'#ff0000'}}).png().toBuffer();const prior=identity();const library=applyLibraryChange(catalog,prior,{baseHash:libraryHash(prior),changes:[{op:'author',slot:'assets.favicon',tokens:{small:{$type:'raster',$value:{mediaType:'image/png',data:bytes.toString('base64'),width:32,height:32}}}}]});expect(check({catalog,library}).findings.filter(f=>f.severity==='error'&&f.subject==='assets.favicon.small')).toEqual([]);const files=await emitWebIcons(resolve({catalog,library}),{name:'Example',rasterize:async(svg,size)=>new Uint8Array(await sharp(Buffer.from(svg)).resize(size,size).png().toBuffer())});expect(files.find(f=>f.path==='favicon-32.png')!.bytes).toEqual(new Uint8Array(bytes));const pixels=await sharp(files.find(f=>f.path==='favicon-32.png')!.bytes).raw().toBuffer();expect([...pixels.slice(0,4)]).toEqual([255,0,0,255]);});
 it('decodes real standard transparent corners and full-bleed maskable opaque pixels',async()=>{const files=await emitWebIcons(resolve({catalog,library:identity()}),{name:'Example',rasterize:async(svg,size)=>new Uint8Array(await sharp(Buffer.from(svg)).resize(size,size).png().toBuffer())});const standard=await sharp(files.find(f=>f.path==='icon-512.png')!.bytes).ensureAlpha().raw().toBuffer();const mask=await sharp(files.find(f=>f.path==='maskable-512.png')!.bytes).ensureAlpha().raw().toBuffer();expect(standard[3]).toBe(0);for(let i=3;i<mask.length;i+=4)expect(mask[i]).toBe(255);const background=[...mask.slice(0,3)];for(let y=0;y<512;y++)for(let x=0;x<512;x++){const offset=(y*512+x)*4;if(mask[offset]!==background[0]||mask[offset+1]!==background[1]||mask[offset+2]!==background[2])expect(Math.hypot(x-256,y-256)).toBeLessThanOrEqual(204.8);}},20000);
 it.each(['fill="#2255aa80"','fill="oklch(0.5 0.1 240 / 0.1)"','fill="rgba(30,40,50,0.1)"','fill="#2255aa" opacity="0.2"','fill="#2255aa" fill-opacity="0.2"'])('refuses translucent maskable backdrops %s',paint=>{const library=identity();const resolved=resolve({catalog,library});const member=resolved.members['assets.app-icon.maskable']!;member.value.light=(member.value.light as string).replace('fill="#111111"',paint);expect(checkAssetProfile(catalog,library,{resolved}).some(f=>f.code==='A8'&&f.verdict==='violated')).toBe(true);});
});

describe('explicit A5 logotype contrast exemption',()=>{
 const extension='com.clossys.contrast-exemption';
 const low='<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z" fill="#fafafa"/></svg>';
 function sample(exemption?:unknown,paint=low):LibraryData {
  const library=base();
  const token={$type:'svg',$value:paint,$extensions:exemption===undefined?{}:{[extension]:exemption}} as DtcgToken;
  return applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:'author',slot:'assets.mark',tokens:{positive:token,reversed:{$type:'svg',$value:low.replace('#fafafa','#111111')}}}]});
 }
 const a5=(library:LibraryData)=>checkAssetProfile(catalog,library).filter(f=>f.code==='A5'&&f.subject==='assets.mark.positive');
 it('records low contrast as a distinct visible exemption in both asset and engine output',()=>{
  expect(a5(sample())).toEqual([{code:'A5',subject:'assets.mark.positive',verdict:'violated',message:'Minimum contrast 1.04:1'}]);
  const library=sample({kind:'logotype',reason:'  Original lettering retained  '});
  expect(a5(library)).toEqual([{code:'A5',subject:'assets.mark.positive',verdict:'exempt',message:'exempt: logotype, Original lettering retained'}]);
  expect(check({catalog,library}).findings.filter(f=>f.code==='A5'&&f.subject==='assets.mark.positive')).toEqual([{code:'A5',rule:'asset',subject:'assets.mark.positive',severity:'notice',message:'exempt: logotype, Original lettering retained'}]);
 });
 it.each([{kind:'logotype'},{kind:'logotype',reason:''},{kind:'logotype',reason:'  '},{kind:'icon',reason:'Brand artwork'},null])('fails invalid explicit metadata even when paint passes: %j',exemption=>{
  const findings=a5(sample(exemption,low.replace('#fafafa','#111111')));
  expect(findings).toEqual([expect.objectContaining({verdict:'violated',message:expect.stringContaining('Invalid A5 contrast exemption')})]);
  expect(check({catalog,library:sample(exemption)}).findings).toContainEqual(expect.objectContaining({code:'A5',subject:'assets.mark.positive',severity:'error'}));
 });
 it('refuses logotype metadata on a glyph and does not carry exemptions to other members',()=>{
  let library=sample({kind:'logotype',reason:'Original lettering retained'});
  library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:'author',slot:'assets.icon-check',tokens:{default:{$type:'glyph',$value:[['path',{d:'M2 2h20'}]],$extensions:{'com.clossys.contrast-exemption':{kind:'logotype',reason:'Not a logotype'}}}}}]});
  expect(checkAssetProfile(catalog,library)).toContainEqual(expect.objectContaining({code:'A5',subject:'assets.icon-check.default',verdict:'violated',message:expect.stringContaining('only logo contrast assets')}));
 });
 it('leaves other assets and every non-A5 rule unchanged',()=>{
  const before=sample(),after=sample({kind:'logotype',reason:'Original lettering retained'});
  expect(checkAssetProfile(catalog,after).filter(f=>f.code!=='A5'||f.subject!=='assets.mark.positive')).toEqual(checkAssetProfile(catalog,before).filter(f=>f.code!=='A5'||f.subject!=='assets.mark.positive'));
  expect(checkAssetProfile(catalog,after)).toContainEqual(expect.objectContaining({code:'A5',subject:'assets.mark.reversed',verdict:'violated'}));
  const bad=sample({kind:'logotype',reason:'Original lettering retained'},low.replace('<path','<path onclick="go()"'));
  expect(checkAssetProfile(catalog,bad)).toContainEqual(expect.objectContaining({code:'A2',subject:'assets.mark.positive',verdict:'violated'}));
  expect(check({catalog,library:bad}).findings).toContainEqual(expect.objectContaining({code:'A2',subject:'assets.mark.positive',severity:'error'}));
 });
 it('preserves member metadata through native fill parsing and selected resolution',()=>{
  const library=sample({kind:'logotype',reason:'Original lettering retained'});
  const fill=library.fills.find(f=>f.$extensions['com.clossys.fill'].slot==='assets.mark')!;
  const parsed=parseFill(JSON.parse(JSON.stringify(fill)));
  expect(parsed.findings).toEqual([]);
  expect(flatten(parsed.fill!)['assets.mark.positive']!.$extensions?.[extension]).toEqual({kind:'logotype',reason:'Original lettering retained'});
  const roundtrip={...library,fills:library.fills.map(f=>f===fill?parsed.fill!:f)};
  const resolved=resolve({catalog,library:roundtrip});
  expect(checkAssetProfile(catalog,roundtrip,{resolved}).filter(f=>f.code==='A5'&&f.subject==='assets.mark.positive')).toEqual(a5(library));
  expect(a5(roundtrip)[0]!.verdict).toBe('exempt');
  const foreign={...resolved,members:{...resolved.members,'assets.mark.positive':{...resolved.members['assets.mark.positive']!,source:'other-source'}}};
  expect(checkAssetProfile(catalog,roundtrip,{resolved:foreign})).toContainEqual(expect.objectContaining({code:'A5',subject:'assets.mark.positive',verdict:'violated'}));
 });

});
