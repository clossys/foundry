/** Deterministic scatter shared by the static tile generator and future decorative renderers. */
export function fieldHash(value: number): number {
  const a = (value + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function generateDotFieldPath(): string {
  const seed = 7, cells = 18, pitch = 32, radius = 1.5, size = cells * pitch;
  const segments: string[] = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const s = seed * 1000003 + (j * cells + i) * 2;
    const x = (i + fieldHash(s) * 1.5 - 0.25) * pitch;
    const y = (j + fieldHash(s + 1) * 1.5 - 0.25) * pitch;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const X = x + ox, Y = y + oy;
      if (X >= -radius && X <= size + radius && Y >= -radius && Y <= size + radius) segments.push(`M${X.toFixed(1)} ${Y.toFixed(1)}h0`);
    }
  }
  return segments.join("");
}
