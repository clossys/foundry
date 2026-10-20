/** Closed web Frame names; custom extensions register Views rather than Frames. */
export const INSTANCE_FRAME_BLOCK_IDS = Object.freeze(["SiteFrame", "AppFrame"] as const);
export const INSTANCE_VIEW_BLOCK_IDS = Object.freeze([
  "AuthView", "CaptureView", "CollectionView", "ContactView", "DocumentView", "HeroView",
  "LandingView", "LegalView", "MarketingView", "SectionedView", "StatusView",
] as const);
/** Mirrors the web adapter's surface kinds without importing that adapter. */
export const INSTANCE_SITE_SURFACE_KINDS = Object.freeze(["site", "front-door", "admin", "demo"] as const);
export type InstanceFrameBlockId = typeof INSTANCE_FRAME_BLOCK_IDS[number];
export type InstanceViewBlockId = typeof INSTANCE_VIEW_BLOCK_IDS[number];
export type InstanceSiteSurfaceKind = typeof INSTANCE_SITE_SURFACE_KINDS[number];
export interface InstanceBlockRef { blockId: string; configId: string }
export interface InstanceRecord {
  instanceId: string;
  label: string;
  path?: string;
  surface: "site" | "app";
  frameBlockRef: InstanceBlockRef & { blockId: InstanceFrameBlockId };
  viewBlockRef: InstanceBlockRef;
  viewStates?: readonly string[];
  context: { consumer?: string; brand?: string; medium: "web" };
  packIds: readonly string[];
  uses?: string;
}
export interface PackRecord { packId: string; label: string; instanceIds: readonly string[] }
export interface InstanceRecordOptions { customViewIds?: readonly string[] }
export type InstanceRecordReason = "shape" | "identity" | "frame" | "view" | "pairing" | "duplicate" | "uses" | "membership";
export type InstanceRecordValidationResult = { status: "valid" } |
  { status: "refused"; reason: InstanceRecordReason; path: string };
const valid: InstanceRecordValidationResult = Object.freeze({ status: "valid" });
const refused = (reason: InstanceRecordReason, path: string): InstanceRecordValidationResult => ({ status: "refused", reason, path });
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
const name = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const instanceId = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const packId = /^pack\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
function data(value: unknown, fields: readonly string[], required: readonly string[] = fields): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return required.every(key => Object.hasOwn(descriptors, key)) && Reflect.ownKeys(descriptors).every(key => typeof key === "string" && fields.includes(key) &&
    descriptors[key]!.enumerable && Object.hasOwn(descriptors[key]!, "value"));
}
function list(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(fields).length === value.length + 1 && Array.from({ length: value.length }, (_, i) => fields[i])
    .every(field => field?.enumerable && Object.hasOwn(field, "value"));
}
const texts = (value: unknown): value is string[] => list(value) && value.every(text) && new Set(value).size === value.length;
function instance(input: unknown, options: InstanceRecordOptions): InstanceRecordValidationResult {
  if (!data(input, ["instanceId", "label", "path", "surface", "frameBlockRef", "viewBlockRef", "viewStates", "context", "packIds", "uses"], ["instanceId", "label", "surface", "frameBlockRef", "viewBlockRef", "context", "packIds"])) return refused("shape", "instance");
  if (!text(input.instanceId) || !instanceId.test(input.instanceId)) return refused("identity", "instanceId");
  if (!text(input.label)) return refused("shape", "label");
  if (input.surface !== "site" && input.surface !== "app") return refused("shape", "surface");
  if (Object.hasOwn(input, "path") && (!text(input.path) || !input.path.startsWith("/") || input.path.startsWith("//"))) return refused("shape", "path");
  if (!data(input.context, ["consumer", "brand", "medium"], ["medium"]) || input.context.medium !== "web") return refused("identity", "context");
  const scope = input.instanceId.split(".")[0]!;
  if (scope === "standard") {
    if (Object.hasOwn(input.context, "consumer") || Object.hasOwn(input.context, "brand") || Object.hasOwn(input, "uses")) return refused("identity", "context");
  } else if (!Object.hasOwn(input.context, "consumer") || !Object.hasOwn(input.context, "brand") || input.context.consumer !== scope || !name.test(scope) || !text(input.context.brand)) return refused("identity", "context");
  if (!texts(input.packIds) || !input.packIds.every(id => packId.test(id))) return refused("membership", "packIds");
  if (Object.hasOwn(input, "viewStates") && !texts(input.viewStates)) return refused("shape", "viewStates");
  if (Object.hasOwn(input, "uses") && (!text(input.uses) || !/^standard\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(input.uses))) return refused("uses", "uses");
  for (const key of ["frameBlockRef", "viewBlockRef"] as const) {
    const ref = input[key];
    if (!data(ref, ["blockId", "configId"]) || !text(ref.blockId) || !text(ref.configId)) return refused("shape", key);
  }
  const frame = input.frameBlockRef as Record<string, string>, view = input.viewBlockRef as Record<string, string>;
  if (!(INSTANCE_FRAME_BLOCK_IDS as readonly string[]).includes(frame.blockId!)) return refused("frame", "frameBlockRef.blockId");
  if (![...INSTANCE_VIEW_BLOCK_IDS, ...(options.customViewIds ?? [])].includes(view.blockId!)) return refused("view", "viewBlockRef.blockId");
  if (view.blockId === "AuthView" && input.surface !== "site") return refused("pairing", "frameBlockRef");
  if (input.surface === "app") {
    if (frame.blockId !== "AppFrame") return refused("pairing", "frameBlockRef");
  } else if (frame.blockId !== "SiteFrame" || !(INSTANCE_SITE_SURFACE_KINDS as readonly string[]).includes(frame.configId!) ||
    (view.blockId === "AuthView" ? frame.configId === "site" : frame.configId !== "site")) return refused("pairing", "frameBlockRef");
  return valid;
}
function pack(input: unknown): InstanceRecordValidationResult {
  if (!data(input, ["packId", "label", "instanceIds"]) || !text(input.packId) || !packId.test(input.packId) || !text(input.label) ||
    !texts(input.instanceIds) || !input.instanceIds.every(id => instanceId.test(id))) return refused("shape", "pack");
  return valid;
}
function checkOptions(options: unknown): options is InstanceRecordOptions {
  return data(options, ["customViewIds"], []) && (!Object.hasOwn(options, "customViewIds") ||
    texts(options.customViewIds) && options.customViewIds.every(id => !(INSTANCE_FRAME_BLOCK_IDS as readonly string[]).includes(id)));
}
/** Checks declared record shape and pairing; it does not establish role qualification. */
export function validateInstanceRecord(input: unknown, options: InstanceRecordOptions = {}): InstanceRecordValidationResult {
  try { return checkOptions(options) ? instance(input, options) : refused("shape", "options"); }
  catch { return refused("shape", "instance"); }
}
export function validatePackRecord(input: unknown): InstanceRecordValidationResult {
  try { return pack(input); } catch { return refused("shape", "pack"); }
}
/** Checks exact membership in both directions and resolves custom adoption/override references. */
export function validateInstanceRecords(instances: unknown, packs: unknown, options: InstanceRecordOptions = {}): InstanceRecordValidationResult {
  try {
    if (!list(instances) || !list(packs) || !checkOptions(options)) return refused("shape", "records");
    const records = new Map<string, InstanceRecord>(), memberships = new Map<string, PackRecord>();
    for (const input of instances) {
      const result = instance(input, options); if (result.status === "refused") return result;
      const record = input as InstanceRecord;
      if (records.has(record.instanceId)) return refused("duplicate", "instanceId");
      records.set(record.instanceId, record);
    }
    for (const input of packs) {
      const result = pack(input); if (result.status === "refused") return result;
      const record = input as PackRecord;
      if (memberships.has(record.packId)) return refused("duplicate", "packId");
      memberships.set(record.packId, record);
      if (record.instanceIds.some(id => !records.get(id)?.packIds.includes(record.packId))) return refused("membership", "instanceIds");
    }
    for (const record of records.values()) {
      if (record.packIds.some(id => !memberships.get(id)?.instanceIds.includes(record.instanceId))) return refused("membership", "packIds");
      if (record.uses) {
        const original = records.get(record.uses);
        if (!original || !original.instanceId.startsWith("standard.") || original.surface !== record.surface) return refused("uses", "uses");
      }
    }
    return valid;
  } catch { return refused("shape", "records"); }
}
