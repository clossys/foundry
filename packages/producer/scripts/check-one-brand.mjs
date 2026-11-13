#!/usr/bin/env node
/**
 * Studio wears the consumer's own brand (rule R-ONE-BRAND: Studio previews the consumer workspace
 * in the consumer brand; never greyscale).
 *
 * Over <root>/clossys, through the code Studio serves with (dist/server):
 *   theme  `studioTheme` must compile the consumer's pinned `themes.*` slots (source `consumer`).
 *          The Foundry theme (no theme pinned) and a theme error (a pin that drifted or does not
 *          compile) both fail.
 *   brand  `pinnedBrand` must resolve the workspace name, mark, favicon, app icon and lockup from
 *          the consumer's pinned `assets.*` slots, and every token value in those pins must be
 *          inline SVG, an SVG data URI or an `{{assets.<name>.<variant>}}` alias inside the same
 *          pins: a value that points at a file (a Foundry package path, a module, a URL) fails.
 *
 * Usage: node scripts/check-one-brand.mjs [--root <foundry checkout>]
 * Needs `npm run build` (reads dist). Exit 0 clean, 1 findings, 2 usage or load error.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf('--root');
if (at >= 0 && !args[at + 1]) { console.error('check-one-brand: --root needs a directory'); process.exit(2); }
const root = at >= 0 ? realpathSync(resolve(args[at + 1])) : resolve(here, '../../..');
const library = join(root, 'clossys');
if (!existsSync(join(library, 'agents'))) { console.error(`check-one-brand: no clossys/agents under ${root}`); process.exit(2); }

let studioTheme, pinnedBrand, pinnedAssetTokens, readSlotState;
try {
  ({ studioTheme } = await import('../dist/server/theme.js'));
  ({ pinnedBrand, pinnedAssetTokens } = await import('../dist/server/consumer-brand.js'));
  ({ readSlotState } = await import('../dist/records/slots.js'));
} catch { console.error('check-one-brand: build @clossys/producer first (dist/server/theme.js, dist/server/consumer-brand.js)'); process.exit(2); }

const findings = [];
const theme = await studioTheme(root);
if (theme.source !== 'consumer') {
  findings.push(theme.source === 'error'
    ? `theme [error] ${theme.message ?? 'the consumer theme did not compile'}: Studio would wear the Foundry theme`
    : 'theme [foundry] the consumer pins no themes.* slot that compiles: Studio wears the Foundry theme');
}

const ASSETS = ['mark', 'favicon', 'app-icon', 'lockup'];
const brand = pinnedBrand(library);
const resolved = { mark: brand.mark, favicon: brand.favicon, 'app-icon': brand.appIcon, lockup: brand.lockup };
if (!brand.name) findings.push('brand [name] the pinned mark or lockup carries no aria-label workspace name');
for (const name of ASSETS) {
  let state;
  try { state = readSlotState(library, 'designer', `assets.${name}`); } catch (error) { findings.push(`assets.${name} [pin] ${error instanceof Error ? error.message : String(error)}`); continue; }
  if (state.state === 'rejected') { findings.push(`assets.${name} [pin] ${state.message}`); continue; }
  if (state.state !== 'pinned') { findings.push(`assets.${name} [unpinned] the consumer marks its ${name} not needed: Studio has no consumer ${name}`); continue; }
  if (!resolved[name]) findings.push(`assets.${name} [unresolved] ${state.pin.candidate} resolves to no inline SVG (drifted bytes, no token, or unsafe SVG)`);
}

// Every token value in a pinned assets.* candidate stays inside the consumer's pins.
const ALIAS = /^\{\{assets\.[a-z0-9-]+\.[a-z0-9-]+\}\}$/;
const SVG_DATA = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/;
const inside = value => { const text = value.trim(); return text.startsWith('<svg') || ALIAS.test(text) || SVG_DATA.test(text); };
const walk = (value, path, out) => {
  // An svg token's $value, or any src/href/url/path/file inside a token's value, is a pointer.
  if (typeof value === 'string') { if (/(?:^|\.)\$value$|\.\$value\.(?:.+\.)?(?:src|href|url|path|file)$/.test(path) && !inside(value)) out.push([path, value]); return; }
  if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, `${path}.${index}`, out));
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) walk(entry, path ? `${path}.${key}` : key, out);
};
for (const name of [...ASSETS, 'image']) {
  const tokens = pinnedAssetTokens(library, name);
  if (!tokens) continue;
  const outside = [];
  walk(tokens, '', outside);
  for (const [path, value] of outside) {
    findings.push(`assets.${name} [points-outside] ${path} = ${JSON.stringify(value.slice(0, 120))} is not inline SVG, an SVG data URI or an assets alias`);
  }
}

console.log(`check-one-brand: theme ${theme.source}, brand ${brand.name ?? '(no name)'}, ${findings.length} finding(s)`);
for (const finding of findings) console.log(`  ${finding}`);
process.exit(findings.length ? 1 : 0);
