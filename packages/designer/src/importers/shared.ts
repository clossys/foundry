import type { DtcgNode, DtcgToken, FillDoc, Slot, Source } from "../catalog-core/types.js";
import { classify, putToken } from "./foundry.js";

export type ImportedValue = { leaf: string; member: string; text: string; dark?: string; line?: number };
export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Build subsets; never invent missing upstream members or change the frozen contract. */
export function cells(input: { values: readonly ImportedValue[]; slots: readonly Slot[]; source: Source; sourceAddress: string; unmapped?: readonly string[]; derivedSpacing?: boolean }): FillDoc[] {
  const propertyIds = new Map(input.slots.flatMap(slot => slot.contract.kind === "token" ? Object.entries(slot.contract.emit ?? {}).map(([member, property]) => [property, `${slot.id}.${member}`] as const) : []));
  const fills: FillDoc[] = [];
  for (const slot of input.slots) {
    if (slot.contract.kind !== "token") continue;
    const values = input.values.filter(value => `tokens.${value.leaf}` === slot.id);
    if (!values.length) continue;
    const root: Record<string, DtcgNode> = {};
    for (const value of values) {
      const members = slot.contract.members;
      if (members.mode === "closed" ? !members.names.includes(value.member) : !new RegExp(members.pattern).test(value.member)) throw new Error(`importer: unknown member ${slot.id}.${value.member}`);
      const type = slot.contract.memberTypes?.[value.member] ?? slot.contract.$type;
      const make = (text: string): DtcgToken => {
        const targets = [...text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map(match => {
          const target = propertyIds.get(match[1]! as `--${string}`);
          if (!target) throw new Error(`importer: unbound alias ${match[1]}`);
          return target;
        });
        if (/^var\(\s*--[a-zA-Z0-9-]+\s*\)$/.test(text) && targets[0]) return { $type: type, $value: `{${targets[0]}}` };
        const typed = classify(text, type, value.member);
        return { $type: type, $value: typed.value, $extensions: { "com.clossys.css": { raw: text, ...(targets.length ? { reads: [...new Set(targets)].sort(compare) } : {}) }, ...(typed.unit ? { "com.clossys.unit": typed.unit } : {}), ...(typed.font ? { "com.clossys.font": typed.font } : {}), ...(value.line ? { "com.clossys.source": { line: value.line } } : {}) } };
      };
      const token = make(value.text);
      if (value.dark !== undefined && value.dark !== value.text) {
        if (!slot.contract.modes.includes("dark")) throw new Error(`importer: dark override for light-only ${slot.id}`);
        const dark = make(value.dark);
        // Preserve exact CSS spelling (including alpha percentages and font quoting).
        const reads = [...new Set([...(token.$extensions?.["com.clossys.css"]?.reads ?? []), ...(dark.$extensions?.["com.clossys.css"]?.reads ?? [])])].sort(compare);
        token.$extensions = { ...token.$extensions, ...(reads.length ? { "com.clossys.css": { ...token.$extensions?.["com.clossys.css"], reads } } : {}), "com.clossys.modes": { dark: typeof dark.$value === "string" && dark.$value.startsWith("{") ? dark.$value : value.dark } };
      }
      putToken(root, [value.leaf, ...value.member.split(".")], token);
    }
    const derived = input.derivedSpacing && slot.id === "tokens.spacing";
    fills.push({ $extensions: { "com.clossys.fill": {
      id: `${input.source.id}/${slot.id}`, slot: slot.id, source: input.source.id,
      mode: derived ? "derived" : "implementation", sourceAddress: input.sourceAddress, relation: derived ? "derived" : "subset", builtOn: [],
      conforms: slot.requires, evidence: slot.requires.map(clause => ({ clause, check: clause === "dtcg#format" ? "C1" : clause === "dtcg#alias" ? "C2" : "C9" })),
      author: input.source.author, trust: input.source.kind === "external" ? "pinned-upstream" : "consumer", license: input.source.license,
      ...(input.source.pin ? { pin: input.source.pin } : {}), status: "draft",
      ...(derived ? { derivation: { from: "tailwind-v4-theme#spacing-multiplier", rule: "n x --spacing" } } : {}),
      ...(input.unmapped?.length ? { unmapped: [...new Set(input.unmapped)].sort(compare) } : {}),
    } }, tokens: root });
  }
  return fills.sort((a, b) => compare(a.$extensions["com.clossys.fill"].id, b.$extensions["com.clossys.fill"].id));
}

/** SHA-256 over UTF-8 source bytes, without a Node or browser-crypto dependency. */
export function sourceSha256(text: string): string {
  const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  const primes: number[] = [];
  for (let n = 2; primes.length < 64; n++) if (!primes.some(p => n % p === 0)) primes.push(n);
  const fraction = (n: number) => ((n - Math.floor(n)) * 0x100000000) >>> 0;
  const constants = primes.map(p => fraction(Math.cbrt(p)));
  const hash = primes.slice(0, 8).map(p => fraction(Math.sqrt(p)));
  const bytes = [...new TextEncoder().encode(text)];
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let index = 7; index >= 0; index--) bytes.push(Math.floor(bits / 2 ** (index * 8)) & 255);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words: number[] = [];
    for (let index = 0; index < 16; index++) {
      const pos = offset + index * 4;
      words.push(((bytes[pos]! << 24) | (bytes[pos + 1]! << 16) | (bytes[pos + 2]! << 8) | bytes[pos + 3]!) >>> 0);
    }
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15]!, b = words[index - 2]!;
      words[index] = (words[index - 16]! + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[index - 7]! + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number];
    for (let index = 0; index < 64; index++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[index]! + words[index]!) >>> 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [a, b, c, d, e, f, g, h] = [(first + second) >>> 0, a, b, c, (d + first) >>> 0, e, f, g];
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => { hash[index] = (hash[index]! + value) >>> 0; });
  }
  return hash.map(value => value.toString(16).padStart(8, "0")).join("");
}
