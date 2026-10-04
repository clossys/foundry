import { useCallback, useEffect, useState } from "react";
import type { FrontDoorKey, FrontDoorNouns, FrontDoorCopyResolution } from "@clossys/writer";
import { RenderError } from "../../internal/errors.js";

export type FrontDoorResolver = (key: FrontDoorKey, nouns: FrontDoorNouns) => FrontDoorCopyResolution;

/**
 * Shared by the provider-free front-door forms. Resolves every entry of
 * `keys` through `resolveFrontDoorCopy` and throws `RenderError`
 * `resolution-failed` for the first that cannot resolve. The message names
 * the form and the id's position in the catalog, never the caller's nouns.
 */
export function resolveFormCopy<K extends FrontDoorKey>(resolveCopy: FrontDoorResolver, form: string, keys: readonly K[], nouns: FrontDoorNouns): Record<K, string> {
  const words = {} as Record<K, string>;
  for (const key of keys) {
    const resolved = resolveCopy(key, nouns);
    if (!resolved.complete || resolved.text === undefined) {
      throw new RenderError("resolution-failed", `${form} could not resolve front-door copy "${key}".`);
    }
    words[key] = resolved.text;
  }
  return words;
}

/**
 * Returns a function that moves focus to the field `<fieldId>-<name>` after
 * the render that follows the call, so a field that appears in the same
 * update (the next step's) can take it. Asking twice for the same field
 * focuses it twice.
 */
export function useFocusRequest(fieldId: string): (name: string) => void {
  const [request, setRequest] = useState<{ name: string; sequence: number } | null>(null);
  useEffect(() => {
    if (request !== null) document.getElementById(`${fieldId}-${request.name}`)?.focus();
  }, [request, fieldId]);
  return useCallback((name: string) => setRequest((previous) => ({ name, sequence: (previous?.sequence ?? 0) + 1 })), []);
}
