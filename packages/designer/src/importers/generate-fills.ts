/** Local token data regeneration only. Run with a TypeScript runner or the focused test. */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import slots from '../catalog/slots/tokens.json' with { type: 'json' };
import { TOKENS } from '../tokens/tokens.js';
import { stableStringify } from '../catalog-core/stable.js';
import type { Slot } from '../catalog-core/types.js';
import { leafCoverage } from './leaf-coverage.js';
import { importFoundry } from './foundry.js';
import { offeredFoundryFills } from './foundry-offered.js';
import { importTailwindDefault } from './tailwind-default.js';
import { importShadcnAria } from './shadcn-aria.js';
import { importRadixColors } from './radix-colors.js';
import { importCarbonColors } from './carbon-colors.js';
import { importLucideTokenStroke, LUCIDE_TOKEN_SOURCE } from './lucide-token-stroke.js';
const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), 'utf8');
export function generatedTokenFills() {
  const theme = readFileSync(createRequire(import.meta.url).resolve('tailwindcss/theme.css'), 'utf8');
  const historical = importFoundry({ tokens: Object.values(TOKENS), tokensCss: read('../../styles/tokens.css'), slots: slots as unknown as readonly Slot[] });
  return [
    ...offeredFoundryFills(historical, slots as unknown as readonly Slot[]),
    ...importTailwindDefault({ css: theme }),
    ...importShadcnAria({ css: read('vendor/shadcn-aria.css') }),
    ...importRadixColors({ light: read('vendor/radix/light.txt'), dark: read('vendor/radix/dark.txt') }),
    ...importCarbonColors({ colors: read('vendor/carbon/colors.js.txt'), palette: read('vendor/carbon/color-palette.scss'), grounds: { light: ['oklch(0.9702 0 0)', 'oklch(0.9401 0 0)', 'oklch(1 0 0)'], dark: ['oklch(0.19 0 0)', 'oklch(0.15 0 0)', 'oklch(0.26 0 0)'] } }),
    ...importLucideTokenStroke(LUCIDE_TOKEN_SOURCE),
  ];
}
export function generateFills(): void {
  const fills = generatedTokenFills();
  writeFileSync(resolve(here, 'token-leaf-coverage.json'), stableStringify(leafCoverage(slots as unknown as readonly Slot[], fills)));
  for (const source of new Set(fills.map(fill => fill.$extensions['com.clossys.fill'].source))) {
    const directory = source === 'shadcn@aria' ? 'shadcn-aria' : source;
    const dir = resolve(here, '../catalog/fills', directory);
    mkdirSync(dir, { recursive: true });
    const group = fills.filter(fill => fill.$extensions['com.clossys.fill'].source === source);
    const expected = new Set(group.map(fill => fill.$extensions['com.clossys.fill'].slot + '.json'));
    // Only token cells are owned here; asset fills and their generator are independent.
    for (const file of readdirSync(dir)) if (file.startsWith('tokens.') && file.endsWith('.json') && !expected.has(file)) unlinkSync(resolve(dir, file));
    for (const fill of group) writeFileSync(resolve(dir, fill.$extensions['com.clossys.fill'].slot + '.json'), stableStringify(fill));
  }
}
