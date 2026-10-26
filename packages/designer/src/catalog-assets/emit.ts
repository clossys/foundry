import type { Resolved } from '../catalog-core/types.js';
import { AssetValidationError, inspectSvg, inspectGlyph } from './svg.js';
import { PHOSPHOR_NOTICES } from '../importers/phosphor-license.js';
import { LUCIDE_NOTICES } from './licenses.js';
export type AssetFile = { path: string; mediaType: string; bytes: Uint8Array };
export type RasterizeSvg = (svg: string, size: number) => Promise<Uint8Array>;
const encode=(value:string):Uint8Array=>new TextEncoder().encode(value);
function svg(profile:Resolved,id:string,favicon=false): string { const member=profile.members[id];if(!member||typeof member.value.light!=='string') throw new AssetValidationError(`missing SVG ${id}`);const text=member.value.light;inspectSvg(text,{favicon});return text; }
/** Reject truncated or mis-sized PNG responses from the renderer before any file is offered. */
export function pngDimensions(bytes:Uint8Array): {width:number;height:number} {
 const signature=[137,80,78,71,13,10,26,10];if(bytes.length<45||signature.some((v,i)=>bytes[i]!==v)) throw new AssetValidationError('rasterizer did not return PNG');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8;let dimensions: {width:number;height:number}|undefined;let data=false;let end=false;
 while(offset+12<=bytes.length) {const length=view.getUint32(offset);if(length>bytes.length-offset-12)throw new AssetValidationError('truncated PNG chunk');const tag=String.fromCharCode(...bytes.slice(offset+4,offset+8));if(offset===8&&tag!=='IHDR')throw new AssetValidationError('PNG must start with IHDR');if(tag==='IHDR'){if(dimensions||length!==13)throw new AssetValidationError('invalid PNG header');dimensions={width:view.getUint32(offset+8),height:view.getUint32(offset+12)};} if(tag==='IDAT') data=true;if(tag==='IEND'){if(length||offset+12!==bytes.length)throw new AssetValidationError('invalid PNG end');end=true;} offset+=length+12; }
 if(offset!==bytes.length||!dimensions||!data||!end||!dimensions.width||!dimensions.height)throw new AssetValidationError('incomplete PNG');return dimensions;
}
export function makeIco(png16:Uint8Array,png32:Uint8Array):Uint8Array {
 for(const [bytes,size] of [[png16,16],[png32,32]] as const){const d=pngDimensions(bytes);if(d.width!==size||d.height!==size)throw new AssetValidationError('ICO image has wrong dimensions');}
 const images=[png16,png32];const output=new Uint8Array(38+png16.length+png32.length);const v=new DataView(output.buffer);v.setUint16(2,1,true);v.setUint16(4,2,true);let pos=38;
 images.forEach((bytes,index)=>{const entry=6+index*16;output[entry]=index?32:16;output[entry+1]=index?32:16;v.setUint16(entry+4,1,true);v.setUint16(entry+6,32,true);v.setUint32(entry+8,bytes.length,true);v.setUint32(entry+12,pos,true);output.set(bytes,pos);pos+=bytes.length;});return output;
}
export function emitGlyphModule(profile:Resolved):string {
 const glyphs:Record<string,unknown>={};for(const [id,member] of Object.entries(profile.members).sort(([a],[b])=>a<b?-1:a>b?1:0))if(id.startsWith('assets.icon-')){inspectGlyph(member.value.light);glyphs[id.split('.')[1]!]=member.value.light;}
 return `// Generated from consumer-library glyph members. See asset-notices.md.\nexport const glyphs = ${JSON.stringify(glyphs,null,2)} as const;\n`;
}
export function assetNotices(profile:Resolved): string {
 const adopted=Object.entries(profile.members).filter(([id,m])=>id.startsWith('assets.')&&m.origin?.kind==='adopted').sort(([a],[b])=>a<b?-1:1);
 const authored=Object.entries(profile.members).filter(([id,m])=>id.startsWith('assets.')&&m.origin?.kind==='authored').map(([id,m])=>{const o=m.origin!;return o.kind==='authored'?`${id}: consumer authored; ${o.license}; ${o.note??''}`:'';});
 const rows=adopted.map(([id,m])=>{const o=m.origin!;if(o.kind!=='adopted')return '';return `${id}: ${o.source}; ${o.fill}; ${o.member}; ${o.license}; ${JSON.stringify(o.pin??{})}; sha256 ${o.sha256}; adopted ${o.adoptedAt}`;});
 return '# Asset notices\n\n'+[...rows,...authored].join('\n')+(adopted.some(([,m])=>m.origin?.kind==='adopted'&&m.origin.source==='lucide')?'\n\n'+LUCIDE_NOTICES:'')+(adopted.some(([,m])=>m.origin?.kind==='adopted'&&m.origin.source==='phosphor')?'\n\n'+PHOSPHOR_NOTICES:'')+'\n';
}
/** SVG/glyph emission stays pure and browser-safe. Raster output requires an explicit server port. */
export function emitIdentityFiles(profile:Resolved):AssetFile[]{
 const names: Record<string,string>={'assets.lockup.positive':'lockup-positive.svg','assets.lockup.reversed':'lockup-reversed.svg','assets.mark.positive':'mark-positive.svg','assets.mark.reversed':'mark-reversed.svg','assets.mark.mono':'mark-mono.svg'};
 return Object.entries(names).map(([id,path])=>({path,mediaType:'image/svg+xml',bytes:encode(svg(profile,id))}));
}
export async function emitWebIcons(profile:Resolved,input:{name:string;rasterize:RasterizeSvg}):Promise<AssetFile[]> {
 if(!input.name.trim()||typeof input.rasterize!=='function')throw new AssetValidationError('name and rasterizer required');
 const favicon=svg(profile,'assets.favicon.vector',true),standard=svg(profile,'assets.app-icon.standard'),maskable=svg(profile,'assets.app-icon.maskable');
 const raster=async(text:string,size:number):Promise<Uint8Array>=>{const bytes=await input.rasterize(text,size);const d=pngDimensions(bytes);if(d.width!==size||d.height!==size)throw new AssetValidationError(`rasterizer returned wrong size for ${size}`);return bytes;};
 const small=profile.members['assets.favicon.small'];let png32:Uint8Array;
 if(small){const value=small.value.light;if(!value||typeof value!=='object'||Array.isArray(value))throw new AssetValidationError('favicon.small must be a raster object');const raster=value as Record<string,unknown>;if(raster.mediaType!=='image/png'||raster.width!==32||raster.height!==32||typeof raster.data!=='string'||!raster.data||!/^[A-Za-z0-9+/]+=*$/.test(raster.data))throw new AssetValidationError('favicon.small requires PNG base64 data and 32x32 metadata');png32=Uint8Array.from(atob(raster.data),c=>c.charCodeAt(0));const d=pngDimensions(png32);if(d.width!==32||d.height!==32)throw new AssetValidationError('favicon.small must be 32x32');}else png32=await raster(favicon,32);
 const png16=await raster(favicon,16);const output:AssetFile[]=[{path:'favicon.svg',mediaType:'image/svg+xml',bytes:encode(favicon)},{path:'favicon.ico',mediaType:'image/x-icon',bytes:makeIco(png16,png32)},{path:'favicon-32.png',mediaType:'image/png',bytes:png32}];
 for(const [path,text,size] of [['apple-touch-180.png',maskable,180],['icon-192.png',standard,192],['icon-512.png',standard,512],['maskable-192.png',maskable,192],['maskable-512.png',maskable,512]] as const)output.push({path,mediaType:'image/png',bytes:await raster(text,size)});
 const surface=profile.members['tokens.surface-color.base']?.css.light;if(!surface)throw new AssetValidationError('manifest requires surface base');
 const manifest={name:input.name,short_name:input.name,display:'standalone',theme_color:surface,background_color:surface,icons:[{src:'icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'maskable-192.png',sizes:'192x192',type:'image/png',purpose:'maskable'},{src:'maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]};
 output.push({path:'site.webmanifest',mediaType:'application/manifest+json',bytes:encode(JSON.stringify(manifest,null,2)+'\n')});return output;
}
