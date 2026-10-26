import type { DtcgToken, DtcgValue, FillDoc, Slot } from '../catalog-core/types.js';
import { flatten, leafOf, references, aliasOf, modeValue, cssText } from '../catalog-core/model.js';
import { stableStringify } from '../catalog-core/stable.js';
import { sourceSha256 } from './shared.js';

/** Signed coverage decisions. The historical importer remains the 49-cell parity oracle. */
export const RETIRED_FOUNDRY_TOKEN_LEAVES = ['color-ramp', 'spacing', 'radius', 'typeface', 'icon-stroke', 'sequential-color', 'diverging-color', 'status-color', 'categorical-color'] as const;
const BASELINES = new Set(['border-width', 'z-index', 'scrim-color']);
const SUBSETS: Record<string, readonly string[]> = { breakpoint: ['mobile', 'mobile-lg', 'wide'], easing: ['default', 'bounce'], 'letter-spacing': ['meta', 'nav', 'label'] };

/** Prepare explicit catalog candidates; this is never a resolver fallback. */
export function offeredFoundryFills(historical: readonly FillDoc[], slots: readonly Slot[]): FillDoc[] {
  const original = Object.assign({}, ...historical.map(flatten)) as Record<string, DtcgToken>;
  const properties = new Map<string, string>(slots.flatMap(slot => slot.contract.kind === 'token' ? Object.entries(slot.contract.emit ?? {}).map(([member, css]) => [`${slot.id}.${member}`, css] as const) : []));
  const retired = new Set(RETIRED_FOUNDRY_TOKEN_LEAVES.map(leaf => `tokens.${leaf}`));
  const historicalSha = sourceSha256(stableStringify(historical));
  const literal = (id: string, mode: 'light' | 'dark', seen: string[] = []): DtcgValue => {
    if (seen.includes(id) || !original[id]) throw new Error(`offered: invalid historical reference ${id}`);
    const value = modeValue(original[id]!, mode), target = aliasOf(value);
    return target ? literal(target, mode, [...seen, id]) : value;
  };
  const text = (id: string, mode: 'light' | 'dark'): string => cssText(original[id]!.$type, literal(id, mode), original[id], mode === 'light' || original[id]!.$extensions?.['com.clossys.modes']?.dark === undefined);
  const replaceVars = (raw: string, refs: readonly string[], mode: 'light' | 'dark'): string => {
    let result = raw;
    for (const ref of refs) {
      const property = properties.get(ref); if (!property) continue;
      for (;;) {
        const match = new RegExp('var\\(\\s*' + property + '(?=\\s*[,\\)])').exec(result);
        const start = match?.index ?? -1; if (start < 0) break;
        // Match the complete var(), including nested fallback functions.
        let depth = 1, end = start + 4;
        for (; end < result.length && depth; end++) { if (result[end] === '(') depth++; if (result[end] === ')') depth--; }
        result = result.slice(0, start) + text(ref, mode) + result.slice(end);
      }
    }
    return result;
  };
  return historical.filter(fill => !retired.has(fill.$extensions['com.clossys.fill'].slot)).map(value => {
    const fill = structuredClone(value), meta = fill.$extensions['com.clossys.fill'];
    const leaf = meta.slot.split('.')[1]!;
    const group = fill.tokens![leaf] as Record<string, DtcgToken>;
    if (SUBSETS[leaf]) { for (const member of Object.keys(group)) if (!SUBSETS[leaf]!.includes(member)) delete group[member]; meta.relation = 'subset'; }
    let adapted = false;
    for (const token of Object.values(flatten(fill))) {
      const removedRefs = references(token).filter(ref => {
        const targetLeaf = leafOf(ref).split('.')[1]!;
        return retired.has(leafOf(ref)) || (BASELINES.has(targetLeaf) !== BASELINES.has(leaf)) || !!SUBSETS[targetLeaf] && !SUBSETS[targetLeaf]!.includes(ref.split('.').slice(2).join('.'));
      });
      if (!removedRefs.length) continue;
      adapted = true;
      for (const mode of ['light', 'dark'] as const) {
        const value = modeValue(token, mode), target = aliasOf(value);
        const transformed = target && removedRefs.includes(target) ? literal(target, mode) : typeof value === 'string' ? replaceVars(value, removedRefs, mode) : value;
        if (mode === 'light') token.$value = transformed;
        else if (token.$extensions?.['com.clossys.modes']?.dark !== undefined || stableStringify(transformed) !== stableStringify(token.$value)) token.$extensions = { ...token.$extensions, 'com.clossys.modes': { dark: transformed } };
      }
      const css = token.$extensions?.['com.clossys.css'];
      if (css) token.$extensions!['com.clossys.css'] = { ...(css.raw === undefined ? {} : { raw: replaceVars(css.raw, removedRefs, 'light') }), ...(css.reads ? { reads: css.reads.filter(ref => !removedRefs.includes(ref)) } : {}) };
    }
    if (adapted) { meta.mode = 'derived'; meta.derivation = { from: 'dtcg#alias', rule: 'materialize only retired-source references from historical Foundry token cells; retain live aliases' }; meta.pin = { file: 'historical Foundry token cells', sha256: historicalSha }; }
    if (BASELINES.has(leaf)) { meta.id = `foundry-baseline/${meta.slot}`; meta.source = 'foundry-baseline'; meta.baseline = true; }
    return fill;
  });
}
