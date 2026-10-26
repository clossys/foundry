/** Value shapes of the Media resource leaves; dependency-free so specimens and checks share one definition. */
const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
const size=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Explicit playback policy when the viewer prefers reduced motion: show the poster frame, or start paused. */
export const VIDEO_REDUCED_MOTION=Object.freeze(['poster','paused'] as const);
export interface ImageResource{kind:'photo'|'illustration';src:string;width:number;height:number;alt?:string;decorative?:boolean}
export interface VideoResource{src:string;mediaType:string;width:number;height:number;reducedMotion:typeof VIDEO_REDUCED_MOTION[number];poster?:string;captions?:{src:string;srclang:string;label:string}}
export function isImageResource(v:unknown):v is ImageResource{return object(v)&&(v.kind==='photo'||v.kind==='illustration')&&text(v.src)&&size(v.width)&&size(v.height)&&(text(v.alt)||v.decorative===true);}
export function isVideoResource(v:unknown):v is VideoResource{return object(v)&&text(v.src)&&text(v.mediaType)&&v.mediaType.startsWith('video/')&&size(v.width)&&size(v.height)&&(VIDEO_REDUCED_MOTION as readonly unknown[]).includes(v.reducedMotion)&&(v.poster===undefined||text(v.poster))&&(v.captions===undefined||object(v.captions)&&text(v.captions.src)&&text(v.captions.srclang)&&text(v.captions.label));}
/** The Media leaves whose rules members render as their own specimen (crop ratios keep the ratio specimen). */
export type MediaLeaf = "image" | "video" | "pattern";
export function mediaLeafOf(slot: string): MediaLeaf | undefined {
  return slot === "assets.image" ? "image" : slot === "assets.video" ? "video" : slot === "assets.pattern" ? "pattern" : undefined;
}
