import { CHANNELS } from "./types.js";
import type { Channel, FlowSlotSpec } from "./types.js";

export type BlockRole = "frame" | "view";
export type BlockRoleMedium = Channel | "video";
export type BlockRoleClaim = boolean | BlockRole | { role: BlockRole; qualified?: boolean };
export type BlockRoleConfigValue = null | boolean | number | string |
  readonly BlockRoleConfigValue[] | { readonly [key: string]: BlockRoleConfigValue };
export interface BlockRoleAdapter {
  owner: string;
  subpath: string;
  export: string;
  config: Readonly<Record<string, BlockRoleConfigValue>>;
}
export interface BlockRoleRegion extends Pick<FlowSlotSpec, "key" | "required"> {
  childRoles: readonly BlockRole[];
  content: readonly string[];
}
export interface BlockRoleDescriptor {
  blockId: string;
  role: BlockRole;
  medium: BlockRoleMedium;
  adapter: BlockRoleAdapter;
  regions: readonly BlockRoleRegion[];
  content: readonly string[];
  runtime: readonly string[];
  lifecycle: { requires: readonly string[]; provides: readonly string[] };
  layout: "flow" | "geometry" | "sequence";
  web?: { main: "sole" | "none"; skipTarget?: string };
  evidence: { sourceRevision: string; measuredAt: string };
}
/** Known candidate declarations are separate from untrusted descriptors, not measured qualifications. */
export type BlockRoleAdapterContract = Omit<BlockRoleDescriptor, "blockId" | "evidence">;
export type BlockRoleReason =
  | "role-claim" | "measurement-required" | "unknown-adapter" | "adapter-config" | "role-medium" | "video-unsupported"
  | "regions" | "child-content" | "lifecycle" | "web-landmarks" | "layout";
export type BlockRoleValidationResult =
  | { status: "shape-error"; path: string; reason: string }
  | { status: "unverified"; reasons: readonly ["role-claim"]; claim: BlockRoleClaim }
  | { status: "qualified"; reasons: readonly BlockRoleReason[]; descriptor: BlockRoleDescriptor }
  | { status: "unverified"; reasons: readonly BlockRoleReason[]; descriptor: BlockRoleDescriptor }
  | { status: "unsupported"; reasons: readonly BlockRoleReason[]; descriptor: BlockRoleDescriptor };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === null && Reflect.ownKeys(value).every((key) =>
    typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)!.enumerable &&
    "value" in Object.getOwnPropertyDescriptor(value, key)!);
const text = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 0;
const dense = (value: unknown): value is unknown[] => Array.isArray(value) &&
  Object.keys(value).length === value.length && Reflect.ownKeys(value).every((key) =>
    typeof key === "string" && (key === "length" || /^(0|[1-9]\d*)$/.test(key)) && "value" in Object.getOwnPropertyDescriptor(value, key)!);
const strings = (value: unknown): value is string[] => dense(value) && value.every(text) && new Set(value).size === value.length;
const role = (value: unknown): value is BlockRole => value === "frame" || value === "view";
const INVALID: unique symbol = Symbol("invalid");
function snapshot(value: unknown, ancestors = new Set<unknown>(), depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= 64 || ancestors.has(value)) return INVALID;
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && (array || prototype !== null)) return INVALID;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" ||
      !Object.hasOwn(descriptors[key]!, "value") || (!descriptors[key]!.enumerable && !(array && key === "length")))) return INVALID;
  const copy = array ? [] : Object.create(null);
  ancestors.add(value);
  for (const key of Object.keys(descriptors)) {
    const descriptor = Object.assign(Object.create(null), descriptors[key]);
    descriptor.value = snapshot(descriptor.value, ancestors, depth + 1);
    Object.defineProperty(copy, key, descriptor);
  }
  ancestors.delete(value);
  return copy;
}
function json(value: unknown, ancestors = new Set<unknown>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if ((!Array.isArray(value) && !record(value)) || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? dense(value) && value.every((item) => json(item, ancestors))
    : Object.values(value as Record<string, unknown>).every((item) => json(item, ancestors));
  ancestors.delete(value);
  return valid;
}
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, i) => same(item, right[i]));
  }
  return record(left) && record(right) && Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key) && same(left[key], right[key]));
}
function dated(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}
/** Validates declaration shape and candidate compatibility; never grants measured qualification. */
export function validateBlockRole(input: unknown, knownAdapters: readonly BlockRoleAdapterContract[]): BlockRoleValidationResult {
  try {
    return validateSnapshot(snapshot(input), snapshot(knownAdapters) as BlockRoleAdapterContract[]);
  } catch {
    return { status: "shape-error", path: "descriptor", reason: "Invalid Block role descriptor field." };
  }
}
function validateSnapshot(input: unknown, knownAdapters: readonly BlockRoleAdapterContract[]): BlockRoleValidationResult {
  const error = (path: string): BlockRoleValidationResult => ({
    status: "shape-error", path, reason: "Invalid Block role descriptor field.",
  });
  if (record(input) && Object.hasOwn(input, "role") && role(input.role) &&
      Object.keys(input).every((key) => key === "role" || key === "qualified") &&
      input.qualified !== undefined && typeof input.qualified !== "boolean") return error("qualified");
  if (typeof input === "boolean" || role(input) || (record(input) && Object.hasOwn(input, "role") &&
      role(input.role) && Object.keys(input).every((key) => key === "role" || key === "qualified") &&
      (input.qualified === undefined || typeof input.qualified === "boolean"))) {
    return { status: "unverified", reasons: ["role-claim"], claim: input as BlockRoleClaim };
  }
  if (!record(input)) return error("descriptor");
  if (!text(input.blockId)) return error("blockId");
  if (!role(input.role)) return error("role");
  if (![...CHANNELS, "video"].includes(input.medium as BlockRoleMedium)) return error("medium");
  const adapter = input.adapter;
  if (!record(adapter) || !text(adapter.owner) || !text(adapter.subpath) ||
      !text(adapter.export) || !record(adapter.config) || !json(adapter.config)) return error("adapter");
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(adapter.owner) ||
      !/^(?:\.|[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*)$/.test(adapter.subpath) ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(adapter.export)) return error("adapter");
  if (!dense(input.regions) || input.regions.length === 0) return error("regions");
  for (const region of input.regions) {
    if (!record(region) || !text(region.key) ||
        (region.required !== undefined && typeof region.required !== "boolean") ||
        !dense(region.childRoles) || !region.childRoles.every(role) ||
        new Set(region.childRoles).size !== region.childRoles.length || !strings(region.content)) return error("regions");
  }
  if (!strings(input.content) || !strings(input.runtime)) return error("content/runtime");
  if (!record(input.lifecycle) || !strings(input.lifecycle.requires) || !strings(input.lifecycle.provides)) return error("lifecycle");
  if (!["flow", "geometry", "sequence"].includes(input.layout as string)) return error("layout");
  if (input.web !== undefined && (!record(input.web) ||
      !["sole", "none"].includes(input.web.main as string) ||
      (input.web.skipTarget !== undefined && !text(input.web.skipTarget)))) return error("web");
  if (!record(input.evidence) || !Object.hasOwn(input.evidence, "sourceRevision") ||
      !Object.hasOwn(input.evidence, "measuredAt") || typeof input.evidence.sourceRevision !== "string" ||
      !/^[a-f0-9]{40}$/.test(input.evidence.sourceRevision) || !dated(input.evidence.measuredAt)) return error("evidence");
  const descriptor = input as unknown as BlockRoleDescriptor;
  const result = (status: "unverified" | "unsupported", reason: BlockRoleReason): BlockRoleValidationResult =>
    status === "unsupported" ? { status: "unsupported", reasons: [reason], descriptor } :
      { status: "unverified", reasons: [reason], descriptor };
  if (descriptor.medium === "video") return result("unsupported", "video-unsupported");
  const candidates = knownAdapters.filter((candidate) =>
    candidate.adapter.owner === adapter.owner && candidate.adapter.subpath === adapter.subpath && candidate.adapter.export === adapter.export);
  if (!candidates.length) return result("unverified", "unknown-adapter");
  const configured = candidates.filter((candidate) => same(candidate.adapter.config, adapter.config));
  if (!configured.length) return result("unverified", "adapter-config");
  const candidate = configured.find((entry) => entry.role === descriptor.role && entry.medium === descriptor.medium);
  if (!candidate) return result("unsupported", "role-medium");
  if (new Set(descriptor.regions.map((region) => region.key)).size !== descriptor.regions.length) return result("unverified", "regions");
  if (candidate.regions.some((region) =>
      !descriptor.regions.some((item) => item.key === region.key && Boolean(item.required) === Boolean(region.required)))) return result("unverified", "regions");
  const compatibleRegion = (region: BlockRoleRegion) => candidate.regions.some((item) =>
    item.key === region.key && Boolean(item.required) === Boolean(region.required) &&
    same(item.childRoles, region.childRoles) && same(item.content, region.content));
  if (!descriptor.regions.every(compatibleRegion) || !same(candidate.content, descriptor.content)) return result("unverified", "child-content");
  if (!same(candidate.lifecycle, descriptor.lifecycle) || !same(candidate.runtime, descriptor.runtime)) return result("unverified", "lifecycle");
  if ((descriptor.medium === "web" && descriptor.layout !== "flow") || descriptor.layout !== candidate.layout) return result("unverified", "layout");
  if (descriptor.medium === "web") {
    if (descriptor.role === "frame" && (descriptor.web?.main !== "sole" ||
        !descriptor.regions.some((region) => region.required && region.key === descriptor.web?.skipTarget))) return result("unverified", "web-landmarks");
    if (descriptor.role === "view" &&
        (descriptor.web?.main !== "none" || descriptor.web.skipTarget !== undefined)) return result("unverified", "web-landmarks");
    if (!same(candidate.web, descriptor.web)) return result("unverified", "web-landmarks");
  } else if (descriptor.web !== undefined || candidate.web !== undefined) return result("unverified", "web-landmarks");
  return result("unverified", "measurement-required");
}
