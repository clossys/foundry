import { validateIdentityTokenInput, type IdentityTokenInput } from "./identity-kit.js";
/** A geometry feature that cannot be measured is never replaced with a guessed box. */
export class MarkGeometryError extends Error {
  constructor(readonly feature: string) {
    super(`Cannot measure SVG feature: ${feature}`);
    this.name = "MarkGeometryError";
  }
}
export interface MarkBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface MarkGeometry {
  viewBox: MarkBox;
  plate: {
    present: boolean;
    radiusShare: number | null;
    radiusYShare: number | null;
  };
  /** Painted bounds, as shares of the plate (or the viewBox when no plate exists). */
  glyphBox: MarkBox;
  centreOffset: {
    x: number;
    y: number;
  };
  declaredClearSpace: number | null;
}
export interface NormalizeMarkInput {
  glyphSvg: string;
  /** Omit for the token accent plate; false produces a transparent mark. */
  plate?: boolean;
  tokens: IdentityTokenInput;
  optical?: boolean;
}
export interface MarkConformanceFinding {
  rule: "radius" | "inset" | "centre" | "clear-space" | "lockup-gap" | "wordmark-size";
  measured: number | null;
  expected: number;
}
type Point = [
  number,
  number
];
type Matrix = [
  number,
  number,
  number,
  number,
  number,
  number
];
type Attrs = Record<string, string>;
interface LiteralPaint {
  css: string;
  visible: boolean;
}
type Paint = LiteralPaint | 'currentColor';
interface Presentation {
  attrs: Attrs;
  fill?: Paint;
  stroke?: Paint;
  color?: LiteralPaint;
}
interface ComputedPaint {
  attrs: Attrs;
  fill: LiteralPaint;
  stroke: LiteralPaint;
}
interface Node {
  name: string;
  attrs: Attrs;
  children: Node[];
  start: number;
  openEnd: number;
  end: number;
}
interface Contour {
  points: Point[];
  closed: boolean;
}
const paintKeys = ['color', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule'];
const measuredAttributes = new Set([
  ...paintKeys, 'viewBox', 'width', 'height', 'x', 'y', 'rx', 'ry', 'cx', 'cy', 'r', 'points', 'd',
  'transform', 'style', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'role', 'id',
]);
const identity: Matrix = [1, 0, 0, 1, 0, 0];
const fail = (feature: string): never => { throw new MarkGeometryError(feature); };
interface GeometryBudget { generated: number; work: number }
function reserveGeometry(budget: GeometryBudget, count: number): void {
  budget.generated += count;
  if (budget.generated > 100000) fail('generated geometry complexity');
}
function reserveWork(budget: GeometryBudget, count: number): void {
  budget.work += count;
  if (budget.work > 2000000) fail('paint work complexity');
}
const svgSpace = String.raw`\x09\x0a\x0d\x20`;
const isSvgSpace = (code: number): boolean => code === 9 || code === 10 || code === 13 || code === 32;
function trimSvg(value: string, endOnly = false): string {
  let start = 0, end = value.length;
  if (!endOnly)
    while (start < end && isSvgSpace(value.charCodeAt(start))) start++;
  while (end > start && isSvgSpace(value.charCodeAt(end - 1))) end--;
  return value.slice(start, end);
}
const svgSeparators = new RegExp(`[${svgSpace},]`, 'g');
const svgTagName = new RegExp(`^/?([a-zA-Z][^${svgSpace}/>]*)`);
const svgAttribute = new RegExp(`[${svgSpace}]+([^${svgSpace}=]+)[${svgSpace}]*=[${svgSpace}]*(?:"([^"]*)"|'([^']*)')`, 'y');
const svgTransform = new RegExp(`([a-zA-Z]+)[${svgSpace}]*\\(([^)]*)\\)`, 'g');
const numPattern = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
function decodeAttribute(value: string): string {
  const entity = /&(#x[\dA-Fa-f]+|#\d+|amp|lt|gt|quot|apos);/g;
  if (value.replace(entity, '').includes('&')) return fail('XML entity');
  return value.replace(entity, (_match, name: string) => {
    if (name[0] !== '#') return name === 'amp' ? '&' : name === 'lt' ? '<' : name === 'gt' ? '>' : name === 'quot' ? '"' : "'";
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    if (!Number.isInteger(code) || (code < 0x20 && ![9, 10, 13].includes(code)) || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) return fail('XML entity');
    return String.fromCodePoint(code);
  });
}
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Point, s: number): Point => [a[0] * s, a[1] * s];
const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0];
const point = (m: Matrix, p: Point): Point => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
function product(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function numbers(value: string): number[] {
  if (value.replace(numPattern, "").replace(svgSeparators, ""))
    return fail(value);
  const result = (value.match(numPattern) ?? []).map(Number);
  if (!result.every(Number.isFinite))
    return fail(value);
  return result;
}
function number(attrs: Attrs, key: string, fallback = 0): number {
  if (attrs[key] === undefined)
    return fallback;
  const values = numbers(attrs[key]);
  return values.length === 1 ? values[0]! : fail(key);
}
function transform(value = ""): Matrix {
  let result = identity, consumed = 0;
  for (const match of value.matchAll(svgTransform)) {
    if (trimSvg(value.slice(consumed, match.index)).replace(/,/g, ""))
      fail("transform");
    const name = match[1]!, v = numbers(match[2]!);
    let next: Matrix;
    if (name === "translate" && (v.length === 1 || v.length === 2))
      next = [1, 0, 0, 1, v[0]!, v[1] ?? 0];
    else if (name === "scale" && (v.length === 1 || v.length === 2))
      next = [v[0]!, 0, 0, v[1] ?? v[0]!, 0, 0];
    else if (name === "rotate" && (v.length === 1 || v.length === 3)) {
      const radians = v[0]! * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians), x = v[1] ?? 0, y = v[2] ?? 0;
      next = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
    }
    else
      return fail(name);
    result = product(result, next);
    consumed = match.index! + match[0].length;
  }
  if (trimSvg(value.slice(consumed)))
    fail("transform");
  return result;
}
function parse(svg: string, lockupText = false): Node {
  if (/[\x0b\x0c]/.test(svg)) fail('XML whitespace');
  const stack: Node[] = [], roots: Node[] = [];
  let end = 0;
  while (end < svg.length) {
    const start = svg.indexOf('<', end);
    if (start < 0)
      break;
    if (trimSvg(svg.slice(end, start)) && !(lockupText && stack[stack.length - 1]?.name === "text"))
      fail("XML content");
    if (svg.startsWith('<!--', start)) {
      const close = svg.indexOf('-->', start + 4);
      if (close < 0)
        fail("XML comment");
      end = close + 3;
      continue;
    }
    // Advance once through each tag; delimiters inside quoted attributes are data.
    let cursor = start + 1, quote = '';
    for (; cursor < svg.length; cursor++) {
      const char = svg[cursor]!;
      if (quote) {
        if (char === quote)
          quote = '';
      }
      else if (char === '"' || char === "'")
        quote = char;
      else if (char === '>')
        break;
      else if (char === '<')
        fail("XML tag");
    }
    if (cursor === svg.length)
      fail("XML tag");
    end = cursor + 1;
    const tag = svg.slice(start + 1, cursor), closing = tag.startsWith('/');
    const nameMatch = svgTagName.exec(tag);
    if (!nameMatch)
      fail("XML tag");
    const name = nameMatch![1]!;
    if (closing) {
      const node = stack.pop();
      if (!node || node.name !== name || trimSvg(tag.slice(name.length + 1)))
        fail("XML nesting");
      node!.end = end;
      continue;
    }
    if (!["svg", "g", "rect", "circle", "ellipse", "polygon", "path"].includes(name) && !(lockupText && name === "text"))
      fail(name);
    const attrs: Attrs = {};
    const selfClosing = tag.endsWith('/'), content = trimSvg(selfClosing ? tag.slice(0, -1) : tag, true);
    const attribute = svgAttribute;
    let position = name.length;
    while (position < content.length) {
      attribute.lastIndex = position;
      const attr = attribute.exec(content);
      if (!attr || attrs[attr[1]!] !== undefined)
        fail("XML attribute");
      const key = attr![1]!;
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(key)) fail(`XML attribute ${key}`);
      if (lockupText && ['dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'writing-mode', 'direction'].includes(key)) fail('lockup text positioning');
      if (key !== 'viewBox' && /[A-Z]/.test(key)) fail(`attribute ${key}`);
      if (/^on/i.test(attr![1]!)) fail(`event attribute ${attr![1]}`);
      if (key === 'xmlns') {
        if (stack.length || roots.length || decodeAttribute(attr![2] ?? attr![3]!) !== 'http://www.w3.org/2000/svg') fail('attribute xmlns');
      } else if (!measuredAttributes.has(key) && !/^(?:data|aria)-[a-z0-9_.-]+$/.test(key)) fail(`attribute ${key}`);
      attrs[attr![1]!] = decodeAttribute(attr![2] ?? attr![3]!);
      position = attribute.lastIndex;
    }
    const node: Node = { name, attrs, children: [], start, openEnd: end, end };
    (stack.length ? stack[stack.length - 1]!.children : roots).push(node);
    if (!selfClosing) {
      if (stack.length >= 64) fail('nesting depth');
      stack.push(node);
    }
  }
  if (stack.length || trimSvg(svg.slice(end)) || roots.length !== 1 || roots[0]!.name !== "svg")
    fail("svg document");
  return roots[0]!;
}
function bounds(points: Point[]): MarkBox {
  if (!points.length)
    return fail("empty glyph");
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) {
    if (!p.every(Number.isFinite))
      fail('numeric overflow');
    x = Math.min(x, p[0]);
    y = Math.min(y, p[1]);
    right = Math.max(right, p[0]);
    bottom = Math.max(bottom, p[1]);
  }
  const box = { x, y, width: right - x, height: bottom - y };
  if (!Object.values(box).every(Number.isFinite))
    fail('numeric overflow');
  return box;
}
// Curves are flattened adaptively to one millionth of the source canvas.
// Bounds and area are computed from that geometry, never from control-point boxes.
function cubic(a: Point, b: Point, c: Point, d: Point, tolerance: number, out: Point[], budget: GeometryBudget, depth = 0): void {
  const chord = sub(d, a), length = Math.hypot(...chord);
  const distance = (p: Point) => length ? Math.abs(cross(sub(p, a), chord)) / length : Math.hypot(...sub(p, a));
  const polygonLength = Math.hypot(...sub(b, a)) + Math.hypot(...sub(c, b)) + Math.hypot(...sub(d, c));
  if (Math.max(distance(b), distance(c), polygonLength - length) <= tolerance) {
    reserveGeometry(budget, 1);
    out.push(d);
    return;
  }
  if (depth > 24)
    return fail("curve precision");
  const ab = mul(add(a, b), .5), bc = mul(add(b, c), .5), cd = mul(add(c, d), .5), abc = mul(add(ab, bc), .5), bcd = mul(add(bc, cd), .5), mid = mul(add(abc, bcd), .5);
  cubic(a, ab, abc, mid, tolerance, out, budget, depth + 1);
  cubic(mid, bcd, cd, d, tolerance, out, budget, depth + 1);
}
function arc(a: Point, v: number[], end: Point, tolerance: number, out: Point[], budget: GeometryBudget): void {
  let rx = Math.abs(v[0]!), ry = Math.abs(v[1]!);
  const phi = v[2]! * Math.PI / 180, large = v[3]!, sweep = v[4]!;
  if (![0, 1].includes(large) || ![0, 1].includes(sweep))
    fail("arc flags");
  if (!rx || !ry) {
    reserveGeometry(budget, 1);
    out.push(end);
    return;
  }
  if (a[0] === end[0] && a[1] === end[1])
    return;
  const c = Math.cos(phi), s = Math.sin(phi), dx = (a[0] - end[0]) / 2, dy = (a[1] - end[1]) / 2;
  const x = c * dx + s * dy, y = -s * dx + c * dy, lambda = x * x / (rx * rx) + y * y / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x) / (rx * rx * y * y + ry * ry * x * x)));
  const cx = factor * rx * y / ry, cy = -factor * ry * x / rx;
  const centre: Point = [c * cx - s * cy + (a[0] + end[0]) / 2, s * cx + c * cy + (a[1] + end[1]) / 2];
  const start = Math.atan2((y - cy) / ry, (x - cx) / rx);
  let delta = Math.atan2((-y - cy) / ry, (-x - cx) / rx) - start;
  if (sweep && delta < 0)
    delta += 2 * Math.PI;
  if (!sweep && delta > 0)
    delta -= 2 * Math.PI;
  const count = Math.max(1, Math.ceil(Math.abs(delta) / (2 * Math.acos(Math.max(-1, 1 - tolerance / Math.max(rx, ry))))));
  if (![rx, ry, phi, x, y, lambda, factor, cx, cy, ...centre, start, delta, count].every(Number.isFinite))
    fail("arc numeric overflow");
  if (count > 100000)
    fail("arc complexity");
  reserveGeometry(budget, count);
  for (let i = 1; i <= count; i++) {
    const theta = start + delta * i / count, ex = rx * Math.cos(theta), ey = ry * Math.sin(theta);
    out.push(i === count ? end : [centre[0] + c * ex - s * ey, centre[1] + s * ex + c * ey]);
  }
}
function path(data: string, tolerance: number, budget: GeometryBudget): Contour[] {
  const tokens = data.match(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
  if (data.replace(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g, "").replace(svgSeparators, ""))
    fail("path data");
  let i = 0, command = "", previous = "", at: Point = [0, 0], start: Point = [0, 0], control: Point = [0, 0];
  const contours: Contour[] = [];
  let current: Contour | undefined;
  const arities: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i]!))
      command = tokens[i++]!;
    const upper = command.toUpperCase(), relative = command !== upper;
    if (upper === "Z") {
      if (!current)
        fail("path Z");
      current!.closed = true;
      at = start;
      previous = "Z";
      command = "";
      continue;
    }
    const arity = arities[upper] ?? 0;
    if (!arity || (upper !== "M" && !current))
      fail(`path ${command || "command"}`);
    const v: number[] = [];
    for (let index = 0; index < arity; index++) {
      const token = tokens[i];
      if (upper === 'A' && (index === 3 || index === 4) && token && /^[01]/.test(token)) {
        v.push(Number(token[0]));
        if (token.length === 1)
          i++;
        else
          tokens[i] = token.slice(1);
      }
      else {
        v.push(Number(token));
        i++;
      }
    }
    if (!v.every(Number.isFinite))
      fail(`path ${command}`);
    if (current?.closed && upper !== 'M') {
      reserveGeometry(budget, 1);
      current = { points: [at], closed: false };
      contours.push(current);
    }
    const pair = (offset: number): Point => add([v[offset]!, v[offset + 1]!], relative ? at : [0, 0]);
    let end: Point;
    if (upper === "M") {
      at = pair(0);
      start = at;
      reserveGeometry(budget, 1);
      current = { points: [at], closed: false };
      contours.push(current);
      command = relative ? "l" : "L";
    }
    else if (upper === "L" || upper === "H" || upper === "V") {
      end = upper === "L" ? pair(0) : upper === "H" ? [v[0]! + (relative ? at[0] : 0), at[1]] : [at[0], v[0]! + (relative ? at[1] : 0)];
      reserveGeometry(budget, 1);
      current!.points.push(end);
      at = end;
    }
    else if (upper === "C" || upper === "S") {
      const first = upper === "C" ? pair(0) : (/[CS]/.test(previous) ? sub(mul(at, 2), control) : at);
      const second = pair(upper === "C" ? 2 : 0);
      end = pair(upper === "C" ? 4 : 2);
      cubic(at, first, second, end, tolerance, current!.points, budget);
      control = second;
      at = end;
    }
    else if (upper === "Q" || upper === "T") {
      const middle = upper === "Q" ? pair(0) : (/[QT]/.test(previous) ? sub(mul(at, 2), control) : at);
      end = pair(upper === "Q" ? 2 : 0);
      cubic(at, add(at, mul(sub(middle, at), 2 / 3)), add(end, mul(sub(middle, end), 2 / 3)), end, tolerance, current!.points, budget);
      control = middle;
      at = end;
    }
    else {
      end = pair(5);
      arc(at, v, end, tolerance, current!.points, budget);
      at = end;
    }
    previous = upper;
  }
  return contours;
}
function ellipse(cx: number, cy: number, rx: number, ry: number, tolerance: number, budget: GeometryBudget): Contour {
  const count = Math.max(16, 4 * Math.ceil(Math.PI / (4 * Math.acos(Math.max(-1, 1 - tolerance / Math.max(rx, ry))))));
  if (!Number.isFinite(count) || count > 100000)
    return fail("ellipse complexity");
  reserveGeometry(budget, count);
  return { closed: true, points: Array.from({ length: count }, (_, i) => [cx + rx * Math.cos(i * 2 * Math.PI / count), cy + ry * Math.sin(i * 2 * Math.PI / count)] as Point) };
}
function contours(node: Node, tolerance: number, budget: GeometryBudget): Contour[] {
  const a = node.attrs, n = (key: string, fallback = 0) => number(a, key, fallback);
  switch (node.name) {
    case "path": return path(a.d ?? "", tolerance, budget);
    case "circle":
    case "ellipse": {
      const rx = n(node.name === "circle" ? "r" : "rx"), ry = node.name === "circle" ? rx : n("ry");
      if (rx <= 0 || ry <= 0)
        return fail(node.name);
      return [ellipse(n("cx"), n("cy"), rx, ry, tolerance, budget)];
    }
    case "rect": {
      const x = n("x"), y = n("y"), w = n("width"), h = n("height");
      if (w <= 0 || h <= 0)
        return fail("rect size");
      const rx = Math.min(n("rx", n("ry")), w / 2), ry = Math.min(n("ry", n("rx")), h / 2);
      if (rx < 0 || ry < 0)
        return fail("rect radius");
      if (!rx || !ry) {
        reserveGeometry(budget, 4);
        return [{ closed: true, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] }];
      }
      return path(`M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`, tolerance, budget);
    }
    case "polygon": {
      const v = numbers(a.points ?? "");
      if (v.length < 6 || v.length % 2)
        return fail("polygon points");
      reserveGeometry(budget, v.length / 2);
      return [{ closed: true, points: Array.from({ length: v.length / 2 }, (_, i) => [v[2 * i]!, v[2 * i + 1]!] as Point) }];
    }
    default: return fail(node.name);
  }
}
// Stroke outlines are constructed in local coordinates before the full affine
// transform. This preserves nonuniform scales, joins, and endpoint cap extents.
interface Region {
  contours: Point[][];
  evenOdd?: boolean;
}
function stroke(contour: Contour, width: number, a: Attrs, tolerance: number, budget: GeometryBudget): Region[] {
  const p = contour.points.filter((v, i, all) => !i || Math.hypot(...sub(v, all[i - 1]!)) > 1e-12);
  if (p.length > 1 && Math.hypot(...sub(p[0]!, p[p.length - 1]!)) < 1e-12)
    p.pop();
  const radius = width / 2, out: Region[] = [], count = contour.closed ? p.length : p.length - 1;
  const cap = a['stroke-linecap'] ?? 'butt', join = a['stroke-linejoin'] ?? 'miter', limit = number(a, 'stroke-miterlimit', 4);
  if (!['butt', 'round', 'square'].includes(cap))
    fail(`stroke-linecap ${cap}`);
  if (!['miter', 'round', 'bevel'].includes(join))
    fail(`stroke-linejoin ${join}`);
  const emit = (points: Point[]) => {
    reserveGeometry(budget, points.length);
    out.push({ contours: [points] });
  };
  // Bound a drawn zero-length segment before constructing its directions.
  if (p.length === 1 && contour.points.length > 1) {
    const [x, y] = p[0]!;
    if (cap === 'square') emit([[x - radius, y - radius], [x + radius, y - radius], [x + radius, y + radius], [x - radius, y + radius]]);
    if (cap === 'round') emit(ellipse(x, y, radius, radius, tolerance, budget).points);
    return out;
  }
  const directions: Point[] = [], normals: Point[] = [];
  for (let i = 0; i < count; i++) {
    const next = p[(i + 1) % p.length]!, d = sub(next, p[i]!), length = Math.hypot(...d), unit = mul(d, 1 / length), normal: Point = [-unit[1] * radius, unit[0] * radius];
    directions.push(unit);
    normals.push(normal);
    emit([add(p[i]!, normal), add(next, normal), sub(next, normal), sub(p[i]!, normal)]);
  }
  for (let i = 0; i < p.length; i++) {
    const prev = (i - 1 + count) % count, next = i % count, endpoint = !contour.closed && (i === 0 || i === p.length - 1);
    if (endpoint && cap === 'round')
      emit(ellipse(p[i]![0], p[i]![1], radius, radius, tolerance, budget).points);
    if (endpoint && cap === 'square' && count) {
      const j = i === 0 ? 0 : count - 1, extended = add(p[i]!, mul(directions[j]!, i === 0 ? -radius : radius)), n = normals[j]!;
      emit([add(p[i]!, n), add(extended, n), sub(extended, n), sub(p[i]!, n)]);
    }
    if (!endpoint && count)
      for (const sign of [-1, 1]) {
        const n1 = mul(normals[prev]!, sign), n2 = mul(normals[next]!, sign), d1 = directions[prev]!, d2 = directions[next]!, denominator = cross(d1, d2);
        emit([p[i]!, add(p[i]!, n1), add(p[i]!, n2)]);
        if (join === 'round' && sign * denominator < 0) {
          const start = Math.atan2(n1[1], n1[0]);
          let delta = Math.atan2(n2[1], n2[0]) - start;
          if (denominator > 0 && delta < 0)
            delta += 2 * Math.PI;
          if (denominator < 0 && delta > 0)
            delta -= 2 * Math.PI;
          const steps = Math.max(1, Math.ceil(Math.abs(delta) / (2 * Math.acos(Math.max(-1, 1 - tolerance / radius)))));
          if (!Number.isFinite(steps) || steps > 100000) fail('round join complexity');
          reserveGeometry(budget, steps + 2);
          const sector: Point[] = [p[i]!];
          for (let j = 0; j <= steps; j++)
            sector.push(add(p[i]!, [radius * Math.cos(start + delta * j / steps), radius * Math.sin(start + delta * j / steps)]));
          emit(sector);
        }
        if (join === 'miter' && Math.abs(denominator) > 1e-12) {
          const offset = add(n1, mul(d1, cross(sub(n2, n1), d2) / denominator));
          if (Math.hypot(...offset) <= radius * limit)
            emit([add(p[i]!, n1), add(p[i]!, offset), add(p[i]!, n2)]);
        }
      }
  }
  return out;
}
// Integrate the painted union with 4096 horizontal strips. Per-shape winding
// handles holes; merging spans counts overlapping paint only once. The strip
// height bounds vertical sampling precision to 1/4096 of the painted height.
function areaCentroid(regions: Region[], box: MarkBox): Point {
  const pointCount = regions.reduce((sum, region) => sum + region.contours.reduce((count, contour) => count + contour.length, 0), 0);
  if (pointCount * 4096 > 20000000) fail('centroid complexity');
  let area = 0, momentX = 0, momentY = 0;
  const edges = regions.map(region => ({ evenOdd: region.evenOdd, edges: region.contours.flatMap(points => points.flatMap((p, i) => {
      const q = points[(i + 1) % points.length]!;
      return p[1] === q[1] ? [] : [{ p, q, low: Math.min(p[1], q[1]), high: Math.max(p[1], q[1]) }];
    })) }));
  for (let row = 0; row < 4096; row++) {
    const y = box.y + (row + .5) * box.height / 4096, spans: Point[] = [];
    for (const region of edges) {
      const crossings: Point[] = [];
      for (const e of region.edges)
        if (y >= e.low && y < e.high)
          crossings.push([e.p[0] + (y - e.p[1]) * (e.q[0] - e.p[0]) / (e.q[1] - e.p[1]), e.q[1] > e.p[1] ? 1 : -1]);
      crossings.sort((a, b) => a[0] - b[0]);
      let winding = 0, start = 0;
      for (const crossing of crossings) {
        const active = region.evenOdd ? Math.abs(winding) % 2 !== 0 : winding !== 0;
        winding += crossing[1];
        const next = region.evenOdd ? Math.abs(winding) % 2 !== 0 : winding !== 0;
        if (!active && next)
          start = crossing[0];
        if (active && !next)
          spans.push([start, crossing[0]]);
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    let left = 0, right = 0;
    const accumulate = () => { const width = right - left; area += width; momentX += width * (left + right) / 2; momentY += width * y; };
    for (const span of spans) {
      if (span[0] > right) {
        accumulate();
        left = span[0];
        right = span[1];
      }
      else if (right === left) {
        left = span[0];
        right = span[1];
      }
      else
        right = Math.max(right, span[1]);
    }
    accumulate();
  }
  return area ? [momentX / area, momentY / area] : [box.x + box.width / 2, box.y + box.height / 2];
}
interface Analysis {
  geometry: MarkGeometry;
  box: MarkBox;
  centroid: Point;
  root: Node;
  plate?: Node;
  paints: Map<Node, ComputedPaint>;
  rootColor?: LiteralPaint;
}
// Split scan bands at edge crossings, then bound only intervals whose winding
// actually paints. Separate SVG shapes remain separate regions, never holes.
function paintedBoundary(region: Region, budget: GeometryBudget): Point[] {
  const points = region.contours.flat();
  if (!points.length) return [];
  bounds(points); // Preserve the finite-coordinate refusal before comparisons.
  if (region.contours.length === 1 && !region.evenOdd) {
    let direction = 0, convex = true;
    for (let i = 0; i < points.length; i++) {
      const turn = Math.sign(cross(sub(points[(i + 1) % points.length]!, points[i]!), sub(points[(i + 2) % points.length]!, points[(i + 1) % points.length]!)));
      if (turn && direction && turn !== direction) { convex = false; break; }
      direction ||= turn;
    }
    if (convex && direction) return points;
  }
  const edges = region.contours.flatMap(contour => contour.flatMap((p, i) => {
    const q = contour[(i + 1) % contour.length]!;
    return p[1] === q[1] ? [] : [{ p, q, low: Math.min(p[1], q[1]), high: Math.max(p[1], q[1]), slope: (q[0] - p[0]) / (q[1] - p[1]) }];
  }));
  const levels = [...new Set(edges.flatMap(edge => [edge.low, edge.high]))].sort((a, b) => a - b);
  reserveWork(budget, edges.length + levels.length);
  type Edge = typeof edges[number];
  const starts = new Map<number, Edge[]>(), ends = new Map<number, Edge[]>();
  for (const edge of edges) {
    const starting = starts.get(edge.low) ?? [], ending = ends.get(edge.high) ?? [];
    starting.push(edge); ending.push(edge);
    starts.set(edge.low, starting);
    ends.set(edge.high, ending);
  }
  const active = new Set<Edge>(), result: Point[] = [];
  const x = (edge: Edge, y: number) => edge.p[0] + (y - edge.p[1]) * edge.slope;
  let bands = 0;
  for (let level = 0; level + 1 < levels.length; level++) {
    for (const edge of ends.get(levels[level]!) ?? []) active.delete(edge);
    for (const edge of starts.get(levels[level]!) ?? []) active.add(edge);
    const pending: Point[] = [[levels[level]!, levels[level + 1]!]];
    while (pending.length) {
      if (++bands > 100000) return fail('paint complexity');
      reserveWork(budget, 16 * active.size * Math.max(1, Math.log2(active.size)));
      const [low, high] = pending.pop()!, middle = low + (high - low) / 2;
      const ordered = [...active].sort((a, b) => x(a, middle) - x(b, middle));
      let split = false;
      for (let i = 1; i < ordered.length; i++) {
        const a = ordered[i - 1]!, b = ordered[i]!, difference = a.slope - b.slope;
        const intersection = middle + (x(b, middle) - x(a, middle)) / difference;
        if (difference && intersection > low && intersection < high) {
          pending.push([low, intersection], [intersection, high]); split = true; break;
        }
      }
      if (split) continue;
      let winding = 0, left: Edge | undefined;
      for (let i = 0; i < ordered.length;) {
        const edge = ordered[i]!, at = x(edge, middle), wasPainted = region.evenOdd ? Math.abs(winding) % 2 !== 0 : winding !== 0;
        do { const crossing = ordered[i++]!; winding += crossing.q[1] > crossing.p[1] ? 1 : -1; }
        while (i < ordered.length && Math.abs(x(ordered[i]!, middle) - at) <= Number.EPSILON * 16 * Math.max(Math.abs(at), Math.abs(x(ordered[i]!, middle))));
        const isPainted = region.evenOdd ? Math.abs(winding) % 2 !== 0 : winding !== 0;
        if (!wasPainted && isPainted) left = edge;
        if (wasPainted && !isPainted && left && at > x(left, middle)) {
          reserveGeometry(budget, 4);
          result.push([x(left, low), low], [x(left, high), high], [x(edge, low), low], [x(edge, high), high]);
        }
      }
    }
  }
  return result;
}
// Closed paint syntax: hex 3/4/6/8; numeric rgb/hsl/hwb/lab/lch/oklab/oklch;
// numeric color(srgb ...); transparent/none; internally resolved currentColor.
// Named colors, angle units, relative/context colors and the full CSS cascade are unsupported.
function parsePaint(value: string, allowNone = true): Paint {
  if (value.length > 4096) fail('paint complexity');
  if (/[^\x09\x0a\x0c\x0d\x20-\x7e]/.test(value)) fail('paint syntax');
  const paint = value.trim().toLowerCase();
  if (/url\s*\(|\\/.test(paint)) fail('paint reference');
  if (paint === 'context-fill' || paint === 'context-stroke') fail('context paint');
  if (paint === 'currentcolor') return 'currentColor';
  if (paint === 'none') return allowNone ? { css: 'none', visible: false } : fail('color none');
  if (paint === 'transparent') return { css: paint, visible: false };
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/.test(paint))
    return { css: paint, visible: paint.length === 5 ? paint[4] !== '0' : paint.length !== 9 || paint.slice(-2) !== '00' };
  const fn = /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)$/.exec(paint);
  if (!fn) return fail('paint syntax');
  const name = fn[1]!, body = fn[2]!.trim(), comma = body.includes(',');
  const args = name === 'color' ? body.replace(/^srgb\s+/, '') : body;
  if (name === 'color' && args === body) fail('paint color space');
  let channels: string[], alpha: string | undefined;
  if (comma) {
    if (!/^(rgb|rgba|hsl|hsla)$/.test(name) || args.includes('/')) fail('paint syntax');
    const fields = args.split(',').map(field => field.trim());
    if (fields.length !== 3 && fields.length !== 4) fail('paint arity');
    channels = fields.slice(0, 3); alpha = fields[3];
  } else {
    const fields = args.split('/');
    if (fields.length > 2) fail('paint arity');
    channels = fields[0]!.trim().split(/\s+/); alpha = fields[1]?.trim();
  }
  const values = [...channels, ...(alpha === undefined ? [] : [alpha])];
  if (channels.length !== 3 || values.some(field => !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?%?$/.test(field) || !Number.isFinite(Number(field.replace(/%$/, ''))))) fail('paint arity');
  if (/^(hsl|hsla|hwb)$/.test(name) && (channels[0]!.endsWith('%') || !channels[1]!.endsWith('%') || !channels[2]!.endsWith('%'))) fail('paint channels');
  if (/^(lch|oklch)$/.test(name) && channels[2]!.endsWith('%')) fail('paint hue');
  if (comma && /^rgba?$/.test(name) && channels.some(field => field.endsWith('%')) && !channels.every(field => field.endsWith('%'))) fail('paint channels');
  const opacity = alpha === undefined ? 1 : Number(alpha.replace(/%$/, '')) / (alpha.endsWith('%') ? 100 : 1);
  return { css: paint, visible: opacity > 0 };
}
function effectivePaint(paint: Paint | undefined, color: LiteralPaint | undefined, fallback: string): LiteralPaint {
  const specified = paint ?? parsePaint(fallback);
  return specified === 'currentColor' ? color ?? fail('ambient currentColor') : specified;
}
function presentation(node: Node, inherited: Presentation): Presentation {
  const attrs = { ...node.attrs };
  for (const key of paintKeys)
    if (attrs[key] === undefined && inherited.attrs[key] !== undefined) attrs[key] = inherited.attrs[key]!;
  if (attrs.style) {
    if (/!|\/\*|\*\/|[^\x09\x0a\x0c\x0d\x20-\x7e]/.test(attrs.style)) fail('style syntax');
    for (const declaration of attrs.style.split(';').map(value => value.trim()).filter(Boolean)) {
      const split = declaration.indexOf(':'), key = declaration.slice(0, split).trim(), value = declaration.slice(split + 1).trim();
      if (!['color', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit'].includes(key))
        fail(`style ${key}`);
      attrs[key] = value;
    }
    delete attrs.style;
  }
  if (paintKeys.some(key => (attrs[key]?.length ?? 0) > 4096)) fail('paint complexity');
  // Concrete paint and currentColor are supported; full CSS cascade resolution is not.
  // Check the effective inline value so a supported override can replace a keyword attribute.
  const cssWidePaint = ['inherit', 'unset', 'initial', 'revert', 'revert-layer'];
  if (['fill', 'stroke', 'color'].some(key => cssWidePaint.includes(attrs[key]?.trim().toLowerCase() ?? '')))
    fail('CSS-wide paint keyword');
  const color = attrs.color === undefined ? undefined : parsePaint(attrs.color, false);
  return {
    attrs,
    fill: attrs.fill === undefined ? undefined : parsePaint(attrs.fill),
    stroke: attrs.stroke === undefined ? undefined : parsePaint(attrs.stroke),
    color: color === 'currentColor' || color === undefined ? inherited.color : color,
  };
}
function hasFillArea(points: Point[]): boolean {
  const first = points[0], second = points.find(p => first && (p[0] !== first[0] || p[1] !== first[1]));
  return !!first && !!second && points.some(p => cross(sub(second, first), sub(p, first)) !== 0);
}
function analyze(svg: string, optical = false, glyphFill?: string): Analysis {
  const root = parse(svg), v = numbers(root.attrs.viewBox ?? "");
  if (v.length !== 4 || v[2]! <= 0 || v[3]! <= 0)
    return fail("viewBox");
  const viewBox: MarkBox = { x: v[0]!, y: v[1]!, width: v[2]!, height: v[3]! };
  const candidate = root.children[0];
  const rootPresentation = presentation(root, { attrs: {} });
  const candidatePresentation = candidate ? presentation(candidate, rootPresentation) : undefined;
  const plate = root.children.length > 1 && !root.attrs.transform && candidate?.name === 'rect' && !candidate.attrs.transform && number(candidate.attrs, 'x') === viewBox.x && number(candidate.attrs, 'y') === viewBox.y && number(candidate.attrs, 'width') === viewBox.height && number(candidate.attrs, 'height') === viewBox.height && effectivePaint(candidatePresentation!.fill, candidatePresentation!.color, '#000').visible ? candidate : undefined;
  const frame = plate ? { ...viewBox, width: viewBox.height } : viewBox;
  const tolerance = Math.max(viewBox.width, viewBox.height) * 1e-6;
  const budget: GeometryBudget = { generated: 0, work: 0 };
  const regions: Region[] = [];
  const paints = new Map<Node, ComputedPaint>();
  const visit = (node: Node, m: Matrix, inherited: Presentation): void => {
    const resolved = presentation(node, inherited), a = resolved.attrs;
    if (a['fill-rule'] && !['nonzero', 'evenodd'].includes(a['fill-rule']))
      fail('fill-rule');
    const matrix = product(m, transform(node.attrs.transform));
    if (node.name === 'svg' || node.name === 'g') {
      if (node.name === 'svg' && node !== root) fail('nested svg');
      for (const child of node.children) visit(child, matrix, resolved);
      return;
    }
    let fill = effectivePaint(resolved.fill, resolved.color, '#000');
    const strokePaint = effectivePaint(resolved.stroke, resolved.color, 'none');
    if (node === plate) {
      paints.set(node, { attrs: a, fill, stroke: strokePaint });
      if (node.children.length || number(a, 'rx', number(a, 'ry')) < 0 || number(a, 'ry', number(a, 'rx')) < 0)
        fail('plate geometry');
      return;
    }
    if (node.children.length)
      fail(node.name);
    const localTolerance = tolerance / Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]), 1);
    const shape = contours(node, localTolerance, budget);
    if (glyphFill !== undefined && resolved.fill === undefined)
      fill = shape.some(contour => hasFillArea(contour.points)) ? effectivePaint(undefined, resolved.color, glyphFill) : { css: 'none', visible: false };
    paints.set(node, { attrs: a, fill, stroke: strokePaint });
    if (glyphFill !== undefined && resolved.fill === undefined && !fill.visible && shape.some(contour => hasFillArea(contour.points))) fail('generated glyph paint');
    if (fill.visible) {
      reserveGeometry(budget, shape.reduce((sum, contour) => sum + contour.points.length, 0));
      const contours = shape.filter(c => hasFillArea(c.points)).map(c => c.points.map(p => point(matrix, p)));
      regions.push({ contours, evenOdd: a['fill-rule'] === 'evenodd' });
    }
    if (strokePaint.visible) {
      const width = number(a, 'stroke-width', 1);
      if (width < 0)
        fail('stroke-width');
      if (width)
        for (const contour of shape)
          for (const region of stroke(contour, width, a, localTolerance, budget)) {
            reserveGeometry(budget, region.contours.reduce((sum, contour) => sum + contour.length, 0));
            const transformed = { contours: region.contours.map(c => c.map(p => point(matrix, p))) };
            regions.push(transformed);
          }
    }
  };
  visit(root, identity, { attrs: {} });
  const box = bounds(regions.flatMap(region => paintedBoundary(region, budget))), centre: Point = [box.x + box.width / 2, box.y + box.height / 2];
  const glyphBox = { x: (box.x - frame.x) / frame.width, y: (box.y - frame.y) / frame.height, width: box.width / frame.width, height: box.height / frame.height };
  if (![...centre, ...Object.values(glyphBox)].every(Number.isFinite))
    fail('numeric overflow');
  return { root, plate, paints, rootColor: rootPresentation.color, box, centroid: optical ? areaCentroid(regions, box) : centre, geometry: { viewBox, plate: { present: !!plate, radiusShare: plate ? Math.min(number(plate.attrs, 'rx', number(plate.attrs, 'ry')), frame.width / 2) / frame.width : null, radiusYShare: plate ? Math.min(number(plate.attrs, 'ry', number(plate.attrs, 'rx')), frame.height / 2) / frame.height : null }, glyphBox, centreOffset: { x: glyphBox.x + glyphBox.width / 2 - .5, y: glyphBox.y + glyphBox.height / 2 - .5 }, declaredClearSpace: root.attrs['data-clear-space'] === undefined ? null : number(root.attrs, 'data-clear-space') } };
}
/** Measure supported SVG paint geometry without a DOM, fonts, or external resources. */
export function measureMarkGeometry(svg: string): MarkGeometry { return analyze(svg).geometry; }
const clampVector = (vector: Point, limit: number): Point => mul(vector, Math.min(1, limit / Math.hypot(...vector)));
const format = (n: number): string => Number.isFinite(n) ? String(Number(n.toPrecision(12))) : fail('numeric overflow');
const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** Fit painted glyph bounds into the kit's 18% inset, preserving aspect. */
export function normalizeMark(input: NormalizeMarkInput): string {
  validateIdentityTokenInput(input.tokens);
  const measured = analyze(input.glyphSvg, input.optical, input.tokens.onAccent), b = measured.box, inset = .18, side = 48;
  if (!b.width || !b.height)
    return fail('zero-area glyph bounds');
  const scale = side * (1 - 2 * inset) / Math.max(b.width, b.height);
  const centre: Point = [b.x + b.width / 2, b.y + b.height / 2];
  const correction: Point = input.optical ? clampVector(mul(sub(centre, measured.centroid), scale), side * .03) : [0, 0];
  const shift = (axis: 0 | 1) => correction[axis];
  const tx = side / 2 - centre[0] * scale + shift(0), ty = side / 2 - centre[1] * scale + shift(1);
  const root = measured.root;
  const attributesOf = (attrs: Attrs) => Object.entries(attrs).map(([key, value]) => ` ${key}="${escape(value)}"`).join('');
  const render = (node: Node): string => {
    const attrs: Attrs = Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== 'style' && !paintKeys.includes(key)));
    if (node.name === 'g') return `<g${attributesOf(attrs)}>${node.children.map(render).join('')}</g>`;
    const resolved = measured.paints.get(node)!;
    for (const key of paintKeys) if (!['fill', 'stroke', 'color'].includes(key) && resolved.attrs[key] !== undefined) attrs[key] = resolved.attrs[key]!;
    attrs.fill = resolved.fill.css;
    attrs.stroke = resolved.stroke.css;
    return `<${node.name}${attributesOf(attrs)}/>`;
  };
  const body = root.children.filter(node => node !== measured.plate).map(render).join('');
  const rootMetadata = attributesOf(Object.fromEntries(Object.entries(root.attrs).filter(([key]) => ['role', 'aria-label'].includes(key))));
  const attributes = attributesOf(Object.fromEntries(Object.entries(root.attrs).filter(([key]) => !['xmlns', 'viewBox', 'width', 'height', 'data-clear-space', 'style', 'role', 'aria-label', ...paintKeys].includes(key))));
  const accent = input.plate === false ? undefined : effectivePaint(parsePaint(input.tokens.accent), measured.rootColor, '#000');
  if (accent && !accent.visible) fail('generated plate paint');
  const plate = accent ? `<rect width="48" height="48" rx="10.5" fill="${escape(accent.css)}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" data-clear-space="0.2"${rootMetadata}${input.optical ? ' data-optical-centering="true"' : ''}>${plate}<g transform="translate(${format(tx)} ${format(ty)}) scale(${format(scale)})"><g${attributes}>${body}</g></g></svg>`;
}
/** Ordered violations. Live lockup text contributes position/font size, never an outline box. */
export function checkMarkConformance(svg: string): MarkConformanceFinding[] {
  const root = parse(svg, true), texts = root.children.filter(node => node.name === "text");
  const countText = (node: Node): number => (node.name === "text" ? 1 : 0) + node.children.reduce((sum, child) => sum + countText(child), 0);
  if (texts.length > 1 || countText(root) !== texts.length || (texts.length && root.attrs.transform))
    fail('lockup text positioning');
  const wordmark = texts[0];
  const glyph = wordmark ? svg.slice(0, wordmark.start) + svg.slice(wordmark.end) : svg;
  const analysis = analyze(glyph, root.attrs["data-optical-centering"] === "true"), geometry = analysis.geometry, findings: MarkConformanceFinding[] = [];
  const tolerance = .005;
  const check = (rule: MarkConformanceFinding['rule'], measured: number | null, expected: number, allowed = tolerance) => {
    if (measured === null || Math.abs(measured - expected) > allowed)
      findings.push({ rule, measured, expected });
  };
  check('radius', Math.abs((geometry.plate.radiusYShare ?? 0) - 7 / 32) > Math.abs((geometry.plate.radiusShare ?? 0) - 7 / 32) ? geometry.plate.radiusYShare : geometry.plate.radiusShare, 7 / 32);
  check('inset', Math.max(geometry.glyphBox.width, geometry.glyphBox.height), .64);
  const boxCentre: Point = [analysis.box.x + analysis.box.width / 2, analysis.box.y + analysis.box.height / 2];
  const expectedShift: Point = root.attrs["data-optical-centering"] === "true" ? clampVector(mul(sub(boxCentre, analysis.centroid), 1 / geometry.viewBox.height), .03) : [0, 0];
  const opticalShift = (axis: 0 | 1) => expectedShift[axis];
  check('centre', Math.max(Math.abs(geometry.centreOffset.x - opticalShift(0)), Math.abs(geometry.centreOffset.y - opticalShift(1))), 0);
  check('clear-space', geometry.declaredClearSpace, .2);
  if (texts.length) {
    const attrs = wordmark!.attrs;
    if (attrs.transform || attrs.style || attrs['text-anchor'] && attrs['text-anchor'] !== 'start' || root.attrs['text-anchor'] && root.attrs['text-anchor'] !== 'start' || ['dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'writing-mode', 'direction'].some(key => attrs[key] !== undefined || root.attrs[key] !== undefined))
      fail('lockup text positioning');
    const side = geometry.viewBox.height;
    check('lockup-gap', (number(attrs, 'x') - geometry.viewBox.x - side) / side, 8 / 48);
    check('wordmark-size', attrs['font-size'] === undefined ? null : number(attrs, 'font-size') / side, 22 / 48);
  }
  return findings;
}
