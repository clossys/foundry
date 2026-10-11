import type { SceneInput, SceneLayout, ScenePart, ScenePoint, SceneWire, SceneRow, SceneStatus, ScenePerson, SceneDisorder } from "./types.js";

/** FNV-1a over UTF-16 code units, with unsigned 32-bit multiplication. */
export function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
}
function object(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new TypeError("Scene: invalid structure or unknown field.");
}
function text(value: unknown): asserts value is string { if (typeof value !== "string" || !value.trim()) throw new TypeError("Scene: authored text and ids must be non-empty strings."); }
function count(value: unknown, min: number, max: number): asserts value is readonly unknown[] { if (!Array.isArray(value)) throw new TypeError("Scene: expected a list."); if (value.length < min || value.length > max) throw new RangeError(`Scene: count must be ${min}–${max}.`); }
function optionalText(value: unknown) { if (value !== undefined) text(value); }
const tones = ["success", "warning", "danger", "info", "neutral"];
function tone(value: unknown) { if (typeof value !== "string" || !tones.includes(value)) throw new TypeError("Scene: unknown status tone."); }
function status(value: SceneStatus) { object(value, ["tone", "text"]); tone(value.tone); text(value.text); }
function person(value: ScenePerson) { object(value, ["initials", "name", "note"]); if (typeof value.initials !== "string" || !/^[A-Za-z]{1,2}$/.test(value.initials)) throw new TypeError("Scene: initials require one or two letters."); text(value.name); text(value.note); }
function unique(values: readonly { id: string }[]) { const ids = new Set<string>(); for (const value of values) { text(value.id); if (ids.has(value.id)) throw new TypeError("Scene: duplicate slot id."); ids.add(value.id); } }
function rows(values: readonly SceneRow[], max: number) {
  count(values, 2, max); unique(values);
  for (const row of values) { object(row, ["id", "label", "value", "status", "figure", "quiet"]); text(row.label); text(row.value); if (row.status !== undefined) tone(row.status); for (const flag of [row.figure, row.quiet]) if (flag !== undefined && typeof flag !== "boolean") throw new TypeError("Scene: invalid row flag."); }
}
/** Validate before doing any arithmetic: typed callers are not a runtime trust boundary. */
function assertInput(input: SceneInput) {
  object(input, ["template", "seed", "disorder", ...(input?.template === "converge" ? ["sources", "target", "relations"] : input?.template === "evidence-trail" ? ["sources", "result"] : ["prepared", "findings", "node", "decision"])]);
  text(input.seed);
  if (!["converge", "evidence-trail", "approval-chain"].includes(input.template)) throw new TypeError("Scene: unknown template.");
  if (input.disorder !== undefined && !(input.template === "converge" ? ["none", "low", "medium"] : ["none", "low"]).includes(input.disorder)) throw new TypeError("Scene: invalid disorder.");
  if (input.template === "approval-chain") {
    count(input.findings, 2, 4); rows(input.decision?.rows, 4); unique(input.findings);
    object(input.prepared, ["heading", "meta"]); text(input.prepared.heading); optionalText(input.prepared.meta);
    object(input.node, ["label"]); text(input.node.label);
    object(input.decision, ["title", "meta", "status", "rows", "person"]); text(input.decision.title); optionalText(input.decision.meta); status(input.decision.status); person(input.decision.person);
    for (const finding of input.findings) { object(finding, ["id", "fn", "title", "subjectOf", "status", "subject"]); text(finding.fn); text(finding.title); text(finding.subjectOf); status(finding.status); if (finding.subject !== undefined && finding.subject !== true) throw new TypeError("Scene: subject must be true when present."); }
    if (input.findings.filter(f => f.subject).length !== 1) throw new TypeError("Scene: exactly one subject is required.");
    return;
  }
  const docs = input.template === "converge" ? input.sources?.items : input.sources;
  count(docs, input.template === "converge" ? 3 : 2, input.template === "converge" ? 8 : 4);
  const card = input.template === "converge" ? input.target : input.result;
  rows(card?.rows, input.template === "converge" ? 6 : 5); unique(docs);
  object(card, ["title", "meta", "rows", ...(input.template === "converge" ? ["heading"] : ["status", "person"])]); text(card.title); optionalText(card.meta);
  for (const doc of docs) { object(doc, ["id", "format", "title", "origin", ...(input.template === "evidence-trail" ? ["cites", "cite"] : [])]); if (!["pdf", "email", "sheet", "doc", "note", "scan", "calendar"].includes(doc.format)) throw new TypeError("Scene: unknown format."); text(doc.title); optionalText(doc.origin); }
  if (input.template === "converge") {
    object(input.sources, ["heading", "items"]); text(input.sources.heading); text(input.target.heading);
    count(input.relations, 1, 12);
    for (const relation of input.relations) { object(relation, ["from", "to", "emphasis"]); if (!docs.some(d => d.id === relation.from) || !card.rows.some(r => r.id === relation.to)) throw new TypeError("Scene: dangling relation."); if (relation.emphasis !== undefined && relation.emphasis !== true) throw new TypeError("Scene: emphasis must be true when present."); }
    for (const doc of docs) { const n = input.relations.filter(r => r.from === doc.id).length; if (n < 1 || n > 2) throw new TypeError("Scene: each source requires one or two relations."); }
    if (input.relations.filter(r => r.emphasis).length > 1) throw new TypeError("Scene: at most one emphasis.");
  } else {
    status(input.result.status); if (input.result.person !== undefined) person(input.result.person);
    for (const doc of input.sources) { text(doc.cite); if (!card.rows.some(r => r.id === doc.cites)) throw new TypeError("Scene: dangling citation."); }
  }
}
function scatter(seed: string, id: string, disorder: SceneDisorder) {
  const factor = disorder === "medium" ? 2 : disorder === "low" ? 1 : 0;
  return { k: (fnv1a(seed + ":" + id) % 3 - 1) * factor, nudge: ((fnv1a(id + ":" + seed) >>> 7) % 3 - 1) * factor * 6 };
}
function part(id: string, x: number, y: number, width: number, height: number, k = 0, nudge = 0): ScenePart { return { id, x, y, width, height, k, nudge }; }
const round = (n: number) => Math.round(n * 10) / 10;
function wire(from: string, to: string, start: ScenePoint, end: ScenePoint, subject = false, emphasis = false): SceneWire {
  const dx = end.x - start.x;
  return { from, to, start, end, subject, emphasis, path: `M ${round(start.x)} ${round(start.y)} C ${round(start.x + .55 * dx)} ${round(start.y)} ${round(end.x - .45 * dx)} ${round(end.y)} ${round(end.x)} ${round(end.y)}` };
}
/** Deterministic, static geometry. Wire anchors stay unrotated at each part's midpoint on its right edge. */
export function layoutScene(input: SceneInput): SceneLayout {
  assertInput(input);
  const l: SceneLayout = { width: 0, height: 0, docs: [], cards: [], wires: [], terminals: [], tags: [], nodes: [], people: [] };
  const disorder = input.disorder ?? (input.template === "converge" ? "medium" : "low");
  if (input.template === "converge") {
    const sourceH = input.sources.items.length * 74 - 16, targetH = 72 + input.target.rows.length * 48, body = Math.max(sourceH, targetH);
    const sy = 40 + (body - sourceH) / 2, ty = 40 + (body - targetH) / 2;
    l.width = 880; l.height = 40 + body + 16;
    l.cards.push(part("target", 540, ty, 340, targetH));
    l.docs = input.sources.items.map((d, i) => { const s = scatter(input.seed, d.id, disorder); return part(d.id, 24 + s.nudge, sy + i * 74, 264, 58, s.k, s.nudge); });
    l.wires = input.relations.map(r => { const d = l.docs.find(d => d.id === r.from)!; return wire(r.from, r.to, { x: d.x + 264, y: d.y + 29 }, { x: 540, y: ty + 72 + input.target.rows.findIndex(row => row.id === r.to) * 48 + 24 }, false, !!r.emphasis); });
    l.terminals = input.target.rows.filter(row => l.wires.some(w => w.to === row.id)).map(row => ({ id: row.id, x: 540, y: ty + 72 + input.target.rows.indexOf(row) * 48 + 24, subject: false }));
  } else if (input.template === "evidence-trail") {
    const cardH = 72 + input.result.rows.length * 50 + 48 + (input.result.person ? 48 : 0);
    l.width = 560; l.cards.push(part("result", 312, 12, 248, cardH));
    let previousY = -46;
    for (const doc of input.sources) {
      const rowIndex = input.result.rows.findIndex(row => row.id === doc.cites), mid = 12 + 72 + rowIndex * 50 + 25;
      const s = scatter(input.seed, doc.id, disorder), y = Math.max(mid - 29 + (rowIndex === 0 ? 0 : 40), previousY + 98, 52);
      const d = part(doc.id, 6 + Math.max(0, s.nudge), y, 196, 58, s.k, s.nudge); previousY = y; l.docs.push(d);
      const w = wire(doc.id, doc.cites, { x: d.x + 196, y: y + 29 }, { x: 312, y: mid }); l.wires.push(w);
      const width = doc.cite.length * 8 + 14;
      l.tags.push({ ...part(doc.id, (w.start.x + w.end.x - width) / 2, (w.start.y + w.end.y) / 2 - 10, width, 20), text: doc.cite });
    }
    l.terminals = input.result.rows.filter(r => l.wires.some(w => w.to === r.id)).map(r => ({ id: r.id, x: 312, y: 12 + 72 + input.result.rows.indexOf(r) * 50 + 25, subject: false }));
    if (input.result.person) l.people.push({ ...part("person", 328, 12 + 72 + input.result.rows.length * 50 + 48, 216, 48), marked: false });
    l.height = Math.max(12 + cardH, ...l.docs.map(d => d.y + d.height), ...l.tags.map(t => t.y + t.height)) + 16;
  } else {
    const findH = input.findings.length * 106 - 18, decisionH = 84 + input.decision.rows.length * 48 + 76;
    const cy = 64 + findH / 2, dy = Math.max(40, cy - decisionH / 2);
    l.width = 1000; l.height = Math.max(64 + findH, dy + decisionH) + 8;
    l.cards = input.findings.map((f, i) => { const s = scatter(input.seed, f.id, disorder); return part(f.id, 14 + Math.max(0, s.nudge), 64 + i * 106, 372, 88, s.k, s.nudge); });
    l.cards.push(part("decision", 620, dy, 380, decisionH));
    l.nodes.push({ ...part("node", 425, cy - 18, 150, 36), text: input.node.label });
    l.wires = input.findings.map(f => { const d = l.cards.find(d => d.id === f.id)!; return wire(f.id, "node", { x: d.x + 372, y: d.y + 44 }, { x: 425, y: cy }, !!f.subject); });
    l.wires.push(wire("node", input.decision.rows[0]!.id, { x: 575, y: cy }, { x: 620, y: dy + 84 + 24 }, true));
    l.terminals.push({ id: input.decision.rows[0]!.id, x: 620, y: dy + 108, subject: true });
    l.people.push({ ...part("person", 642, dy + 84 + input.decision.rows.length * 48, 336, 76), marked: true });
  }
  return l;
}
/** One readable authored relationship per input wire, independent of the SVG. */
export function sceneRelationText(input: SceneInput): string[] {
  assertInput(input);
  if (input.template === "converge") return input.relations.map(r => { const d = input.sources.items.find(d => d.id === r.from)!; const row = input.target.rows.find(row => row.id === r.to)!; return `${d.title} → ${row.label}: ${row.value}`; });
  if (input.template === "evidence-trail") return input.sources.map(d => { const row = input.result.rows.find(r => r.id === d.cites)!; return `${d.title} · ${d.cite} → ${row.label}: ${row.value}`; });
  return input.findings.map(f => `${f.title} → ${input.node.label}${f.subject ? ` → ${input.decision.title}: ${input.decision.rows[0]!.label}: ${input.decision.rows[0]!.value}` : ""}`);
}
