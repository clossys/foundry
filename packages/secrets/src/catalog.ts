import type { SecretCatalog, SecretCatalogEntry } from "./types.js";

export function defineSecretCatalog(entries: readonly SecretCatalogEntry[]): SecretCatalog {
  return Object.freeze({
    version: 1,
    entries: Object.freeze(
      entries.map((entry) =>
        Object.freeze({
          key: entry.key,
          required: entry.required,
          ...(entry.description === undefined ? {} : { description: entry.description }),
          ...(entry.group === undefined ? {} : { group: entry.group }),
        }),
      ),
    ),
  });
}
