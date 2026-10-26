import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import source from "../catalog/sources/tailwind-default.json" with { type: "json" };
import type { FillDoc, Slot, Source } from "../catalog-core/types.js";
import { cells, sourceSha256, type ImportedValue } from "./shared.js";

export function importTailwindDefault(input: { css: string; slots?: readonly Slot[] }): FillDoc[] {
  if (sourceSha256(input.css) !== source.pin.sha256) throw new Error("importer: source bytes differ from the pinned tailwind-default source");
  const values: ImportedValue[] = [];
  const unmapped: string[] = [];
  const css = input.css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, property = "", text = ""] = match;
    let leaf: string | undefined;
    let member = "";
    let hit: RegExpExecArray | null;
    if (/^--text-shadow-/.test(property)) { unmapped.push(property); continue; }
    if (property === "--blur" || property === "--shadow") { leaf = property.slice(2); member = "default"; }
    else if ((hit = /^--color-([a-z]+)-(50|[1-9]00|950)$/.exec(property))) { leaf = "color-ramp"; member = `${hit[1]}.${hit[2]}`; }
    else if ((hit = /^--text-(.+)--line-height$/.exec(property))) { leaf = "line-height"; member = hit[1]!; }
    else if ((hit = /^--text-([a-z0-9-]+)$/.exec(property))) { leaf = "font-size"; member = hit[1]!; }
    else if ((hit = /^--(font-weight|tracking|leading|breakpoint|radius|shadow|blur|ease)-([a-z0-9-]+)$/.exec(property))) {
      leaf = ({ "font-weight": "font-weight", tracking: "letter-spacing", leading: "line-height", breakpoint: "breakpoint", radius: "radius", shadow: "shadow", blur: "blur", ease: "easing" } as Record<string, string>)[hit[1]!]; member = hit[2]!;
    } else if (property === "--font-sans" || property === "--font-mono") { leaf = "typeface"; member = property === "--font-sans" ? "body" : "mono"; }
    else if (property === "--spacing") {
      const dimension = /^([\d.]+)rem$/.exec(text.trim());
      if (!dimension) throw new Error("importer: --spacing must be a rem dimension");
      const names = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"];
      [1, 2, 3, 4, 6, 8, 12, 16, 24, 32].forEach((n, index) => values.push({ leaf: "spacing", member: names[index]!, text: `${n * Number(dimension[1])}rem` }));
      continue;
    }
    if (leaf) values.push({ leaf, member, text: text.trim().replace(/\s+/g, " ") }); else unmapped.push(property);
  }
  const find = (leaf: string, member: string) => values.find(value => value.leaf === leaf && value.member === member);
  const copy = (leaf: string, member: string, from: string) => { const value = find(leaf, from); if (!value) throw new Error(`importer: missing ${leaf}.${from}`); values.push({ ...value, member }); };
  copy("radius", "subtle", "xs"); copy("radius", "default", "sm");
  values.push({ leaf: "radius", member: "sharp", text: "0px" }, { leaf: "radius", member: "pill", text: "999px" });
  copy("breakpoint", "tablet", "md"); copy("breakpoint", "tablet-lg", "lg"); copy("breakpoint", "desktop", "xl");
  copy("easing", "accelerate", "in"); copy("easing", "decelerate", "out");
  values.push({ leaf: "typeface", member: "display", text: "var(--font-body)" });
  const typedColorText = (text: string) => text.replace(/oklch\(([\d.]+)%/, (_, lightness: string) => `oklch(${Number(lightness) / 100}`);
  for (const step of [100, 200, 300, 400, 500, 600, 700]) {
    const value = find("color-ramp", `blue.${step}`); if (!value) throw new Error(`importer: missing blue.${step}`);
    values.push({ leaf: "sequential-color", member: String(step), text: typedColorText(value.text), dark: typedColorText(value.text) });
  }
  for (const [member, hue] of [["positive", "blue"], ["negative", "red"]]) {
    const value = find("color-ramp", `${hue}.600`); if (!value) throw new Error(`importer: missing ${hue}.600`);
    values.push({ leaf: "diverging-color", member: member!, text: typedColorText(value.text), dark: typedColorText(value.text) });
  }
  const fills = cells({ values, slots: input.slots ?? tokenSlots as unknown as readonly Slot[], source: source as Source, sourceAddress: "tailwindcss/theme.css", unmapped, derivedSpacing: true });
  for (const fill of fills) {
    const meta = fill.$extensions["com.clossys.fill"];
    const rules: Record<string, string> = {
      "tokens.radius": "subtle=xs; default=sm (+1px versus historical); sharp=0px and pill=999px are adapter constants",
      "tokens.breakpoint": "tablet=md; tablet-lg=lg; desktop=xl; Foundry supplies retained mobile/mobile-lg/wide subset",
      "tokens.easing": "accelerate=in; decelerate=out; Foundry supplies default/bounce subset",
      "tokens.typeface": "body=sans; mono=mono; display aliases body",
      "tokens.sequential-color": "blue.100..700 copied as typed role values for both modes",
      "tokens.diverging-color": "positive=blue.600; negative=red.600; neutral is derived explicitly from the consumer border-color.base",
    };
    if (rules[meta.slot]) { meta.mode = "derived"; meta.relation = meta.slot === "tokens.diverging-color" ? "subset" : "derived"; meta.derivation = { from: "dtcg#alias", rule: rules[meta.slot]! }; }
  }
  return fills;
}
