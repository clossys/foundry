import { parseIcuMessage } from "./icu/parse.js";
import type { WriterLibrary } from "./model/types.js";
import { writerTextFields } from "./checks/length.js";

export type WriterPseudoLocale = "en-XA" | "ar-XB";
const accents: Readonly<Record<string, string>> = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };
const mirrors: Readonly<Record<string, string>> = { "(": ")", ")": "(", "[": "]", "]": "[", "<": ">", ">": "<", "{": "}", "}": "{" };

/** Literal-only primitive shared with WR9; ICU syntax must not be passed here. */
export function pseudoLiteral(text: string, locale: WriterPseudoLocale, factor = 1.35): string {
  if (locale !== "en-XA" && locale !== "ar-XB") throw new RangeError("Unknown pseudo locale");
  if (!Number.isFinite(factor) || factor < 1 || factor > 4) throw new RangeError("Expansion factor must be from 1 through 4");
  const characters = [...text];
  if (locale === "ar-XB") return characters.reverse().map(character => mirrors[character] ?? character).join("");
  return characters.map(character => accents[character] ?? character).join("")
    + (text.trim() ? "·".repeat(Math.ceil(characters.length * factor) - characters.length) : "");
}

/** Complete ICU blocks, quoted ICU literals and markup are opaque preview tokens. */
function segments(text: string): { text: string; protected: boolean }[] {
  const result: { text: string; protected: boolean }[] = [];
  let start = 0, cursor = 0;
  const add = (end: number): void => {
    if (cursor > start) result.push({ text: text.slice(start, cursor), protected: false });
    result.push({ text: text.slice(cursor, end), protected: true });
    start = cursor = end;
  };
  const quoteEnd = (at: number): number => {
    if (text[at + 1] === "'") return at + 2;
    let end = at + 1;
    while (end < text.length) {
      if (text[end++] !== "'") continue;
      if (text[end] === "'") end++; else return end;
    }
    return end;
  };
  while (cursor < text.length) {
    if (text[cursor] === "'" && /[{}']/.test(text[cursor + 1] ?? "")) { add(quoteEnd(cursor)); continue; }
    if (text[cursor] === "<") {
      const tag = /^<(?:\/?[A-Za-z][^<>"']*(?:(?:"[^"]*"|'[^']*')[^<>"']*)*|!--[\s\S]*?--)>/.exec(text.slice(cursor));
      if (tag) { add(cursor + tag[0].length); continue; }
    }
    if (text[cursor] === "{") {
      let depth = 1, end = cursor + 1;
      while (end < text.length && depth) {
        if (text[end] === "'" && /[{}#']/.test(text[end + 1] ?? "")) { end = quoteEnd(end); continue; }
        if (text[end] === "{") depth++;
        if (text[end] === "}") depth--;
        end++;
      }
      add(end); continue;
    }
    cursor++;
  }
  if (start < text.length) result.push({ text: text.slice(start), protected: false });
  return result;
}

/** Derived preview copy only: preserves ICU blocks and tags byte-for-byte. */
export function pseudoLocalize(text: string, locale: WriterPseudoLocale): string {
  if (parseIcuMessage(text).issues.length) throw new RangeError("Cannot pseudo-localize invalid ICU");
  // Validate even an empty or entirely protected message.
  pseudoLiteral("", locale);
  const body = segments(text).map(segment => segment.protected ? segment.text : pseudoLiteral(segment.text, locale)).join("");
  return locale === "en-XA" ? `[${body}]` : `\u200f\u202e${body}\u202c\u200f`;
}

/** Resolve English string/passage references through WR9's field reader; never insert content or approvals. */
export function pseudoLocaleFields(library: WriterLibrary, locale: WriterPseudoLocale, sourceLocale = "en") {
  pseudoLiteral("", locale);
  if (new Intl.Locale(sourceLocale).language !== "en" || !Object.hasOwn(library.locales, sourceLocale)) {
    throw new RangeError("Pseudo preview requires an available English source locale");
  }
  return {
    previewOnly: true as const,
    locale: { tag: locale, dir: locale === "ar-XB" ? "rtl" as const : "ltr" as const, state: "pseudo" as const },
    sourceLocale,
    fields: writerTextFields(library).filter(field => field.locale === sourceLocale && !field.externalLegal)
      .map(field => ({ ...field, text: pseudoLocalize(field.text, locale) })),
  };
}
