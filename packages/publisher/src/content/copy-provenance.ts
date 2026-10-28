import { canonicalLocale } from "@clossys/writer/locale";

export interface CopyLocaleProvenance {
  readonly requestedLocale: string;
  readonly servedLocale: string;
  readonly chain: readonly string[];
  readonly reason: "native" | "writer-fallback";
}

function canonical(value: unknown): value is string {
  try { return typeof value === "string" && canonicalLocale(value) === value; }
  catch { return false; }
}

/** Validate Writer's evidence without inventing or truncating its fallback policy. */
export function copyLocaleProvenance(value: unknown, path = "resolution", expected?: {
  readonly requestedLocale: string;
  readonly chain: readonly string[];
}): CopyLocaleProvenance {
  const fail = (field: string): never => { throw new TypeError(`${path}.${field}: invalid copy locale provenance`); };
  if (!value || typeof value !== "object") return fail("servedLocale");
  const row = value as Record<string, unknown>;
  if (!canonical(row.servedLocale) || row.locale !== row.servedLocale) return fail("servedLocale");
  const chain = row.chain;
  if (!Array.isArray(chain) || !chain.length
    || Array.from({ length: chain.length }, (_, index) => Object.hasOwn(chain, index) && canonical(chain[index])).some(valid => !valid)
    || new Set(chain).size !== chain.length || !chain.includes(row.servedLocale)) return fail("chain");
  const ref = row.ref as { locale?: unknown } | undefined;
  const requestedLocale = ref?.locale ?? chain[0];
  // Writer omits undeclared locales from the chain; when present, the request must lead it.
  if (!canonical(requestedLocale) || (chain.includes(requestedLocale) && chain[0] !== requestedLocale)) return fail("requestedLocale");
  if (expected && (requestedLocale !== expected.requestedLocale || chain.length !== expected.chain.length
    || chain.some((locale, index) => locale !== expected.chain[index]))) return fail("chain");
  return { requestedLocale, servedLocale: row.servedLocale, chain: [...chain],
    reason: requestedLocale === row.servedLocale ? "native" : "writer-fallback" };
}
