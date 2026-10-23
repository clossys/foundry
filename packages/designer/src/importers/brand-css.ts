import type { DtcgNode, DtcgToken, FillDoc, FillMeta, Slot, Source } from "../catalog-core/types.js";
import { parseBrandDeclarations } from "../tokens/parse-brand-declarations.js";
import { parseDeclarationsForSelector } from "../tokens/internal/parse-css.js";
import type { TokenDefinition } from "../tokens/tokens.js";
import { classifyValue, compare, formatTyped, putToken, relationOf } from "./css-values.js";

const LIGHT_SELECTOR = ":root[data-brand-bound]";
const DARK_SELECTOR = ':root[data-brand-bound][data-theme="dark"]';

/**
 * Read a brand stylesheet (the three-block contract of `styles/brand-template.css`) into one fill per slot it binds.
 * Light values come from the light block, dark values from the explicit dark block; pass `darkSelector` when the stylesheet names it differently.
 * Names the catalog does not bind, and declarations of non-brandable tokens, go to `unmapped`.
 */
export function importBrandCss(input: {
  css: string; source: Source; address: string; slots: readonly Slot[]; tokens: readonly TokenDefinition[]; lightSelector?: string; darkSelector?: string;
}): FillDoc[] {
  const { source } = input;
  const parsed = parseBrandDeclarations(input.css);
  const problem = parsed.unchecked[0];
  if (problem) throw new Error(`importer: brand css is unreadable at line ${problem.line}: ${problem.detail}`);
  const light = parseDeclarationsForSelector(input.css, input.lightSelector ?? LIGHT_SELECTOR);
  let dark = new Map<string, string>();
  try { dark = parseDeclarationsForSelector(input.css, input.darkSelector ?? DARK_SELECTOR); } catch { /* a brand without a dark block is checked per property below */ }
  const tokens = new Map(input.tokens.map(token => [token.property, token]));
  const bindings = new Map<string, { slot: Slot; member: string }>();
  for (const slot of input.slots) for (const [member, property] of Object.entries(slot.contract.emit ?? {})) bindings.set(property, { slot, member });
  const brandable = (name: string): boolean => bindings.has(name) && tokens.get(name)?.brandable === true;
  const unmapped = Object.keys(parsed.declarations).filter(name => !brandable(name));
  for (const name of dark.keys()) {
    const definition = tokens.get(name);
    if (brandable(name) && (!light.has(name) || definition?.themeDependent !== true)) unmapped.push(`${name} (dark)`);
  }
  const bySlot = new Map<string, { member: string; token: DtcgToken }[]>();
  for (const [property, text] of light) {
    if (!brandable(property)) continue;
    if (text === "") throw new Error(`importer: ${property} is declared empty`);
    if (text.includes("var(")) throw new Error(`importer: ${property} must be a literal value`);
    const { slot, member } = bindings.get(property)!;
    const type = slot.contract.memberTypes?.[member] ?? slot.contract.$type;
    const classified = classifyValue(text, type, property, "as-written");
    const token: DtcgToken = { $type: type, $value: classified.value, $extensions: { "com.clossys.css": { raw: text }, ...(classified.unit ? { "com.clossys.unit": classified.unit } : {}), ...(classified.font ? { "com.clossys.font": classified.font } : {}) } };
    if (tokens.get(property)!.themeDependent) {
      const darkText = dark.get(property);
      if (darkText === undefined) throw new Error(`importer: ${property} has no dark value`);
      if (darkText === "") throw new Error(`importer: ${property} is declared empty`);
      if (darkText !== text) {
        const darkClassified = classifyValue(darkText, type, property, "as-written");
        token.$extensions = { ...token.$extensions, "com.clossys.modes": { dark: formatTyped(darkClassified, type) === darkText ? darkClassified.value : darkText } };
      }
    }
    const list = bySlot.get(slot.id) ?? [];
    list.push({ member, token });
    bySlot.set(slot.id, list);
  }
  if (bySlot.size === 0) throw new Error("importer: brand css binds no brandable token");
  const fills: FillDoc[] = [];
  for (const slotId of [...bySlot.keys()].sort(compare)) {
    const slot = input.slots.find(candidate => candidate.id === slotId)!;
    const entries = bySlot.get(slotId)!;
    const meta: FillMeta = {
      id: `${source.id}/${slot.id}`, slot: slot.id, source: source.id, mode: "implementation", sourceAddress: input.address,
      relation: relationOf(slot, entries.map(entry => entry.member)), builtOn: [], conforms: slot.requires,
      evidence: slot.requires.map(clause => ({ clause, check: clause === "dtcg#format" ? "C1" : clause === "dtcg#alias" ? "C2" : "C9" })),
      author: source.author, trust: source.kind === "consumer" ? "consumer" : source.pin ? "pinned-upstream" : "unpinned", license: source.license, ...(source.pin ? { pin: source.pin } : {}), status: "draft",
      ...(fills.length === 0 && unmapped.length > 0 ? { unmapped } : {}),
    };
    const root: Record<string, DtcgNode> = {};
    for (const { member, token } of entries) putToken(root, [slot.id.split(".")[1]!, ...member.split(".")], token);
    fills.push({ $extensions: { "com.clossys.fill": meta }, tokens: root });
  }
  return fills;
}
