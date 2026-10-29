/** Value shapes of the Media resource leaves; dependency-free so specimens and checks share one definition. */
const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
const size=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Explicit playback policy when the viewer prefers reduced motion: show the poster frame, or start paused. */
export const VIDEO_REDUCED_MOTION=Object.freeze(['poster','paused'] as const);
export interface ImageSource { media: string; src: string; width: number; height: number }
export interface ImageResource {
 kind: 'photo'|'illustration'|'share'; src: string; width: number; height: number;
 alt?: string; decorative?: boolean;
 /** Ordered picture sources; the resource src remains the required fallback. */
 sources?: readonly ImageSource[];
 sizes?: string;
 /** Normalized coordinates, measured from the top-start corner. */
 focal?: { x: number; y: number };
 /** Color or pre-blurred still shown underneath the resource while it loads. */
 placeholder?: { kind: 'color'|'blur'; value: string };
}
export interface VideoResource{src:string;mediaType:string;width:number;height:number;reducedMotion:typeof VIDEO_REDUCED_MOTION[number];poster?:string;captions?:{src:string;srclang:string;label:string}}
export function isImageResource(v:unknown):v is ImageResource {
 const coordinate=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
 return object(v)&&['photo','illustration','share'].includes(v.kind as string)&&text(v.src)&&size(v.width)&&size(v.height)
  &&(text(v.alt)||v.decorative===true)
  &&(v.sources===undefined||Array.isArray(v.sources)&&v.sources.length>0&&v.sources.every(s=>object(s)&&text(s.media)&&text(s.src)&&size(s.width)&&size(s.height)))
  &&(v.sizes===undefined||text(v.sizes))
  &&(v.focal===undefined||object(v.focal)&&coordinate(v.focal.x)&&coordinate(v.focal.y))
  &&(v.placeholder===undefined||object(v.placeholder)&&(v.placeholder.kind==='color'||v.placeholder.kind==='blur')&&text(v.placeholder.value));
}
export function isVideoResource(v:unknown):v is VideoResource{return object(v)&&text(v.src)&&text(v.mediaType)&&v.mediaType.startsWith('video/')&&size(v.width)&&size(v.height)&&(VIDEO_REDUCED_MOTION as readonly unknown[]).includes(v.reducedMotion)&&(v.poster===undefined||text(v.poster))&&(v.captions===undefined||object(v.captions)&&text(v.captions.src)&&text(v.captions.srclang)&&text(v.captions.label));}
/** The Media leaves whose rules members render as their own specimen (crop ratios keep the ratio specimen). */
export type MediaLeaf = "image" | "video" | "pattern";
export function mediaLeafOf(slot: string): MediaLeaf | undefined {
  return slot === "assets.image" ? "image" : slot === "assets.video" ? "video" : slot === "assets.pattern" ? "pattern" : undefined;
}
