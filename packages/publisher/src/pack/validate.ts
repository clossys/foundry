import { isLifecycleCondition, isLifecycleStatus } from "./lifecycle.js";
import { isPackLayer, isPackVersionString, isPackVisibility, type PackItem, type PackManifest } from "./types.js";

export interface PackFinding {
  rule: string;
  itemId: string;
  message: string;
}

export interface PackValidationResult {
  exitCode: number;
  findings: PackFinding[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

function timestampFields(item: PackItem): Array<readonly [string, string | null]> {
  return [
    ["createdAt", item.createdAt],
    ["updatedAt", item.updatedAt],
    ["approvedAt", item.approvedAt],
    ["verifiedAt", item.verifiedAt],
  ];
}

function validateItem(item: PackItem, knownIds: ReadonlySet<string>, push: (finding: PackFinding) => void): void {
  const itemId = typeof item.id === "string" && item.id.length > 0 ? item.id : "(missing id)";

  if (typeof item.id !== "string" || item.id.length === 0) {
    push({ rule: "invalid-id", itemId, message: "Every pack item needs a non-empty string id." });
  }
  if (!isPackLayer(item.layer)) {
    push({ rule: "invalid-layer", itemId, message: `Item "${itemId}" has layer ${JSON.stringify(item.layer)}, which is not one of foundation, identity, surface.` });
  }
  if (typeof item.owner !== "string" || item.owner.length === 0) {
    push({ rule: "invalid-owner", itemId, message: `Item "${itemId}" needs a non-empty owner.` });
  }
  if (!isPackVisibility(item.visibility)) {
    push({ rule: "invalid-visibility", itemId, message: `Item "${itemId}" has visibility ${JSON.stringify(item.visibility)}; it must declare "internal" or "public" (#1204, #1206) — visibility is never inferred.` });
  }
  if (!isLifecycleStatus(item.status)) {
    push({ rule: "invalid-status", itemId, message: `Item "${itemId}" has status ${JSON.stringify(item.status)}, which is not in the shared lifecycle vocabulary (#1228).` });
  }
  if (!isLifecycleCondition(item.condition)) {
    push({ rule: "invalid-condition", itemId, message: `Item "${itemId}" has condition ${JSON.stringify(item.condition)}, which is not current, stale, or blocked (#1228).` });
  }
  if (!isPackVersionString(item.version)) {
    push({ rule: "invalid-version", itemId, message: `Item "${itemId}" has version ${JSON.stringify(item.version)}; expected the "v<major>.<minor>" shape, e.g. "v0.1".` });
  }
  if (!Array.isArray(item.needs)) {
    push({ rule: "invalid-needs", itemId, message: `Item "${itemId}"'s needs must be an array of item ids.` });
  } else {
    for (const need of item.needs) {
      if (need === item.id) {
        push({ rule: "self-need", itemId, message: `Item "${itemId}" names itself in needs.` });
      } else if (!knownIds.has(need)) {
        push({ rule: "unknown-need", itemId, message: `Item "${itemId}" needs "${need}", which is not a known pack item id.` });
      }
    }
  }
  for (const [field, value] of timestampFields(item)) {
    if (value !== null && !isIsoTimestamp(value)) {
      push({ rule: "invalid-timestamp", itemId, message: `Item "${itemId}"'s ${field} must be null or an ISO-8601 UTC timestamp, got ${JSON.stringify(value)}.` });
    }
  }
  const [created, updated, approved, verified] = timestampFields(item).map(([, value]) => value);
  const present = [created, updated, approved, verified].filter((value): value is string => isIsoTimestamp(value));
  const sorted = [...present].sort();
  if (JSON.stringify(present) !== JSON.stringify(sorted)) {
    push({ rule: "timestamp-order", itemId, message: `Item "${itemId}"'s timestamps must be non-decreasing: createdAt <= updatedAt <= approvedAt <= verifiedAt.` });
  }
  if (item.status === "verified" && !isIsoTimestamp(item.verifiedAt)) {
    push({ rule: "missing-verified-at", itemId, message: `Item "${itemId}" has status "verified" but no verifiedAt timestamp.` });
  }
  if ((item.status === "approved" || item.status === "verified") && !isIsoTimestamp(item.approvedAt)) {
    push({ rule: "missing-approved-at", itemId, message: `Item "${itemId}" has status "${item.status}" but no approvedAt timestamp — approval (the Customer keep) precedes verification.` });
  }
  if ((item.status === "absent" || item.status === "found" || item.status === "draft") && (isIsoTimestamp(item.approvedAt) || isIsoTimestamp(item.verifiedAt))) {
    push({ rule: "premature-timestamp", itemId, message: `Item "${itemId}" has status "${item.status}" but already carries an approvedAt or verifiedAt timestamp.` });
  }
  if (!Array.isArray(item.sourcePins)) {
    push({ rule: "invalid-source-pins", itemId, message: `Item "${itemId}"'s sourcePins must be an array.` });
  } else {
    for (const pin of item.sourcePins) {
      if (typeof pin?.path !== "string" || pin.path.length === 0 || typeof pin?.fingerprint !== "string" || !FINGERPRINT_RE.test(pin.fingerprint)) {
        push({ rule: "invalid-source-pin", itemId, message: `Item "${itemId}" has a source pin that is not a {path, fingerprint} pair with a 64-hex-character sha256 fingerprint: ${JSON.stringify(pin)}.` });
      }
    }
  }
  if (!Array.isArray(item.outputPaths)) push({ rule: "invalid-output-paths", itemId, message: `Item "${itemId}"'s outputPaths must be an array of strings.` });
  if (!Array.isArray(item.publishedTo)) push({ rule: "invalid-published-to", itemId, message: `Item "${itemId}"'s publishedTo must be an array of strings.` });
  if (item.status !== "verified" && Array.isArray(item.publishedTo) && item.publishedTo.length > 0) {
    push({ rule: "premature-published-to", itemId, message: `Item "${itemId}" has status "${item.status}" but already names a publishedTo destination; only a verified item has shipped anywhere.` });
  }
}

function findNeedsCycle(items: readonly PackItem[]): string[] | null {
  const byId = new Map(items.map((item) => [item.id, item]));
  const state = new Map<string, "visiting" | "done">();

  const visit = (id: string, path: string[]): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...path, id];
    state.set(id, "visiting");
    const item = byId.get(id);
    for (const need of item?.needs ?? []) {
      if (!byId.has(need)) continue; // unknown-need is reported separately
      const cycle = visit(need, [...path, id]);
      if (cycle) return cycle;
    }
    state.set(id, "done");
    return null;
  };

  for (const item of items) {
    const cycle = visit(item.id, []);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Structural validation for a pack manifest (#1204): the contract and
 * schema this package's `clossys/publisher/pack.json` must satisfy. Pure
 * and synchronous, the same shape as `checkWebRoutes.ts`'s
 * `evaluateWebRouteManifest` — no filesystem access, so callers decide how
 * the manifest was loaded.
 */
export function validatePackManifest(manifest: PackManifest): PackValidationResult {
  const findings: PackFinding[] = [];
  const push = (finding: PackFinding) => findings.push(finding);

  if (manifest.schemaVersion !== 1) {
    push({ rule: "invalid-schema-version", itemId: "(manifest)", message: `Pack manifest schemaVersion must be 1, got ${JSON.stringify(manifest.schemaVersion)}.` });
  }
  if (!Array.isArray(manifest.items)) {
    return { exitCode: 1, findings: [{ rule: "invalid-items", itemId: "(manifest)", message: "Pack manifest items must be an array." }] };
  }

  const seenIds = new Set<string>();
  for (const item of manifest.items) {
    if (typeof item.id === "string" && item.id.length > 0) {
      if (seenIds.has(item.id)) push({ rule: "duplicate-id", itemId: item.id, message: `Item id "${item.id}" appears more than once in the pack manifest.` });
      seenIds.add(item.id);
    }
  }

  for (const item of manifest.items) validateItem(item, seenIds, push);

  const cycle = findNeedsCycle(manifest.items);
  if (cycle) {
    push({ rule: "needs-cycle", itemId: cycle[0] ?? "(manifest)", message: `Pack items form a needs cycle: ${cycle.join(" -> ")}.` });
  }

  findings.sort((left, right) => left.itemId.localeCompare(right.itemId) || left.rule.localeCompare(right.rule));
  return { exitCode: findings.length === 0 ? 0 : 1, findings };
}
