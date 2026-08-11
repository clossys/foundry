import type { SecretCatalog, SecretCatalogEntry } from "../types.js";
import { InfisicalError } from "./errors.js";

export function parseValueFreeCatalog(value: unknown): SecretCatalog {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const object = value as Record<string, unknown>;
  const allowedTopLevel = new Set(["version", "entries"]);
  if (Object.keys(object).some((key) => !allowedTopLevel.has(key))) return invalid();
  if (object.version !== 1 || !Array.isArray(object.entries)) return invalid();
  if (object.entries.length === 0) return invalid();
  const entries: SecretCatalogEntry[] = [];
  const keys = new Set<string>();
  for (const item of object.entries) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return invalid();
    const entry = item as Record<string, unknown>;
    const allowed = new Set(["key", "required", "description", "group"]);
    if (Object.keys(entry).some((key) => !allowed.has(key))) return invalid();
    if (typeof entry.key !== "string" || entry.key.length === 0 || typeof entry.required !== "boolean") return invalid();
    if (entry.description !== undefined && typeof entry.description !== "string") return invalid();
    if (entry.group !== undefined && typeof entry.group !== "string") return invalid();
    if (keys.has(entry.key)) return invalid();
    keys.add(entry.key);
    entries.push({
      key: entry.key,
      required: entry.required,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.group === undefined ? {} : { group: entry.group }),
    });
  }
  return { version: 1, entries };
}

function invalid(): never {
  throw new InfisicalError(
    "INFISICAL_CONFIGURATION_INVALID",
    "Secret catalog must be value-free version 1 metadata with unique keys.",
  );
}
