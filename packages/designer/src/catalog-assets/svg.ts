/** A deliberately small SVG grammar. It validates before preview, recolouring or rasterization. */
export class AssetValidationError extends Error {}
export interface SvgElement { tag: string; attrs: Readonly<Record<string,string>>; depth: number }
const TAGS = new Set(['svg','g','path','circle','rect','line','polyline','polygon','ellipse','text','tspan','title','desc','defs','mask']);
const ATTRS = new Set(['xmlns','viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','d','points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-rule','clip-rule','opacity','fill-opacity','stroke-opacity','transform','color','font-family','font-size','font-weight','font-style','font-stretch','letter-spacing','text-anchor','dominant-baseline','role','aria-label','aria-hidden','data-clear-space','id','mask','maskUnits']);
const COLOR = /^(?:#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})|(?:rgb|rgba|hsl|hsla|oklch)\([\d.,% /+eE-]+\)|none|transparent|currentColor|black|white)$/;
export function safeColor(value: string): string { if (!COLOR.test(value)) throw new AssetValidationError('unsupported colour literal'); return value; }
export function escapeXml(text: string): string { return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function entities(text: string): void { if (/&(?!amp;|lt;|gt;|quot;|apos;)/.test(text)) throw new AssetValidationError('unsupported entity'); }
export function inspectSvg(svg: string, options: { favicon?: boolean; maxBytes?: number; maxDepth?: number } = {}): readonly SvgElement[] {
 if (new TextEncoder().encode(svg).length > (options.maxBytes ?? 262144)) throw new AssetValidationError('SVG size cap exceeded');
 if (/<!|<\?|\u0000/.test(svg)) throw new AssetValidationError('SVG declarations, comments and entities are forbidden');
 const elements: SvgElement[] = []; const stack: string[] = []; let offset=0; let styles=0; let roots=0;
 while(offset < svg.length) {
  const start=svg.indexOf('<',offset); const text=svg.slice(offset,start<0?svg.length:start); entities(text);
  if (text.trim() && !['text','tspan','title','desc'].includes(stack.at(-1) ?? '')) throw new AssetValidationError('unexpected SVG text');
  if(start<0) { offset=svg.length; break; }
  const end=svg.indexOf('>',start); if(end<0) throw new AssetValidationError('unclosed SVG tag');
  const raw=svg.slice(start+1,end); offset=end+1;
  if(raw.startsWith('/')) { const tag=raw.slice(1).trim(); if(!/^[a-z]+$/.test(tag)||stack.pop()!==tag) throw new AssetValidationError('unbalanced SVG tag'); continue; }
  const match=/^([a-z][a-zA-Z0-9]*)([\s\S]*?)(\/?)$/.exec(raw); if(!match) throw new AssetValidationError('invalid SVG tag');
  const tag=match[1]!; const attrs: Record<string,string>={}; let rest=match[2]!;
  if(tag==='style') {
   if(!options.favicon || stack.length!==1 || styles++ || rest.trim() || match[3]) throw new AssetValidationError('style is only allowed once in a favicon');
   const close=svg.indexOf('</style>',offset); if(close<0) throw new AssetValidationError('unclosed favicon style');
   const style=svg.slice(offset,close); const rule=/^@media \(prefers-color-scheme: dark\)\{svg\{color:([^{};]+)(?:;fill:([^{};]+))?\}\}$/.exec(style);
   if(!rule) throw new AssetValidationError('unsupported favicon style'); safeColor(rule[1]!); if(rule[2]!==undefined) safeColor(rule[2]); offset=close+8; continue;
  }
  if(!TAGS.has(tag)) throw new AssetValidationError(`forbidden SVG element ${tag}`);
  while(rest.trim()) {
   const attr=/^\s+([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/.exec(rest); if(!attr) throw new AssetValidationError('invalid SVG attribute');
   const name=attr[1]!, value=attr[2]??attr[3]??''; rest=rest.slice(attr[0].length);
   if(!ATTRS.has(name)||Object.hasOwn(attrs,name)) throw new AssetValidationError(`forbidden or duplicate SVG attribute ${name}`);
   entities(value); if(/[\u0000-\u001f]/.test(value)) throw new AssetValidationError('control character in SVG');
   if(name==='xmlns'&&value!=='http://www.w3.org/2000/svg') throw new AssetValidationError('foreign namespace');
   if(['fill','stroke','color'].includes(name)) safeColor(value);
   if(name==='mask'&&!/^url\(#[a-zA-Z][\w-]*\)$/.test(value)) throw new AssetValidationError('external mask');
   if(name!=='mask'&&/(?:url\s*\(|javascript:|data:|https?:|\/\/)/i.test(value)&&name!=='xmlns') throw new AssetValidationError('external SVG resource');
   if(name==='id'&&!/^[a-zA-Z][\w-]*$/.test(value)) throw new AssetValidationError('invalid SVG id');
   attrs[name]=value;
  }
  if(!stack.length) { if(tag!=='svg'||roots++) throw new AssetValidationError('one SVG root required'); }
  if(stack.length && tag==='svg' && !attrs.viewBox) throw new AssetValidationError('nested SVG requires viewBox');
  elements.push({tag,attrs,depth:stack.length}); if(elements.length>2000) throw new AssetValidationError('SVG element cap exceeded');
  if(!match[3]) stack.push(tag); if(stack.length>(options.maxDepth??32)) throw new AssetValidationError('SVG depth cap exceeded');
 }
 if(stack.length||roots!==1) throw new AssetValidationError('incomplete SVG document');
 const box=elements[0]?.attrs.viewBox?.trim().split(/[ ,]+/).map(Number); if(!box||box.length!==4||box.some(n=>!Number.isFinite(n))||box[2]!<=0||box[3]!<=0) throw new AssetValidationError('positive SVG viewBox required');
 const ids=elements.filter(e=>e.attrs.id).map(e=>e.attrs.id); if(new Set(ids).size!==ids.length) throw new AssetValidationError('duplicate SVG ids');
 for(const element of elements) if(element.attrs.mask&&!ids.includes(element.attrs.mask.slice(5,-1))) throw new AssetValidationError('unresolved SVG mask');
 return elements;
}
export function svgBody(svg: string): string { inspectSvg(svg); return svg.trim().replace(/^<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,''); }
export function svgViewBox(svg: string): string { return inspectSvg(svg)[0]!.attrs.viewBox!; }
/** The shell owns paint, except exact 256→24 Phosphor solid dot circles. */
export function inspectGlyph(value: unknown): void {
 if(!Array.isArray(value)||!value.length||value.length>256) throw new AssetValidationError('glyph must contain geometry');
 const geometry: Record<string,readonly string[]>={path:['d'],circle:['cx','cy','r'],rect:['x','y','width','height','rx','ry'],line:['x1','x2','y1','y2'],polyline:['points'],polygon:['points'],ellipse:['cx','cy','rx','ry']};
 for(const node of value) {
  if(!Array.isArray(node)||node.length!==2||!geometry[node[0]]||!node[1]||typeof node[1]!=='object'||Array.isArray(node[1])) throw new AssetValidationError('invalid glyph geometry');
  const attrs = node[1] as Record<string,unknown>;
  const dot = node[0] === 'circle' && attrs.r === '1.125' && attrs.fill === 'currentColor' && attrs.stroke === 'none' && ['cx','cy'].every(key => typeof attrs[key] === 'string' && /^[\d.]+$/.test(attrs[key] as string) && Number(attrs[key]) >= 1.125 && Number(attrs[key]) <= 22.875);
  for(const [key,val] of Object.entries(node[1])) { if(dot && (key === 'fill' || key === 'stroke')) continue; if(key!=='key'&&!geometry[node[0]]!.includes(key)) throw new AssetValidationError(`glyph paint or attribute ${key} is forbidden`); if(typeof val!=='string'||/[<>&"']/.test(val)) throw new AssetValidationError('invalid glyph value'); if(key==='d'&&!/^[MmLlHhVvCcSsQqTtAaZz\d.,\s+eE-]+$/.test(val)) throw new AssetValidationError('invalid SVG path'); if(key!=='key'&&key!=='d'&&!/^[\d.,\s+eE-]+$/.test(val)) throw new AssetValidationError('invalid glyph number'); }
 }
}
export function glyphSvg(value: unknown, size=24, stroke=2): string {
 inspectGlyph(value); if(![16,24,32].includes(size)||stroke<1.5||stroke>2.5) throw new AssetValidationError('unsupported glyph size or stroke');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${(value as [string,Record<string,string>][]).map(([tag,attrs])=>`<${tag} ${Object.entries(attrs).filter(([key])=>key!=='key').map(([key,val])=>`${key}="${val}"`).join(' ')}/>`).join('')}</svg>`;
}
