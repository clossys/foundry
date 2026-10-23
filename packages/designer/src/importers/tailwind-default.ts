import type { DtcgNode, DtcgToken, FillDoc, FillMeta, Slot, Source } from "../catalog-core/types.js";
import { assertMember, classifyValue, compare, evidenceFor, putToken, relationOf, round6, scanDeclarations } from "./css-values.js";

const SIZE = "xs|sm|base|lg|xl|[2-9]xl";
/** First matching rule wins; a name no rule matches goes to `unmapped`. A Tailwind name never becomes a leaf or member name except through a rule. */
const RULES: readonly { leaf: string; pattern: RegExp; member: (match: RegExpExecArray) => string }[] = [
  { leaf: "color-ramp", pattern: /^--color-([a-z]+)-(50|[1-9]00|950)$/, member: match => `${match[1]}.${match[2]}` },
  { leaf: "font-size", pattern: new RegExp(`^--text-(${SIZE})$`), member: match => match[1]! },
  { leaf: "line-height", pattern: new RegExp(`^--text-(${SIZE})--line-height$`), member: match => match[1]! },
  { leaf: "line-height", pattern: /^--leading-([a-z]+)$/, member: match => match[1]! },
  { leaf: "font-weight", pattern: /^--font-weight-([a-z]+)$/, member: match => match[1]! },
  { leaf: "letter-spacing", pattern: /^--tracking-([a-z]+)$/, member: match => match[1]! },
  { leaf: "typeface", pattern: /^--font-(sans|mono)$/, member: match => match[1] === "sans" ? "body" : "mono" },
  { leaf: "breakpoint", pattern: /^--breakpoint-([a-z0-9]+)$/, member: match => match[1]! },
  { leaf: "radius", pattern: /^--radius-([a-z0-9]+)$/, member: match => match[1]! },
  { leaf: "shadow", pattern: /^--shadow-([a-z0-9]+)$/, member: match => match[1]! },
  { leaf: "blur", pattern: /^--blur-([a-z0-9]+)$/, member: match => match[1]! },
  { leaf: "easing", pattern: /^--ease-([a-z]+(?:-[a-z]+)*)$/, member: match => match[1]! },
];
/** Foundry's ten spacing members as multiples of `--spacing`. */
const SPACING_STEPS: readonly (readonly [string, number])[] = [["xs", 1], ["sm", 2], ["md", 3], ["lg", 4], ["xl", 6], ["2xl", 8], ["3xl", 12], ["4xl", 16], ["5xl", 24], ["6xl", 32]];
const TEST_PATH = "src/importers/tailwind-default.test.ts";

export function importTailwindDefault(input: { themeCss: string; source: Source; slots: readonly Slot[] }): FillDoc[] {
  const { source, slots } = input;
  const pin = source.pin;
  if (!pin?.package || !pin.version || !pin.file) throw new Error(`importer: source ${source.id} has no package pin`);
  const slotById = new Map(slots.map(slot => [slot.id, slot]));
  const slotFor = (leaf: string): Slot => {
    const slot = slotById.get("tokens." + leaf);
    if (!slot) throw new Error(`importer: no slot tokens.${leaf}`);
    return slot;
  };
  const tokensBySlot = new Map<string, { member: string; token: DtcgToken }[]>();
  const add = (slot: Slot, member: string, token: DtcgToken): void => {
    assertMember(slot, member);
    const list = tokensBySlot.get(slot.id) ?? [];
    list.push({ member, token });
    tokensBySlot.set(slot.id, list);
  };
  const unmapped: string[] = [];
  let spacing: { value: number; line: number } | undefined;
  for (const declaration of scanDeclarations(input.themeCss)) {
    if (declaration.name === "--spacing") {
      const classified = classifyValue(declaration.value, "dimension", declaration.name, "always").value as { value?: number; unit?: string };
      if (typeof classified !== "object" || classified.unit !== "rem" || typeof classified.value !== "number") throw new Error("importer: --spacing is not a rem length");
      spacing = { value: classified.value, line: declaration.line };
      continue;
    }
    let matched = false;
    for (const rule of RULES) {
      const match = rule.pattern.exec(declaration.name);
      if (!match) continue;
      const slot = slotFor(rule.leaf);
      const member = rule.member(match);
      const type = slot.contract.memberTypes?.[member] ?? slot.contract.$type;
      const classified = classifyValue(declaration.value, type, declaration.name, "always");
      add(slot, member, {
        $type: type,
        $value: classified.value,
        $extensions: {
          "com.clossys.css": { raw: declaration.value },
          ...(classified.unit ? { "com.clossys.unit": classified.unit } : {}),
          ...(classified.font ? { "com.clossys.font": classified.font } : {}),
          "com.clossys.source": { line: declaration.line },
        },
      });
      matched = true;
      break;
    }
    if (!matched && !unmapped.includes(declaration.name)) unmapped.push(declaration.name);
  }
  if (!spacing) throw new Error("importer: --spacing is missing");
  const spacingSlot = slotFor("spacing");
  for (const [member, steps] of SPACING_STEPS) {
    const value = round6(steps * spacing.value);
    add(spacingSlot, member, { $type: "dimension", $value: { value, unit: "rem" }, $extensions: { "com.clossys.css": { raw: `${value}rem` }, "com.clossys.source": { line: spacing.line } } });
  }
  const fills: FillDoc[] = [];
  for (const slotId of [...tokensBySlot.keys()].sort(compare)) {
    const slot = slotById.get(slotId)!;
    const entries = tokensBySlot.get(slotId)!;
    const derived = slot.id === spacingSlot.id;
    const typed = entries.every(entry => typeof entry.token.$value !== "string");
    const conforms = [...new Set([...slot.requires, ...(typed ? ["dtcg#types"] : []), ...(typed && slot.contract.$type === "color" ? ["dtcg#color"] : [])])].sort(compare);
    const meta: FillMeta = {
      id: `${source.id}/${slot.id}`, slot: slot.id, source: source.id,
      mode: derived ? "derived" : "implementation",
      sourceAddress: `${pin.package}@${pin.version}/${pin.file}`,
      relation: derived ? "derived" : relationOf(slot, entries.map(entry => entry.member)),
      builtOn: ["tailwind-v4-theme"],
      conforms, evidence: evidenceFor(conforms, TEST_PATH),
      author: source.author, trust: "pinned-upstream", license: source.license, pin, status: "draft",
      ...(derived ? { derivation: { from: "tailwind-v4-theme#spacing-multiplier", rule: "n x --spacing" } } : {}),
      ...(fills.length === 0 && unmapped.length > 0 ? { unmapped } : {}),
    };
    const root: Record<string, DtcgNode> = {};
    for (const { member, token } of entries) putToken(root, [slot.id.split(".")[1]!, ...member.split(".")], token);
    fills.push({ $extensions: { "com.clossys.fill": meta }, tokens: root });
  }
  return fills;
}
