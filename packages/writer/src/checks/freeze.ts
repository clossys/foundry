import { loadWriterCatalog, type WriterCatalog } from "../catalog/ia/index.js";
import { checkWriterLeafSets, loadWriterLeafFreezeSnapshots, WRITER_LEAF_FREEZE_LAYERS, type WriterLeafFreezeOptions, type WriterLeafFreezeSnapshot } from "../catalog-core/leaf-freeze.js";
import type { WriterLibrary } from "../model/types.js";

export type WriterRuleCode = "WR2" | "WR3" | "WR4" | "WR5" | "WR7" | "WR8" | "WR9" | "WR10" | "WR11";
export interface WriterCheckFinding { code: WriterRuleCode; severity: "error" | "warning" | "advisory"; path: string; message: string; locale?: string; recordId?: string; field?: string; incomplete?: boolean }
/** Caller-supplied evidence from a consumer's versioned Designer library; no inferred external IDs. */
export interface WriterDesignerEvidence { version: string; assets: readonly string[]; leaves: readonly string[]; configs?: Readonly<Record<string, readonly string[]>>; frames: readonly { id: string; logicalProperties?: boolean; configs?: readonly string[] }[] }
export interface WriterCheckOptions { catalog?: WriterCatalog; freeze?: WriterLeafFreezeOptions; designerLibraries?: readonly WriterDesignerEvidence[]; pseudoFactor?: number }

/** WR2 defaults to the shipped catalog and its versioned membership proposals.
 * Empty manifest heads mean approval is pending; no signature is inferred.
 * Only the three proposed layers are compared, irrespective of locale records.
 * Group labels, L1/L2 placement, record text, passages and narratives are unfrozen.
 * Unfrozen layers must retain empty manifest heads until a baseline is approved.
 */
export function checkWriterFreeze(library: WriterLibrary, options: WriterCheckOptions = {}): WriterCheckFinding[] {
  try {
    const catalog = options.catalog ?? loadWriterCatalog();
    const snapshots = options.freeze?.snapshots ?? loadWriterLeafFreezeSnapshots();
    // This API validates injected snapshots and amendments before comparing sets.
    const membership = checkWriterLeafSets(catalog.placements, catalog.slots, WRITER_LEAF_FREEZE_LAYERS, {
      ...options.freeze, snapshots,
    });
    const findings: WriterCheckFinding[] = membership.map(finding => ({
      code: "WR2", severity: "error", path: `catalog.${finding.source}.${finding.layer}`,
      message: `WR2: ${finding.message}`,
    }));
    for (const layer of WRITER_LEAF_FREEZE_LAYERS) {
      const claimedHead = library.manifest.leafFreeze[layer];
      if (claimedHead === "") continue;
      // Successful membership validation above establishes each snapshot's shape.
      const snapshot = (snapshots as readonly WriterLeafFreezeSnapshot[]).find(value => value.layer === layer)!;
      if (snapshot.signedHead === null || claimedHead !== snapshot.signedHead) findings.push({
        code: "WR2", severity: "error", path: `writer.json.leafFreeze.${layer}`,
        message: snapshot.signedHead === null
          ? `WR2: ${layer} has only an unsigned candidate membership snapshot; its manifest head must remain empty while owner approval is pending.`
          : `WR2: ${layer} manifest head must match the owner-signed membership snapshot.`,
      });
    }
    for (const layer of ["passages", "narratives"] as const) {
      if (library.manifest.leafFreeze[layer] !== "") findings.push({
        code: "WR2", severity: "error", path: `writer.json.leafFreeze.${layer}`,
        message: `WR2: ${layer} remains unfrozen with owner approval pending; its manifest head must remain empty until an owner-signed baseline exists.`,
      });
    }
    return findings;
  } catch (error) {
    return [{ code: "WR2", severity: "error", path: "catalog.leafFreeze", incomplete: true, message: `WR2: ${error instanceof Error ? error.message : "Unable to validate Writer membership snapshots."}` }];
  }
}
