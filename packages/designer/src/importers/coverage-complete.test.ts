import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadCatalog, check, resolve, emit, applyLibraryChange, libraryHash } from '../catalog-core/index.js';
import { flatten, references, leafOf } from '../catalog-core/model.js';
import { CONTRAST_PAIRS } from '../tokens/contrast-pairs.js';
import { contrastRatio } from '../tokens/color.js';
import originalFoundryFills from '../catalog-core/__fixtures__/foundry-original-fills.json' with { type: 'json' };
import { resolveTokenValue } from '../tokens/internal/resolve-token-value.js';
import { TOKENS } from '../tokens/tokens.js';
import { parseBrandDeclarations } from '../tokens/parse-brand-declarations.js';
import { checkBrandFileCoverage } from '../tokens/check-brand-file-coverage.js';
import { importShadcnAriaComponents } from './shadcn-aria-components.js';
import { classify } from './foundry.js';
import { importBrandCss } from './brand-css.js';
import { completedTokenLibrary } from './__fixtures__/completed-token-library.js';
import { tokenCatalog } from '../catalog-core/__fixtures__/token-catalog.js';
import { leafCoverage } from './leaf-coverage.js';
import { offeredFoundryFills, RETIRED_FOUNDRY_TOKEN_LEAVES } from './foundry-offered.js';
import { importRadixColors } from './radix-colors.js';
import { importCarbonColors } from './carbon-colors.js';
import type { FillDoc, Source } from '../catalog-core/types.js';
const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(pathResolve(here, path), 'utf8');
const source: Source = { id: 'example-complete', kind: 'consumer', author: 'consumer', extends: 'foundry', license: 'UNLICENSED' };
const catalog = tokenCatalog(loadCatalog());
const library = completedTokenLibrary(catalog, source, '2026-10-23');

describe('signed token coverage decisions', () => {
  it('offers 36 Foundry leaves, two retained subsets and three noncompeting baselines', () => {
    const foundry = catalog.fills.filter(fill => fill.$extensions['com.clossys.fill'].source === 'foundry');
    const baseline = catalog.fills.filter(fill => fill.$extensions['com.clossys.fill'].source === 'foundry-baseline');
    expect(foundry).toHaveLength(38); expect(baseline).toHaveLength(3);
    expect(baseline.every(fill => fill.$extensions['com.clossys.fill'].baseline)).toBe(true);
    expect(catalog.sources.find(source => source.id === 'foundry-baseline')).toMatchObject({ baseline: true, author: 'foundry', license: 'MIT' });
    for (const leaf of RETIRED_FOUNDRY_TOKEN_LEAVES) expect(foundry.some(fill => fill.$extensions['com.clossys.fill'].slot === `tokens.${leaf}`)).toBe(false);
    for (const [leaf, expected] of [['breakpoint', ['mobile', 'mobile-lg', 'wide']], ['easing', ['bounce', 'default']], ['letter-spacing', ['label', 'meta', 'nav']]] as const) expect(Object.keys(flatten(foundry.find(fill => fill.$extensions['com.clossys.fill'].slot === `tokens.${leaf}`)!)).map(id => id.split('.').slice(2).join('.'))).toEqual(expected);
    const ids = new Set(foundry.flatMap(fill => Object.keys(flatten(fill))));
    for (const fill of foundry) for (const token of Object.values(flatten(fill))) for (const ref of references(token)) expect(ids.has(ref), ref).toBe(true);
  });
  it('preserves every retained Foundry member value after retired references are materialized', () => {
    const historical = resolve({ catalog, library: { source, fills: originalFoundryFills as unknown as FillDoc[] } });
    const completed = resolve({ catalog, library });
    const approvedChanges = new Set(['tokens.text-color.on-action', 'tokens.focus-shadow.on-inverse']);
    const ids = catalog.fills.filter(fill => ['foundry', 'foundry-baseline'].includes(fill.$extensions['com.clossys.fill'].source)).flatMap(fill => Object.keys(flatten(fill))).filter(id => !id.startsWith('tokens.action-color.') && !approvedChanges.has(id));
    for (const mode of ['light', 'dark'] as const) {
      const registry = (profile: typeof historical) => Object.fromEntries(Object.values(profile.members).filter(member => member.emit).map(member => [member.emit!, { ...TOKENS[member.emit!]!, value: member.css[mode] ?? member.css.light }]));
      for (const id of ids) {
        const property = historical.members[id]!.emit!;
        const actual = resolveTokenValue(property, registry(completed)).value!, expected = resolveTokenValue(property, registry(historical)).value!;
        expect(classify(actual, historical.members[id]!.$type as import('../catalog-core/types.js').DtcgType, property).value, id + '/' + mode).toEqual(classify(expected, historical.members[id]!.$type as import('../catalog-core/types.js').DtcgType, property).value);
      }
    }
  });
  it('materializes complete nested var fallbacks and preserves unrelated live references', () => {
    const historical = structuredClone(originalFoundryFills) as unknown as FillDoc[];
    const token = flatten(historical.find(fill => fill.$extensions['com.clossys.fill'].slot === 'tokens.density')!)['tokens.density.pad']!;
    token.$value = 'clamp(var(--spacing-sm, min(1px, 2px)), 12px, 16px)';
    token.$extensions = { 'com.clossys.css': { raw: token.$value, reads: ['tokens.spacing.sm'] }, 'com.clossys.modes': { dark: 'clamp(var(--spacing-sm, min(3px, 4px)), 14px, 18px)' } };
    const prepared = offeredFoundryFills(historical, catalog.slots);
    const adapted = flatten(prepared.find(fill => fill.$extensions['com.clossys.fill'].slot === 'tokens.density')!)['tokens.density.pad']!;
    expect(adapted.$value).toBe('clamp(8px, 12px, 16px)');
    expect(adapted.$extensions?.['com.clossys.css']).toEqual({ raw: 'clamp(8px, 12px, 16px)', reads: [] });
    expect(adapted.$extensions?.['com.clossys.modes']?.dark).toBe('clamp(8px, 14px, 18px)');
    const focus = flatten(prepared.find(fill => fill.$extensions['com.clossys.fill'].slot === 'tokens.focus-color')!);
    expect(focus['tokens.focus-color.default']!.$value).toBe('{tokens.accent-color.default}');
  });
  it('reports 53/53 candidate leaves with per-source provided members separately from consumer truth', () => {
    const report = leafCoverage(catalog.slots, catalog.fills);
    expect(report.kind).toBe('candidate-availability'); expect(report.unionFilledLeaves).toBe(53); expect(report.uncoveredLeaves).toEqual([]);
    expect(report.totals.foundry?.filledLeaves).toBe(38); expect(report.totals['foundry-baseline']?.filledLeaves).toBe(3);
    expect(report.leaves.every(leaf => Object.values(leaf.providedMembers).some(members => members.length > 0))).toBe(true);
    expect(read('token-leaf-coverage.json')).toBe(JSON.stringify(JSON.parse(read('token-leaf-coverage.json')), null, 2) + '\n');
    expect(resolve({ catalog, library: { source, fills: [] } }).members).toEqual({});
  });
  it('adopts all offered candidates plus explicit replacements into 53 consumer fills with zero errors', () => {
    const result = check({ catalog, library });
    expect(result.findings.filter(finding => finding.severity === 'error')).toEqual([]); expect(result.ok).toBe(true);
    expect(library.fills).toHaveLength(53);
    expect(library.selection?.version).toBe(2);
    const profile = resolve({ catalog, library });
    expect(Object.values(profile.members).filter(member => member.emit)).toHaveLength(223);
    const member = (id: string) => profile.members[id]!;
    expect(member('tokens.radius.default').css.light).toBe('0.25rem');
    expect(member('tokens.radius.sharp').css.light).toBe('0px'); expect(member('tokens.radius.pill').css.light).toBe('999px');
    expect(member('tokens.letter-spacing.tight').css.light).toBe('-0.025em');
    expect(member('tokens.breakpoint.mobile').css.light).toBe('375px');
    expect(member('tokens.breakpoint.tablet').css.light).toBe('48rem');
    expect(member('tokens.easing.bounce').origin?.kind).toBe('adopted');
    expect(member('tokens.icon-stroke.default').origin).toMatchObject({ source: 'lucide', license: 'ISC' });
    expect(member('tokens.diverging-color.neutral').origin).toMatchObject({ kind: 'derived', rule: 'token-diverging-neutral@1', inputs: ['tokens.border-color.base'] });
  });
  it('passes every status and categorical WCAG pair in both real modes without relief', () => {
    const profile = resolve({ catalog, library });
    const css = new Map(Object.values(profile.members).filter(member => member.emit).map(member => [member.emit!, member]));
    for (const pair of CONTRAST_PAIRS.filter(pair => /status-|categorical/.test(pair.foreground))) for (const mode of ['light', 'dark'] as const) {
      const fg = css.get(pair.foreground as `--${string}`)!, bg = css.get(pair.background as `--${string}`)!;
      const composite = pair.compositeOver?.startsWith('--') ? css.get(pair.compositeOver as `--${string}`)!.css[mode] : pair.compositeOver;
      expect(contrastRatio(fg.css[mode] ?? fg.css.light, bg.css[mode] ?? bg.css.light, composite), `${pair.id}/${mode}`).toBeGreaterThanOrEqual(pair.minimumRatio);
    }
  });
  it('also qualifies the optional Radix indigo accent against the complete library', () => {
    const indigo = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: 'adopt', slot: 'tokens.accent-color', source: 'radix-colors' }] });
    expect(check({ catalog, library: indigo }).findings.filter(finding => finding.severity === 'error')).toEqual([]);
  });
  it('rejects modified source bytes and refuses a palette unable to clear all supplied grounds', () => {
    const radix = { light: read('vendor/radix/light.txt'), dark: read('vendor/radix/dark.txt') };
    expect(() => importRadixColors({ ...radix, dark: radix.dark + '\n' })).toThrow('source bytes differ');
    const carbon = { colors: read('vendor/carbon/colors.js.txt'), palette: read('vendor/carbon/color-palette.scss'), grounds: { light: ['#888888'], dark: ['#888888'] } };
    expect(() => importCarbonColors(carbon)).toThrow('needs eight');
    expect(() => importCarbonColors({ ...carbon, colors: carbon.colors + '\n' })).toThrow('source bytes differ');
    const rule = catalog.fills.find(fill => fill.$extensions['com.clossys.fill'].source === 'carbon-colors')!.$extensions['com.clossys.fill'].derivation!.rule;
    expect(rule).toContain('1,3,4,6,7,8,12,13');
  });
  it('explicitly copies 64 neutral brand bindings as authored values with exact emit parity', () => {
    const historicalCss = read('../catalog-core/__golden__/foundry-brand.css');
    const actionValues = { "--color-action": ["#0A0A0A", "#FAFAFA"], "--color-action-hover": ["#262626", "#E5E5E5"], "--color-action-pressed": ["#404040", "#D4D4D4"], "--color-action-on-inverse": ["#FAFAFA", "#0A0A0A"], "--color-action-on-inverse-hover": ["#E5E5E5", "#262626"] };
    const neutralCss = historicalCss.replace(/(:root[^{}]*\{)([^{}]*)(\})/g, (_all, selector: string, body: string, close: string) => {
      const dark = selector.includes('dark') || selector.includes(':not(');
      const withAction = body.replace(/(^[ \t]*)--color-accent:/m, (match, indent: string) => Object.entries(actionValues).map(([property, values]) => `${indent}${property}: ${values[dark ? 1 : 0]};\n`).join("") + match);
      return selector + withAction + close;
    });
    const fills = importBrandCss({ css: neutralCss, source });
    expect(Object.values(Object.assign({}, ...fills.map(flatten)))).toHaveLength(64);
    for (const fill of fills) {
      expect(fill.$extensions['com.clossys.fill'].originKinds).toEqual(['authored']);
      for (const token of Object.values(flatten(fill))) expect(token.$extensions?.['com.clossys.origin']).toEqual({ kind: 'authored', license: 'UNLICENSED' });
    }
    const copied = { source, fills };
    const output = emit(resolve({ catalog, library: copied }), ['css-brand'], { header: false })[0]!.contents;
    expect(output).toBe(neutralCss.slice(neutralCss.indexOf('\n') + 1));
    expect(checkBrandFileCoverage(parseBrandDeclarations(output).declarations).ok).toBe(true);
    expect(Object.values(TOKENS).filter(token => token.brandable)).toHaveLength(64);
  });
});


describe('generic shadcn rewrite blocker accounting', () => {
  it('pins every remaining K-code per fill after generic bindings without implying conformance', () => {
    const fixture = pathResolve(here, '__fixtures__/shadcn-aria');
    const bytes = (name: string) => readFileSync(pathResolve(fixture, name), 'utf8');
    const result = importShadcnAriaComponents({
      items: readdirSync(fixture).filter(name => name.endsWith('.json')).map(name => JSON.parse(bytes(name))).filter(item => item.type === 'registry:ui'),
      styles: { path: 'apps/v4/registry/styles/style-nova.css', content: bytes('style-nova.css') },
      notice: { path: 'LICENSE.md', content: bytes('LICENSE.md') },
    });
    const counts = Object.fromEntries(result.fills.map(doc => {
      const fill = Object.values(doc.components)[0]!;
      const codes: Record<string, number> = {};
      for (const issue of fill.blockers) codes[issue.code] = (codes[issue.code] ?? 0) + 1;
      return [fill.slot, codes];
    }));
    expect(counts).toEqual({
      "components.avatar": {
            "K4": 7
      },
      "components.badge": {
            "K4": 7
      },
      "components.banner": {
            "K4": 4
      },
      "components.breadcrumbs": {
            "K4": 2,
            "K7": 2
      },
      "components.button": {
            "K4": 9
      },
      "components.calendar": {
            "K4": 15
      },
      "components.card": {
            "K4": 6
      },
      "components.checkbox": {
            "K4": 1
      },
      "components.combo-box": {
            "K4": 36
      },
      "components.dialog": {
            "K4": 5
      },
      "components.disclosure": {
            "K4": 4
      },
      "components.keyboard": {
            "K4": 3
      },
      "components.menu": {
            "K4": 11
      },
      "components.popover": {
            "K4": 6
      },
      "components.progress-bar": {},
      "components.radio-group": {},
      "components.select": {
            "K4": 31
      },
      "components.separator": {
            "K4": 4
      },
      "components.skeleton": {
            "K4": 1
      },
      "components.slider": {
            "K4": 4
      },
      "components.switch": {
            "K4": 6
      },
      "components.table": {
            "K4": 3
      },
      "components.tabs": {
            "K4": 16
      },
      "components.toggle-button": {
            "K4": 11
      },
      "components.toggle-group": {
            "K4": 8
      },
      "components.tooltip": {
            "K4": 6
      }
});
    expect(result.fills.reduce((total, doc) => total + Object.values(doc.components)[0]!.blockers.length, 0)).toBe(208);
    expect(result.fills.every(doc => doc.$extensions['com.clossys.fill'].status === 'draft' && doc.$extensions['com.clossys.fill'].evidence.length === 0)).toBe(true);
  });
});
