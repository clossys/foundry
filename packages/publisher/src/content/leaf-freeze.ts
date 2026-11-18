import type { ContentFinding } from "./composition.js";
import type { ContentSlot } from "./model.js";
import { isSlotId } from "./taxonomy.js";

/** Compare identities only; placement, ordering and content readiness are independent. The caller supplies the freeze
 * record: Publisher reads no freeze of its own (the signed src/content/slots.leaf-freeze.json lists only retired ids). */
export function checkSlotLeafFreeze(
  slots: readonly Pick<ContentSlot, "id">[],
  freeze: unknown,
): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const finding = (path: string, message: string): ContentFinding => ({ path, rule: "LEAF_FREEZE", message });
  if (freeze === null || typeof freeze !== "object" || Array.isArray(freeze)) {
    return [finding("freeze", "Expected a slot leaf freeze record")];
  }
  const data = freeze as Record<string, unknown>;
  if (data.schemaVersion !== 1 || data.layer !== "slots" || data.scope !== "leaf-membership-only"
    || data.policy !== "regrouping is not membership" || data.signedHead !== null
    || typeof data.ownerSignoffComment !== "string" || !data.ownerSignoffComment.trim()
    || !Array.isArray(data.leafIds) || !data.leafIds.every(isSlotId)
    || new Set(data.leafIds).size !== data.leafIds.length) {
    return [finding("freeze", "Invalid slot leaf freeze metadata or leaf IDs")];
  }
  const expected = new Set<string>(data.leafIds);
  const actual = new Set<string>();
  slots.forEach((slot, index) => {
    if (actual.has(slot.id)) findings.push(finding(`slots[${index}].id`, `Duplicate slot leaf ID: ${slot.id}`));
    actual.add(slot.id);
  });
  for (const id of [...expected].sort()) {
    if (!actual.has(id)) findings.push(finding("slots", `Missing frozen slot leaf ID: ${id}`));
  }
  for (const id of [...actual].sort()) {
    if (!expected.has(id)) findings.push(finding("slots", `Unexpected slot leaf ID: ${id}`));
  }
  return findings;
}
