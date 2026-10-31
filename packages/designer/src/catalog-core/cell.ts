import { idFinding, isValidId, type IdKind } from "./ids.js";
import type { FillDoc, Finding } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function parseFill(json: unknown): { fill?: FillDoc; findings: Finding[] } {
  const findings: Finding[] = [];
  const root = isPlainObject(json) ? json : undefined;
  const extensions = root && isPlainObject(root.$extensions) ? root.$extensions : undefined;
  const metadata = extensions?.["com.clossys.fill"];
  const meta = isPlainObject(metadata) ? metadata : undefined;
  const fillId = typeof meta?.id === "string" ? meta.id : "(unidentified)";
  const slotId = typeof meta?.slot === "string" ? meta.slot : undefined;
  const contract = (reason: string): void => {
    findings.push({ code: "C1", rule: "contract", severity: "error", subject: fillId, message: `contract: ${fillId} is not a valid DTCG cell: ${reason}` });
  };
  const validateId = (kind: IdKind, value: unknown): void => {
    const text = typeof value === "string" ? value : String(value);
    if (typeof value !== "string" || !isValidId(kind, value)) findings.push(idFinding(kind, text, fillId));
  };
  const layer = slotId?.split(".")[0] === "assets" ? "assets" : "themes";
  if (root) {
    for (const key of Object.keys(root)) if (key !== "$extensions" && key !== layer) contract(`extra root key ${key}`);
  }
  if (!meta) contract("missing fill metadata");
  else {
    validateId("fill", meta.id);
    validateId("slot", meta.slot);
    validateId("source", meta.source);
    if (Array.isArray(meta.conforms)) for (const clause of meta.conforms) validateId("clause", clause);
  }
  const visit = (node: unknown, path: string): void => {
    if (!isPlainObject(node)) {
      contract(`token ${path} has no $value`);
      return;
    }
    const children = Object.keys(node).filter(key => !key.startsWith("$"));
    if (Object.hasOwn(node, "$value")) {
      if (typeof node.$type !== "string") contract(`token ${path} has no $type`);
      if (children.length > 0) contract(`token ${path} has child entries`);
      if (slotId !== undefined && !path.startsWith(slotId + ".")) contract(`token ${path} lies outside slot ${slotId}`);
      if (meta) validateId("member", path);
    } else if (children.length > 0) {
      if (Object.hasOwn(node, "$type")) contract(`group-level $type at ${path} is not supported`);
      for (const key of children) visit(node[key], path + "." + key);
    } else {
      contract(`token ${path} has no $value`);
      if (!Object.hasOwn(node, "$type")) contract(`token ${path} has no $type`);
    }
  };
  if (!root || !isPlainObject(root[layer])) contract(`missing ${layer} root`);
  else visit(root[layer], layer);
  findings.sort((a, b) => a.message < b.message ? -1 : a.message > b.message ? 1 : 0);
  return findings.length === 0 ? { fill: json as FillDoc, findings } : { findings };
}
