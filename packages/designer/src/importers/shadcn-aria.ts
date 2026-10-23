import type { DtcgNode, DtcgToken, FillDoc, FillMeta, Slot, Source } from "../catalog-core/types.js";
import { assertMember, classifyValue, compare, evidenceFor, putToken, relationOf, scanDeclarations } from "./css-values.js";

/** Upstream variable and the `<leaf>.<member>` it fills, in the order of the mapping table. */
const MAPPING: readonly (readonly [string, string])[] = [
  ["--background", "surface-color.base"], ["--foreground", "text-color.primary"], ["--card", "surface-color.raised"], ["--popover", "surface-color.overlay"],
  ["--primary", "accent-color.default"], ["--primary-foreground", "text-color.on-accent"], ["--secondary", "control-color.tonal"], ["--muted", "surface-color.sunken"],
  ["--muted-foreground", "text-color.muted"], ["--accent", "surface-color.selected"], ["--destructive", "status-color.danger"], ["--border", "border-color.base"],
  ["--input", "border-color.strong"], ["--ring", "focus-color.default"], ["--radius", "radius.default"],
  ["--chart-1", "categorical-color.1"], ["--chart-2", "categorical-color.2"], ["--chart-3", "categorical-color.3"], ["--chart-4", "categorical-color.4"], ["--chart-5", "categorical-color.5"],
];

export function importShadcnAria(input: { css: string; source: Source; slots: readonly Slot[] }): FillDoc[] {
  const { source } = input;
  const pin = source.pin;
  if (!pin?.package || !pin.commit || !pin.file) throw new Error(`importer: source ${source.id} has no package, file and commit pin`);
  const slotById = new Map(input.slots.map(slot => [slot.id, slot]));
  const declarations = scanDeclarations(input.css);
  const light = new Map(declarations.filter(declaration => declaration.block === ":root").map(declaration => [declaration.name, declaration]));
  const dark = new Map(declarations.filter(declaration => declaration.block === ".dark").map(declaration => [declaration.name, declaration]));
  const mapped = new Set(MAPPING.map(([variable]) => variable));
  const unmapped = [...new Set([...light.keys(), ...dark.keys()].filter(name => !mapped.has(name)))];
  const bySlot = new Map<string, { member: string; variable: string; token: DtcgToken }[]>();
  for (const [variable, target] of MAPPING) {
    const declaration = light.get(variable);
    if (!declaration) throw new Error(`importer: shadcn variable ${variable} is missing`);
    const [leaf = "", ...path] = target.split(".");
    const slot = slotById.get("tokens." + leaf);
    if (!slot) throw new Error(`importer: no slot tokens.${leaf}`);
    const member = path.join(".");
    assertMember(slot, member);
    const type = slot.contract.memberTypes?.[member] ?? slot.contract.$type;
    const classified = classifyValue(declaration.value, type, variable, "always");
    const token: DtcgToken = { $type: type, $value: classified.value, $extensions: { "com.clossys.css": { raw: declaration.value }, "com.clossys.source": { line: declaration.line } } };
    const darkDeclaration = dark.get(variable);
    if (darkDeclaration && darkDeclaration.value !== declaration.value) {
      token.$extensions = { ...token.$extensions, "com.clossys.modes": { dark: classifyValue(darkDeclaration.value, type, variable, "always").value } };
    }
    const list = bySlot.get(slot.id) ?? [];
    list.push({ member, variable, token });
    bySlot.set(slot.id, list);
  }
  const fills: FillDoc[] = [];
  for (const slotId of [...bySlot.keys()].sort(compare)) {
    const slot = slotById.get(slotId)!;
    const entries = bySlot.get(slotId)!;
    const meta: FillMeta = {
      id: `${source.id}/${slot.id}`, slot: slot.id, source: source.id, mode: "implementation",
      sourceAddress: `${pin.package}/${pin.commit}/${pin.file}#${entries.map(entry => entry.variable).join(",")}`,
      relation: relationOf(slot, entries.map(entry => entry.member)),
      builtOn: [], conforms: slot.requires, evidence: evidenceFor(slot.requires, "src/importers/shadcn-aria.test.ts"),
      author: source.author, trust: "pinned-upstream", license: source.license, pin, status: "draft",
      ...(fills.length === 0 && unmapped.length > 0 ? { unmapped } : {}),
    };
    const root: Record<string, DtcgNode> = {};
    for (const { member, token } of entries) putToken(root, [slot.id.split(".")[1]!, ...member.split(".")], token);
    fills.push({ $extensions: { "com.clossys.fill": meta }, tokens: root });
  }
  return fills;
}
