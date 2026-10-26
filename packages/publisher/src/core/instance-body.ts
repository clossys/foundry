import { bodySubstrateFindings } from "@clossys/designer/catalog";
import type { InstanceBinding, InstanceRegistries, InstanceSectionRef, SectionFill } from "./instance-binding.js";
/** Resolve a body reference only against this instance's canonical fills. */
export function instanceBodyFill(binding: InstanceBinding, reference: InstanceSectionRef): SectionFill | undefined {
  if (!reference || Object.keys(reference).sort().join(",") !== "index,slot" || typeof reference.slot !== "string" || !Number.isSafeInteger(reference.index) || reference.index < 0) return undefined;
  return binding.fills[reference.slot]?.[reference.index];
}
export function instanceBodyFindings(binding: InstanceBinding, registries: InstanceRegistries): readonly string[] {
  try { return closedBodyFindings(binding, registries); }
  catch { return ["Malformed canonical instance body"] }
}
function closedBodyFindings(binding: InstanceBinding, registries: InstanceRegistries): readonly string[] {
  if (!binding.body) return ["Registered route requires an explicit canonical body"];
  const body = binding.body;
  const findings: string[] = [];
  const fields = (value: unknown, allowed: readonly string[]): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
  if (!fields(binding, ["instanceId", "label", "path", "surface", "packIds", "format", "context", "frame", "fills", "states", "layout", "body"]) || !fields(binding.context, ["consumer", "brand", "medium"]) || !fields(binding.frame, ["leaf", "config", "content", "slotFills"]) || binding.layout && !fields(binding.layout, ["leaf", "config", "members"])) findings.push("Instance binding has unknown fields");
  if (binding.frame.content !== undefined && (!binding.frame.content || typeof binding.frame.content !== "object" || Array.isArray(binding.frame.content) || Object.entries(binding.frame.content).some(([name, ref]) =>
    !name || name.trim() !== name || !fields(ref, ["kind", "ref"]) || !["copy", "media", "records", "action", "region"].includes(ref.kind) || typeof ref.ref !== "string" || !ref.ref || ref.ref.trim() !== ref.ref))) findings.push("Frame content must contain only named typed consumer references");
  for (const fill of [...Object.values(binding.fills).flat(), ...Object.values(binding.frame.slotFills ?? {})]) {
    if (!fields(fill, ["section", "config", "span", "content"]) || !fill.content || Object.values(fill.content).some(ref => !fields(ref, ["kind", "ref"]))) findings.push("Section fill/content has unknown fields");
  }
  const keys = body.kind === "flow" ? ["kind", "source", "sections"] : ["kind", "source", "boards", "arrangement", "collapseBelow"];
  if (!fields(body, keys)) return ["Body has unknown fields"];
  const source = body.source;
  if (!fields(source, source?.kind === "static" ? ["kind"] : ["kind", "query"]) || source.kind === "derived" && !fields(source.query, ["id", "version"])) findings.push("Body source/query has unknown fields");
  if (body.kind === "canvas") {
    if (!Array.isArray(body.boards)) return [...findings, "Canvas requires boards"];
    for (const board of body.boards) {
      if (!fields(board, ["id", "section", "groups"])) findings.push("Canvas board has unknown fields or authored positions");
      if (board.groups !== undefined && (!board.groups || typeof board.groups !== "object" || Array.isArray(board.groups) || Object.entries(board.groups).some(([key, value]) => !key.trim() || typeof value !== "string" || !value.trim()))) findings.push("Canvas groups must be named string values");
    }
    const arrangement = body.arrangement;
    const allowed = arrangement?.kind === "grid" ? ["kind", "columns", "gap"] : arrangement?.kind === "lanes" ? ["kind", "groupKey", "gap", "laneGap"] : arrangement?.kind === "graph" ? ["kind", "edges", "direction", "gap"] : ["kind", "positions", "orphanRule"];
    if (!fields(arrangement, allowed)) findings.push("Arrangement has unknown fields or stored computed positions");
    if (arrangement?.kind !== "freeform" && !fields(arrangement?.gap, ["x", "y"])) findings.push("Arrangement gap has unknown fields");
    if (arrangement?.kind === "graph" && (!Array.isArray(arrangement.edges) || arrangement.edges.some(edge => !fields(edge, ["id", "from", "to"])))) findings.push("Graph edge has unknown fields");
    if (arrangement?.kind === "freeform" && (!arrangement.positions || Object.values(arrangement.positions).some(point => !fields(point, ["x", "y"])))) findings.push("Freeform point has unknown fields");
  } else if (body.kind !== "flow" || !Array.isArray(body.sections)) return [...findings, "Flow requires ordered Section references"];
  const refs = body.kind === "flow" ? body.sections : body.boards.map(board => board.section);
  const expected = Object.entries(binding.fills).flatMap(([slot, fills]) => fills.map((_, index) => JSON.stringify([slot, index])));
  const seen: string[] = [];
  for (const reference of refs) {
    if (!instanceBodyFill(binding, reference)) findings.push("Body references an unknown canonical Section fill");
    else seen.push(JSON.stringify([reference.slot, reference.index]));
  }
  if (seen.length !== expected.length || new Set(seen).size !== seen.length || expected.some(path => !seen.includes(path))) findings.push("Body must reference every canonical body Section fill exactly once");
  if (body.kind === "canvas" && binding.layout !== undefined) findings.push("Canvas arrangement cannot carry a flow Layout");
  if (body.kind === "flow" && !binding.layout) findings.push("Flow body requires its registered page Layout");
  findings.push(...bodySubstrateFindings(body, registries.frames.find(frame => frame.id === binding.frame.leaf)?.contract.stage, reference => {
    const fill = instanceBodyFill(binding, reference), contract = fill && registries.sections.find(section => section.id === fill.section)?.contract;
    return contract?.substrates ? { substrates: contract.substrates, substrateTests: contract.substrateTests } : undefined;
  }));
  return findings;
}
