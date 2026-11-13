export type ContentJson = null | boolean | number | string | readonly ContentJson[] | ContentJsonObject;
export interface ContentJsonObject { readonly [key: string]: ContentJson }
export type SourceAnswer = ContentJsonObject;

/** Serializable content only: no executable values, custom prototypes, cycles, or non-finite numbers. */
export function isContentJson(value: unknown): value is ContentJson {
  const ancestors = new Set<object>();
  function visit(v: unknown): boolean {
    if (v === null || typeof v === "string" || typeof v === "boolean") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v !== "object" || !v || ancestors.has(v)) return false;
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
    ancestors.add(v);
    const valid = Array.isArray(v)
      ? Array.from({ length: v.length }, (_, index) => Object.hasOwn(v, index) && visit(v[index])).every(Boolean)
      : Reflect.ownKeys(v).every(key => typeof key === "string" && visit((v as Record<string, unknown>)[key]));
    ancestors.delete(v);
    return valid;
  }
  return visit(value);
}

export function isSourceAnswer(value: unknown): value is SourceAnswer {
  return typeof value === "object" && value !== null && !Array.isArray(value) && isContentJson(value);
}
