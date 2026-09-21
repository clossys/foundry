/**
 * Ensures the registry file `writer-check` reads is the same store a surface
 * passes to `createCopyResolver` at render — never a second, request-scoped
 * module the CLI does not scan.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { validateCopyRegistryShape } from "./schema.js";
import type { CopyRegistry } from "./types.js";

export type RenderRegistryParityReason =
  | "render-registry-path-mismatch"
  | "record-not-copy-registry";

export interface RenderRegistryParityResult {
  ok: boolean;
  reason?: RenderRegistryParityReason;
  detail?: string;
  registry?: CopyRegistry;
}

/**
 * Confirms `recordFile` is a `CopyRegistry` and, when `renderRegistryFile`
 * is supplied, that both paths resolve to the same file (the render store
 * and the gate store must be one file).
 */
export function checkRenderRegistryParity(
  recordFile: string,
  recordValue: unknown,
  renderRegistryFile?: string,
): RenderRegistryParityResult {
  const registryFindings = validateCopyRegistryShape(recordValue);
  if (registryFindings.length > 0) {
    const detail = registryFindings.map((f) => f.message).join("; ");
    return {
      ok: false,
      reason: "record-not-copy-registry",
      detail: `record-file is not a CopyRegistry (the store createCopyResolver reads): ${detail}`,
    };
  }

  if (renderRegistryFile !== undefined) {
    const recordReal = safeRealpath(resolve(recordFile));
    const renderReal = safeRealpath(resolve(renderRegistryFile));
    if (recordReal !== renderReal) {
      return {
        ok: false,
        reason: "render-registry-path-mismatch",
        detail:
          "record-file and --render-registry must be the same file — a second approved store the CLI does not read is not an approved registry.",
      };
    }
  }

  return { ok: true, registry: recordValue as CopyRegistry };
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
