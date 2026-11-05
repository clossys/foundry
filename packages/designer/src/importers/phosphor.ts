import type { FillDoc, Source } from '../catalog-core/types.js';
import type { IconNode } from '../icons/types.js';
import { AssetValidationError, inspectGlyph, inspectSvg } from '../catalog-assets/svg.js';
import { sourceSha256 } from './shared.js';
import raw from './phosphor-raw.json' with { type: 'json' };
import roster from './phosphor-pin.json' with { type: 'json' };
import source from '../catalog/sources/phosphor.json' with { type: 'json' };

export const PHOSPHOR_SOURCE: Source = source as Source;
const SCALE = 24 / 256;
const geometry: Record<string, readonly string[]> = {path:['d'],circle:['cx','cy','r'],rect:['x','y','width','height','rx','ry'],line:['x1','y1','x2','y2'],polyline:['points'],polygon:['points']};
const number = /^[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?$/;
function scaled(value: string): string {
  if (!number.test(value) || !Number.isFinite(Number(value))) throw new AssetValidationError('invalid Phosphor coordinate');
  return String(Number((Number(value) * SCALE).toFixed(12)));
}
/** Preserve command semantics: arc rotation and flags are dimensionless. */
export function scalePhosphorPath(path: string): string {
  const tokens = path.match(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g) ?? [];
  if (path.replace(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?|[\s,]/g, '')) throw new AssetValidationError('unsupported Phosphor path');
  const arity: Record<string, number> = {M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};
  const output: string[] = []; let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++]!; const upper = command.toUpperCase(); const count = arity[upper];
    if (count === undefined || (output.length === 0 && upper !== 'M')) throw new AssetValidationError('invalid Phosphor command');
    output.push(command);
    if (!count) continue;
    let groups = 0;
    while (index < tokens.length && number.test(tokens[index]!)) {
      const args: string[] = tokens.slice(index, index + count);
      if (args.length !== count || args.some(arg => !number.test(arg))) throw new AssetValidationError('incomplete Phosphor command');
      if (upper === 'A' && (!['0','1'].includes(args[3]!) || !['0','1'].includes(args[4]!))) throw new AssetValidationError('invalid Phosphor arc flag');
      output.push(...args.map((arg, position) => upper === 'A' && [2,3,4].includes(position) ? arg : scaled(arg)));
      index += count; groups++;
    }
    if (!groups) throw new AssetValidationError('missing Phosphor coordinates');
  }
  if (!output.length) throw new AssetValidationError('empty Phosphor path');
  return output.join(' ');
}
/** Only pinned raw/regular stroke drawings, plus their three actual solid dots. No fitting or redrawing. */
export function importPhosphorSvg(svg: string): IconNode {
  const elements = inspectSvg(svg);
  if (elements[0]!.attrs.viewBox !== '0 0 256 256' || Object.keys(elements[0]!.attrs).some(key => !['xmlns','viewBox'].includes(key))) throw new AssetValidationError('Phosphor requires raw 256-grid SVG');
  const output: [string, Record<string,string>][] = [];
  for (const {tag, attrs, depth} of elements.slice(1)) {
    if (depth !== 1 || !geometry[tag]) throw new AssetValidationError('unsupported Phosphor geometry');
    if (tag === 'rect' && JSON.stringify(attrs) === JSON.stringify({width:'256',height:'256',fill:'none'})) continue;
    // The pinned monitor's half-turn is exactly invariant on this rounded rect.
    // T(256,240) R(180) maps [32,224]×[48,192] onto itself, including its corners.
    const invariant = tag === 'rect' && attrs.transform === 'translate(256 240) rotate(180)' && attrs.x === '32' && attrs.y === '48' && attrs.width === '192' && attrs.height === '144' && attrs.rx === '16' && attrs.ry === undefined;
    if (attrs.transform && !invariant) throw new AssetValidationError('non-invariant Phosphor transform');
    const dot = tag === 'circle' && attrs.r === '12' && Object.keys(attrs).sort().join(',') === 'cx,cy,r';
    if (!dot && (attrs.stroke !== 'currentColor' || attrs['stroke-width'] !== '16' || attrs['stroke-linecap'] !== 'round' || attrs['stroke-linejoin'] !== 'round' || (attrs.fill !== undefined && attrs.fill !== 'none'))) throw new AssetValidationError('Phosphor requires regular stroke geometry');
    const converted: Record<string,string> = {};
    for (const [key,value] of Object.entries(attrs)) {
      if (geometry[tag]!.includes(key)) converted[key] = key === 'd' ? scalePhosphorPath(value) : key === 'points' ? value.trim().split(/[\s,]+/).map(scaled).join(' ') : scaled(value);
      else if (!(key === 'transform' && invariant) && !['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin'].includes(key)) throw new AssetValidationError('unsupported Phosphor attribute');
    }
    if (dot) { converted.fill = 'currentColor'; converted.stroke = 'none'; }
    output.push([tag, converted]);
  }
  inspectGlyph(output); return output;
}
export function importPhosphor(): FillDoc[] {
  return roster.map(row => {
    const text = (raw as Record<string,string>)[row.upstream]!;
    if (sourceSha256(text) !== row.pin.sha256 || row.pin.commit !== PHOSPHOR_SOURCE.pin!.commit) throw new AssetValidationError('Phosphor source pin mismatch');
    return {$extensions:{'com.clossys.fill':{id:`phosphor/${row.leaf}`,slot:row.leaf,source:'phosphor',mode:'implementation',sourceAddress:row.pin.url,relation:'same-contract',builtOn:[],conforms:[],evidence:[],author:'third-party',trust:'pinned-upstream',license:'MIT',pin:row.pin,status:'draft',reads:{themes:[],assets:[]}}},assets:{[row.leaf.slice(7)]:{default:{$type:'glyph',$value:importPhosphorSvg(text)}}}};
  });
}
