import { validateCopyFields, type CopyField, type ResolveCopyOptions } from "../composition.js";
import { isContentLocale } from "../vocabulary.js";
export type PublisherBoardCopyResolver = NonNullable<ResolveCopyOptions["resolver"]>;

/** Same Writer callback/trace contract as resolveCopy, without inventing a composition for UI labels. */
export function writerLabel(field: CopyField | undefined, locale: string, resolver?: PublisherBoardCopyResolver): string | undefined {
  if (!field || field.source !== "writer" || field.locale !== locale || validateCopyFields([field], "copy").length) return undefined;
  // Existing deprecated Writer value projections remain readable; no inline fallback is created.
  if (field.ref === undefined) return typeof field.value === "string" && field.value.trim() ? field.value : undefined;
  if (!resolver) return undefined;
  const id = field.ref.id;
  const request = { id, locale, ...(field.ref.values === undefined ? {} : { values: Object.fromEntries(Object.entries(field.ref.values)) }) };
  try {
    const result = resolver(request);
    if (!result || result.ref?.id !== id || result.ref.locale !== locale || typeof result.text !== "string" || !result.text.trim()
      || !isContentLocale(result.servedLocale) || !Array.isArray(result.chain) || !result.chain.length
      || Array.from({ length: result.chain.length }, (_, index) => Object.hasOwn(result.chain!, index) && isContentLocale(result.chain![index])).some(valid => !valid)
      || new Set(result.chain).size !== result.chain.length || !result.chain.includes(result.servedLocale)) return undefined;
    return result.text;
  } catch { return undefined; }
}
