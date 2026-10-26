/** Serializable body contracts. The Frame owns the only stage; Sections own their content. */
export type BodySubstrate = "flow" | "canvas";
export interface FrameStageContract {
  readonly accepts: readonly BodySubstrate[];
  readonly scroll: "document" | "region";
}
export interface SectionSubstrateRenderTest {
  readonly substrate: BodySubstrate;
  /** Source identity only; a matching passing run remains a separate evidence requirement. */
  readonly file: string;
  readonly name: string;
}
export interface SectionSubstrateContract {
  readonly substrates: readonly BodySubstrate[];
  readonly substrateTests?: readonly SectionSubstrateRenderTest[];
}
export type BodySource = { readonly kind: "static" } | {
  readonly kind: "derived";
  readonly query: { readonly id: string; readonly version: number };
};
export interface CanvasBoard<Section> {
  /** Stable across re-derivation, never an array index. */
  readonly id: string;
  readonly section: Section;
  readonly groups?: Readonly<Record<string, string>>;
}
export interface CanvasSize { readonly width: number; readonly height: number }
export interface CanvasPosition { readonly x: number; readonly y: number }
export interface CanvasGap { readonly x: number; readonly y: number }
export interface CanvasEdge { readonly id: string; readonly from: string; readonly to: string }
export type CanvasArrangement =
  | { readonly kind: "grid"; readonly columns: number; readonly gap: CanvasGap }
  | { readonly kind: "lanes"; readonly groupKey: string; readonly gap: CanvasGap; readonly laneGap: number }
  /** Contract only: no graph engine or connector implementation is offered. */
  | { readonly kind: "graph"; readonly edges: readonly CanvasEdge[]; readonly direction: "right" | "down"; readonly gap: CanvasGap }
  /** Contract only: an explicit orphan policy is mandatory; only freeform stores positions. */
  | { readonly kind: "freeform"; readonly positions: Readonly<Record<string, CanvasPosition>>; readonly orphanRule: "reject" | "drop" };
export interface FlowBody<Section> {
  readonly kind: "flow";
  readonly source: BodySource;
  readonly sections: readonly Section[];
}
export interface CanvasBody<Section> {
  readonly kind: "canvas";
  readonly source: BodySource;
  readonly boards: readonly CanvasBoard<Section>[];
  readonly arrangement: CanvasArrangement;
  /** Resolve this existing token against the consumer; compare the measured stage width. */
  readonly collapseBelow: `tokens.breakpoint.${string}`;
}
export type CompositionBody<Section> = FlowBody<Section> | CanvasBody<Section>;
export interface CanvasPlacement extends CanvasPosition, CanvasSize { readonly id: string }
export interface CanvasBounds extends CanvasPosition, CanvasSize {}
export type CanvasArrangementResult = {
  readonly status: "ready";
  readonly positions: readonly CanvasPlacement[];
  readonly bounds: CanvasBounds;
  readonly readingOrder: readonly string[];
} | {
  readonly status: "unavailable";
  readonly kind: "graph" | "freeform";
  readonly reason: "not-implemented";
};
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new TypeError(`${label} must be a nonempty stable identifier`);
}
function finite(value: unknown, label: string, positive = false): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || positive && value === 0) throw new TypeError(`${label} must be finite and ${positive ? "positive" : "nonnegative"}`);
}
function assertBoards<Section>(boards: readonly CanvasBoard<Section>[]): Set<string> {
  if (!Array.isArray(boards)) throw new TypeError("boards must be an array");
  const ids = new Set<string>();
  for (const board of boards) {
    if (!board || typeof board !== "object" || !own(board, "section")) throw new TypeError("board must name its Section");
    text(board.id, "board id");
    if (ids.has(board.id)) throw new TypeError("duplicate board id");
    ids.add(board.id);
  }
  return ids;
}
/** Required arrangement inputs are checked even for engines not yet implemented. */
export function assertCanvasArrangement<Section>(boards: readonly CanvasBoard<Section>[], arrangement: CanvasArrangement): void {
  const ids = assertBoards(boards);
  if (!arrangement || typeof arrangement !== "object") throw new TypeError("canvas arrangement required");
  switch (arrangement.kind) {
    case "grid":
      if (!Number.isSafeInteger(arrangement.columns) || arrangement.columns < 1) throw new TypeError("grid columns must be a positive integer");
      break;
    case "lanes":
      text(arrangement.groupKey, "lanes groupKey");
      finite(arrangement.laneGap, "laneGap");
      for (const board of boards) {
        if (!board.groups || !own(board.groups, arrangement.groupKey)) throw new TypeError("lanes board lacks groupKey data");
        text(board.groups[arrangement.groupKey], "lane group");
      }
      break;
    case "graph": {
      if (!Array.isArray(arrangement.edges)) throw new TypeError("graph edges required");
      if (arrangement.direction !== "right" && arrangement.direction !== "down") throw new TypeError("graph direction required");
      const edges = new Set<string>();
      for (const edge of arrangement.edges) {
        if (!edge || typeof edge !== "object") throw new TypeError("graph edge required");
        text(edge.id, "edge id");
        if (edges.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to)) throw new TypeError("duplicate edge or unknown endpoint");
        edges.add(edge.id);
      }
      break;
    }
    case "freeform": {
      if (arrangement.orphanRule !== "reject" && arrangement.orphanRule !== "drop") throw new TypeError("freeform orphanRule required");
      if (!arrangement.positions || typeof arrangement.positions !== "object" || Array.isArray(arrangement.positions)) throw new TypeError("freeform positions required");
      for (const id of ids) if (!own(arrangement.positions, id)) throw new TypeError("freeform position missing for stable board id");
      for (const [id, point] of Object.entries(arrangement.positions)) {
        if (!ids.has(id) && arrangement.orphanRule === "reject") throw new TypeError("orphan freeform position");
        if (!point || typeof point !== "object" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError("freeform coordinates must be finite");
      }
      return;
    }
    default: throw new TypeError("unsupported canvas arrangement");
  }
  if (!arrangement.gap || typeof arrangement.gap !== "object") throw new TypeError("arrangement gap required");
  finite(arrangement.gap.x, "gap.x"); finite(arrangement.gap.y, "gap.y");
  if (own(arrangement, "positions")) throw new TypeError("computed arrangements cannot store positions");
}
/** No DOM, observer, token default, camera state or persistent position enters a computed strategy. */
export function arrangeCanvas<Section>(boards: readonly CanvasBoard<Section>[], sizes: Readonly<Record<string, CanvasSize>>, arrangement: CanvasArrangement): CanvasArrangementResult {
  assertCanvasArrangement(boards, arrangement);
  if (arrangement.kind === "graph" || arrangement.kind === "freeform") return { status: "unavailable", kind: arrangement.kind, reason: "not-implemented" };
  if (!sizes || typeof sizes !== "object" || Array.isArray(sizes)) throw new TypeError("measured sizes required");
  const ids = new Set(boards.map(board => board.id));
  if (Object.keys(sizes).some(id => !ids.has(id))) throw new TypeError("measurement names an unknown board");
  for (const board of boards) {
    if (!own(sizes, board.id) || !sizes[board.id]) throw new TypeError("measured board size missing");
    finite(sizes[board.id]!.width, "measured width", true); finite(sizes[board.id]!.height, "measured height", true);
  }
  const positions: CanvasPlacement[] = [];
  const place = (board: CanvasBoard<Section>, x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError("arrangement coordinate overflow");
    const size = sizes[board.id]!;
    positions.push({ id: board.id, x, y, width: size.width, height: size.height });
  };
  if (arrangement.kind === "grid") {
    // Tracks size to their actual contents; a tall/wide card does not stretch every cell.
    const columns = Math.min(arrangement.columns, boards.length);
    const widths: number[] = [], heights: number[] = [];
    boards.forEach((board, index) => {
      const column = index % columns, row = Math.floor(index / columns), size = sizes[board.id]!;
      widths[column] = Math.max(widths[column] ?? 0, size.width); heights[row] = Math.max(heights[row] ?? 0, size.height);
    });
    const starts = (tracks: readonly number[], gap: number) => {
      let cursor = 0; return tracks.map(size => { const start = cursor; cursor += size + gap; return start; });
    };
    const xs = starts(widths, arrangement.gap.x), ys = starts(heights, arrangement.gap.y);
    boards.forEach((board, index) => place(board, xs[index % columns]!, ys[Math.floor(index / columns)]!));
  } else {
    // First occurrence orders lanes; input order within each lane is preserved.
    const lanes = new Map<string, CanvasBoard<Section>[]>();
    for (const board of boards) {
      const key = board.groups![arrangement.groupKey]!;
      const lane = lanes.get(key) ?? []; lane.push(board); lanes.set(key, lane);
    }
    let y = 0;
    for (const lane of lanes.values()) {
      let x = 0, height = 0;
      for (const board of lane) { place(board, x, y); x += sizes[board.id]!.width + arrangement.gap.x; height = Math.max(height, sizes[board.id]!.height); }
      y += height + arrangement.gap.y + arrangement.laneGap;
    }
  }
  const width = positions.reduce((value, item) => Math.max(value, item.x + item.width), 0);
  const height = positions.reduce((value, item) => Math.max(value, item.y + item.height), 0);
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new TypeError("arrangement bounds overflow");
  return { status: "ready", positions, bounds: { x: 0, y: 0, width, height }, readingOrder: positions.map(item => item.id) };
}
/** Shared precondition for route/instance gates. Missing substrate evidence never becomes support. */
export function bodySubstrateFindings<Section>(body: CompositionBody<Section>, stage: FrameStageContract | undefined, sectionContract: (section: Section) => SectionSubstrateContract | undefined): readonly string[] {
  const findings: string[] = [];
  if (!body || typeof body !== "object" || body.kind !== "flow" && body.kind !== "canvas") return ["body substrate must be flow or canvas"];
  if (!stage || !Array.isArray(stage.accepts) || !stage.accepts.includes(body.kind)) findings.push("Frame stage does not accept body substrate");
  if (!stage || stage.scroll !== "document" && stage.scroll !== "region") findings.push("Frame stage scroll contract unavailable");
  const source = body.source;
  if (!source || source.kind !== "static" && source.kind !== "derived") findings.push("body source must be static or derived");
  else if (source.kind === "derived" && (!source.query || typeof source.query.id !== "string" || !source.query.id.trim() || !Number.isSafeInteger(source.query.version) || source.query.version < 1)) findings.push("derived body requires a versioned query id");
  if (body.kind === "flow") {
    if (!Array.isArray(body.sections)) return [...findings, "flow body requires ordered Sections"];
    if (own(body, "boards") || own(body, "arrangement")) findings.push("flow body cannot carry canvas data");
  } else {
    if (!Array.isArray(body.boards)) return [...findings, "canvas body requires boards"];
    if (own(body, "sections")) findings.push("canvas body cannot carry a flow section list");
    if (typeof body.collapseBelow !== "string" || !/^tokens\.breakpoint\.[a-z][a-z0-9-]*$/.test(body.collapseBelow)) findings.push("canvas fallback requires an explicit consumer breakpoint token");
    try { assertCanvasArrangement(body.boards, body.arrangement); } catch (error) { return [...findings, error instanceof Error ? error.message : "invalid canvas arrangement"]; }
  }
  const sections = body.kind === "flow" ? body.sections : body.boards.map(board => board.section);
  for (const [index, section] of sections.entries()) {
    const contract = sectionContract(section);
    if (!contract || !Array.isArray(contract.substrates) || !contract.substrates.includes(body.kind)) findings.push(`Section ${index} does not declare ${body.kind} support`);
    if (contract && Array.isArray(contract.substrates)) for (const substrate of contract.substrates) {
      if (substrate !== "flow" && substrate !== "canvas") findings.push(`Section ${index} declares an unknown substrate`);
      else if (!Array.isArray(contract.substrateTests) || !contract.substrateTests.some(test => test && test.substrate === substrate && typeof test.file === "string" && test.file.trim() && typeof test.name === "string" && test.name.trim())) findings.push(`Section ${index} lacks a named ${substrate} render test`);
    }
  }
  return findings;
}
