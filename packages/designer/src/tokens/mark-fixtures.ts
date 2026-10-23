/** Synthetic geometry examples; no supplied artwork is bundled. */
const wrap = (glyph: string, radius = 21.875): string => `<svg viewBox="0 0 100 100" data-clear-space="0.2"><rect width="100" height="100" rx="${radius}" fill="#fff"/>${glyph}</svg>`;
export const MARK_FIXTURES = {
  small: wrap('<rect x="30" y="30" width="40" height="40"/>'),
  oversized: wrap('<rect x="5" y="5" width="90" height="90"/>'),
  offCentre: wrap('<rect x="8" y="21" width="64" height="64"/>'),
  wrongRadius: wrap('<rect x="18" y="18" width="64" height="64"/>', 24),
  rotatedArms: wrap('<g transform="rotate(45 50 50)"><rect x="40" y="20" width="20" height="60"/><rect x="20" y="40" width="60" height="20"/></g>'),
  strokeOnly: wrap('<circle cx="50" cy="50" r="20" fill="none" stroke="#000" stroke-width="10"/>'),
  relativePath: wrap('<path d="m30 35 h40 v30 h-40 z"/>'),
} as const;
