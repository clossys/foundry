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

/** Validate the original operands, without coercion, serialization or getters. */
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || value === null) refuse("requires JSON operands");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    refuse("requires JSON operands");
  }
  if (ancestors.has(value)) refuse("requires acyclic JSON operands");
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== (value as unknown[]).length + 1) refuse("requires dense JSON arrays");
  for (const key of keys) {
    if (array && key === "length") continue;
    if (typeof key !== "string") refuse("requires JSON operands");
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= (value as unknown[]).length)) {
      refuse("requires JSON array indices");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      refuse("requires JSON data properties");
    }
    assertJson(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

const TRANSPORT_KEYS = ["document", "registry", "labels", "locale", "target", "summary"];

/** No chrome, resolver overrides, copy defaults or approval overrides. */
export function NativeLegalView(props: NativeLegalViewProps) {
  // Reflection can itself throw on a hostile object; never expose its payload.
  try {
    assertJson(props);
  } catch {
    refuse("requires plain JSON operands");
  }
  if (!isRecord(props) || Object.keys(props).some((key) => key !== "document" && key !== "landmark")) {
    refuse("refused unknown transport fields");
  }
  if (props.landmark !== "none") refuse("requires landmark none");
  const input = props.document;
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
