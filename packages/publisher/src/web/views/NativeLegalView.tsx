import { createCopyResolver } from "@clossys/writer";
import type { CopyRef, CopyRegistry, CopyResolveTarget } from "@clossys/writer";
import { gateLegalDocument } from "../../document/legal.js";
import type { LegalDocument } from "../../document/legal.js";
import { RenderError } from "../../internal/errors.js";
import { LegalView } from "./LegalView.js";
import type { LegalViewFramedLabels } from "./LegalView.js";

/** JSON operands for the genuine framed LegalView, with an explicit audience. */
export interface NativeLegalViewDocument {
  document: LegalDocument;
  registry: CopyRegistry;
  labels: LegalViewFramedLabels;
  locale: string;
  target: CopyResolveTarget;
  summary?: CopyRef;
}

export interface NativeLegalViewProps {
  document: NativeLegalViewDocument;
  landmark: "none";
}

function refuse(message: string): never {
  throw new RenderError("resolution-failed", `NativeLegalView ${message}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type JsonValue = null | string | boolean | number | JsonValue[] | { [key: string]: JsonValue };

/** Snapshot data descriptors once; never consume the original operands again. */
function readJson(value: unknown, ancestors = new Set<object>(), reactProps = false): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null) refuse("requires JSON operands");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    refuse("requires JSON operands");
  }
  if (ancestors.has(value)) refuse("requires acyclic JSON operands");
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  const length = array ? Object.getOwnPropertyDescriptor(value, "length")?.value : undefined;
  if (array && (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1)) {
    refuse("requires dense JSON arrays");
  }
  const snapshot: JsonValue[] | { [key: string]: JsonValue } = array ? [] : Object.create(null);
  for (const key of keys) {
    if (array && key === "length") continue;
    if (typeof key !== "string") refuse("requires JSON operands");
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) {
      refuse("requires JSON array indices");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    // React's development props add a non-enumerable warning getter for key.
    // It is framework metadata, never an operand, and is never invoked.
    if (reactProps && key === "key" && descriptor !== undefined && !descriptor.enumerable
      && typeof descriptor.get === "function" && descriptor.set === undefined) continue;
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      refuse("requires JSON data properties");
    }
    Object.defineProperty(snapshot, key, { value: readJson(descriptor.value, ancestors), enumerable: true, writable: true, configurable: true });
  }
  ancestors.delete(value);
  return snapshot;
}

const TRANSPORT_KEYS = ["document", "registry", "labels", "locale", "target", "summary"];

/** No chrome, resolver overrides, copy defaults or approval overrides. */
export function NativeLegalView(props: NativeLegalViewProps) {
  // Reflection can itself throw on a hostile object; never expose its payload.
  let snapshot: NativeLegalViewProps;
  try {
    snapshot = readJson(props, new Set(), true) as unknown as NativeLegalViewProps;
  } catch {
    refuse("requires plain JSON operands");
  }
  if (!isRecord(snapshot) || Object.keys(snapshot).some((key) => key !== "document" && key !== "landmark")) {
    refuse("refused unknown transport fields");
  }
  if (snapshot.landmark !== "none") refuse("requires landmark none");
  const input = snapshot.document;
  if (!isRecord(input) || Object.keys(input).some((key) => !TRANSPORT_KEYS.includes(key))) {
    refuse("refused invalid transport fields");
  }
  if (input.target !== "preview" && input.target !== "production") refuse("requires an explicit target");
  if (typeof input.locale !== "string" || input.locale.trim().length === 0) refuse("requires a locale");
  if (!isRecord(input.labels)) refuse("requires label operands");
  const result = gateLegalDocument(input.document, input.target);
  if (!result.ok) refuse("refused the legal document gate");
  const resolveCopyId = createCopyResolver(input.registry, { target: input.target });
  return <LegalView framed document={input.document} labels={input.labels} locale={input.locale}
    summary={input.summary} resolveCopyId={resolveCopyId} />;
}
