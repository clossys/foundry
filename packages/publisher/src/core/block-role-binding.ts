import { CHANNELS } from "./types.js";
import { validateBlockRole } from "./block-role.js";
import type { BlockRole, BlockRoleMedium, BlockRoleDescriptor, BlockRoleAdapter, BlockRoleAdapterContract, BlockRoleConfigValue, BlockRoleReason } from "./block-role.js";

export interface InstanceBlockBinding {
  context: { consumer: string; brand: string; medium: BlockRoleMedium };
  frameBlockRef: BlockRoleDescriptor & { role: "frame" };
  viewBlockRef: BlockRoleDescriptor & { role: "view" };
}
export interface BlockRoleBindingRefIdentity<Role extends BlockRole = BlockRole> {
  blockId: string;
  role: Role;
  medium: BlockRoleMedium;
  adapter: Pick<BlockRoleAdapter, "owner" | "subpath" | "export">;
  configDigest: `sha256:${string}`;
  sourceRevision: string;
}
export interface BlockRoleBindingIdentity {
  context: InstanceBlockBinding["context"];
  frameBlockRef: BlockRoleBindingRefIdentity<"frame">;
  viewBlockRef: BlockRoleBindingRefIdentity<"view">;
}
export interface BlockRoleBindingReason {
  ref: "frameBlockRef" | "viewBlockRef" | "pair";
  code: BlockRoleReason | "role-mismatch" | "medium-mismatch" | "web-main";
}
type Outcome<Status extends "qualified" | "unverified" | "unsupported"> = {
  status: Status;
  reasons: readonly BlockRoleBindingReason[];
  identity?: BlockRoleBindingIdentity;
};
export type BlockRoleBindingValidationResult =
  | { status: "shape-error"; path: string; reason: string }
  | Outcome<"qualified"> | Outcome<"unverified"> | Outcome<"unsupported">;

function data(input: unknown, allowed: readonly string[]): Record<string, unknown> | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) return undefined;
  const fields = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(fields).some(key => typeof key !== "string" || !allowed.includes(key) ||
    !fields[key]!.enumerable || !Object.hasOwn(fields[key]!, "value"))) return undefined;
  return Object.assign(Object.create(null), Object.fromEntries(Object.keys(fields).map(key => [key, fields[key]!.value])));
}
function canonical(value: BlockRoleConfigValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const object = value as Readonly<Record<string, BlockRoleConfigValue>>;
  return "{" + Object.keys(object).sort().map(key => JSON.stringify(key) + ":" + canonical(object[key]!)).join(",") + "}";
}

/** SHA-256 over canonical JSON encoded as UTF-8; no ambient crypto or I/O. */
function configDigest(config: BlockRoleAdapter["config"]): `sha256:${string}` {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotate = (value: number, count: number) => (value >>> count) | (value << (32 - count));
  const bytes = Array.from(new TextEncoder().encode(canonical(config)));
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(Math.floor(bits / 2 ** (i * 8)) & 255);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words: number[] = [];
    for (let i = 0; i < 16; i++) {
      const start = offset + i * 4;
      words[i] = (bytes[start]! << 24) | (bytes[start + 1]! << 16) | (bytes[start + 2]! << 8) | bytes[start + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const left = words[i - 15]!, right = words[i - 2]!;
      const first = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3);
      const second = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10);
      words[i] = (words[i - 16]! + first + words[i - 7]! + second) | 0;
    }
    let [a, b, c, d, e, f, g, h] = state as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i]! + words[i]!) | 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) | 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) | 0;
    }
    const round = [a, b, c, d, e, f, g, h];
    state = state.map((value, i) => (value + round[i]!) | 0);
  }
  return `sha256:${state.map(value => (value >>> 0).toString(16).padStart(8, "0")).join("")}`;
}
function refIdentity<Role extends BlockRole>(descriptor: BlockRoleDescriptor, role: Role): BlockRoleBindingRefIdentity<Role> {
  const { owner, subpath, export: name } = descriptor.adapter;
  return { blockId: descriptor.blockId, role, medium: descriptor.medium,
    adapter: { owner, subpath, export: name }, configDigest: configDigest(descriptor.adapter.config),
    sourceRevision: descriptor.evidence.sourceRevision };
}
const error = (path: string): BlockRoleBindingValidationResult => ({
  status: "shape-error", path, reason: "Invalid Instance Block binding field.",
});

/** Checks two independent role declarations; measured qualification is reserved for future records. */
export function validateBlockRoleBinding(input: unknown, knownAdapters: readonly BlockRoleAdapterContract[]): BlockRoleBindingValidationResult {
  try {
    const binding = data(input, ["context", "frameBlockRef", "viewBlockRef"]);
    if (!binding) return error("binding");
    const contextData = data(binding.context, ["consumer", "brand", "medium"]);
    if (!contextData) return error("context");
    for (const key of ["consumer", "brand"] as const) {
      const value = contextData[key];
      if (typeof value !== "string" || !value.length || value.trim() !== value) return error("context." + key);
    }
    if (![...CHANNELS, "video"].includes(contextData.medium as BlockRoleMedium)) return error("context.medium");
    for (const ref of ["frameBlockRef", "viewBlockRef"]) if (!Object.hasOwn(binding, ref)) return error(ref);
    const frameResult = validateBlockRole(binding.frameBlockRef, knownAdapters);
    const viewResult = validateBlockRole(binding.viewBlockRef, knownAdapters);
    if (frameResult.status === "shape-error") return error("frameBlockRef." + frameResult.path);
    if (viewResult.status === "shape-error") return error("viewBlockRef." + viewResult.path);
    if (!("descriptor" in frameResult)) return error("frameBlockRef");
    if (!("descriptor" in viewResult)) return error("viewBlockRef");
    const frame = frameResult.descriptor, view = viewResult.descriptor;
    const reasons: BlockRoleBindingReason[] = [];
    if (frame.role !== "frame") reasons.push({ ref: "frameBlockRef", code: "role-mismatch" });
    if (view.role !== "view") reasons.push({ ref: "viewBlockRef", code: "role-mismatch" });
    if (reasons.length) return { status: "unsupported", reasons };
    const context = contextData as unknown as InstanceBlockBinding["context"];
    if (frame.medium !== view.medium || frame.medium !== context.medium) {
      return { status: "unsupported", reasons: [{ ref: "pair", code: "medium-mismatch" }] };
    }
    if (frame.medium === "web" && view.web?.main === "sole") {
      return { status: "unsupported", reasons: [{ ref: "viewBlockRef", code: "web-main" }] };
    }
    reasons.push(...frameResult.reasons.map(code => ({ ref: "frameBlockRef" as const, code })),
      ...viewResult.reasons.map(code => ({ ref: "viewBlockRef" as const, code })));
    const identity: BlockRoleBindingIdentity = {
      context, frameBlockRef: refIdentity(frame, "frame"), viewBlockRef: refIdentity(view, "view"),
    };
    return frameResult.status === "unsupported" || viewResult.status === "unsupported"
      ? { status: "unsupported", reasons, identity } : { status: "unverified", reasons, identity };
  } catch {
    return error("binding");
  }
}
