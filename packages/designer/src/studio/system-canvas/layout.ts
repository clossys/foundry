import type { LayerId, Placement, PlacementNode } from "../../catalog-core/index.js";
import type { CanvasRect } from "../../blocks/canvas/models.js";
import { TOKENS } from "../../tokens/tokens.js";

/**
 * The whole design system on one canvas (Designer D5f/D5g): five layer rows, top
 * to bottom, consumers above what they are built on, so the "uses" highlight
 * reads downward.
 */
export const SYSTEM_LAYER_ORDER: readonly LayerId[] = ["frames", "sections", "components", "assets", "tokens"];

export interface SystemCell {
  readonly leaf: string;
  readonly layer: LayerId;
  readonly l1: string;
  readonly l2: string;
  /** Board id, `<layer>/<l1>`. */
  readonly board: string;
  /** Line id, `<layer>/<l1>/<l2>`. */
  readonly line: string;
  readonly rect: CanvasRect;
}
export interface SystemLine {
  readonly id: string;
  readonly l2: string;
  readonly label: string;
  /** The whole line: its label column and every cell. */
  readonly rect: CanvasRect;
  readonly labelRect: CanvasRect;
  readonly cells: readonly SystemCell[];
}
export interface SystemBoard {
  readonly id: string;
  readonly layer: LayerId;
  readonly l1: string;
  readonly label: string;
  readonly rect: CanvasRect;
  readonly lines: readonly SystemLine[];
}
export interface SystemRow { readonly layer: LayerId; readonly rect: CanvasRect; readonly boards: readonly SystemBoard[] }
export interface SystemLayout {
  readonly rows: readonly SystemRow[];
  readonly bounds: CanvasRect;
  readonly boards: ReadonlyMap<string, SystemBoard>;
  readonly lines: ReadonlyMap<string, SystemLine>;
  readonly cells: ReadonlyMap<string, SystemCell>;
}
/** World geometry, in untransformed CSS pixels. */
export interface SystemMetrics {
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** Composed shells need their own viewport; absent on synthetic/host geometries. */
  readonly frameCellWidth?: number;
  readonly frameCellHeight?: number;
  readonly cellGap: number;
  readonly lineGap: number;
  readonly lineLabelWidth: number;
  readonly boardPadding: number;
  readonly boardTitleHeight: number;
  readonly boardGap: number;
  readonly rowGap: number;
}

const px = (token: string): number => Number.parseFloat(TOKENS[token]!.value);
/**
 * Default geometry, read from existing tokens. A cell is one specimen card at
 * 100% (the Cell zoom stop): the aside width by the default dock block size.
 * Composed Frames use the existing desktop width and maximum dock block tokens
 * so their responsive renderer can show the sidebar beside its content.
 * Dedicated canvas geometry tokens are a recorded NEED; these are stand-ins.
 */
export function defaultSystemMetrics(): SystemMetrics {
  return {
    cellWidth: px("--ui-layout-aside-w"), cellHeight: px("--ui-layout-dock-default-block"),
    frameCellWidth: px("--breakpoint-desktop"), frameCellHeight: px("--ui-layout-dock-max-block"),
    cellGap: px("--spacing-lg"), lineGap: px("--spacing-lg"), lineLabelWidth: px("--spacing-6xl"),
    boardPadding: px("--spacing-xl"), boardTitleHeight: px("--spacing-3xl"),
    boardGap: px("--spacing-4xl"), rowGap: px("--spacing-6xl"),
  };
}

const leavesOf = (node: PlacementNode): readonly string[] => "leaves" in node ? node.leaves : node.children.flatMap(leavesOf);
/** An L1's lines: one per L2 child; an L1 that holds leaves directly is its own single line. */
const linesOf = (node: PlacementNode): { id: string; label: string; leaves: readonly string[] }[] =>
  "leaves" in node ? [{ id: node.id, label: node.label, leaves: node.leaves }] : node.children.map(child => ({ id: child.id, label: child.label, leaves: leavesOf(child) }));

/** Pure and deterministic: the same placements and metrics always give the same world rects. */
export function systemLayout(placements: readonly Placement[], metrics: SystemMetrics = defaultSystemMetrics()): SystemLayout {
  const m = metrics;
  const boards = new Map<string, SystemBoard>(), lines = new Map<string, SystemLine>(), cells = new Map<string, SystemCell>();
  const rows: SystemRow[] = [];
  let y = 0, widest = 0;
  for (const layer of SYSTEM_LAYER_ORDER) {
    const placement = placements.find(candidate => candidate.layer === layer);
    if (!placement) continue;
    const rowBoards: SystemBoard[] = [];
    const cellWidth = layer === "frames" ? m.frameCellWidth ?? m.cellWidth : m.cellWidth;
    const cellHeight = layer === "frames" ? m.frameCellHeight ?? m.cellHeight : m.cellHeight;
    let x = 0, rowHeight = 0;
    for (const node of placement.nodes) {
      const id = `${layer}/${node.id}`;
      const inner = { x: x + m.boardPadding, y: y + m.boardPadding + m.boardTitleHeight };
      const boardLines: SystemLine[] = [];
      let lineY = inner.y, longest = m.lineLabelWidth;
      for (const source of linesOf(node)) {
        const lineId = `${id}/${source.id}`;
        const lineCells = source.leaves.map((leaf, index): SystemCell => {
          if (cells.has(leaf)) throw new TypeError(`Leaf ${leaf} is placed twice on the system canvas`);
          const cell = { leaf, layer, l1: node.id, l2: source.id, board: id, line: lineId,
            rect: { x: inner.x + m.lineLabelWidth + m.cellGap + index * (cellWidth + m.cellGap), y: lineY, width: cellWidth, height: cellHeight } };
          cells.set(leaf, cell);
          return cell;
        });
        const width = m.lineLabelWidth + lineCells.length * (cellWidth + m.cellGap);
        longest = Math.max(longest, width);
        const line = { id: lineId, l2: source.id, label: source.label, cells: lineCells,
          rect: { x: inner.x, y: lineY, width, height: cellHeight },
          labelRect: { x: inner.x, y: lineY, width: m.lineLabelWidth, height: cellHeight } };
        lines.set(lineId, line); boardLines.push(line);
        lineY += cellHeight + m.lineGap;
      }
      const linesHeight = boardLines.length ? boardLines.length * cellHeight + (boardLines.length - 1) * m.lineGap : 0;
      const board = { id, layer, l1: node.id, label: node.label, lines: boardLines,
        rect: { x, y, width: longest + m.boardPadding * 2, height: m.boardTitleHeight + linesHeight + m.boardPadding * 2 } };
      boards.set(id, board); rowBoards.push(board);
      rowHeight = Math.max(rowHeight, board.rect.height);
      x += board.rect.width + m.boardGap;
    }
    const rowWidth = rowBoards.length ? x - m.boardGap : 0;
    rows.push({ layer, boards: rowBoards, rect: { x: 0, y, width: rowWidth, height: rowHeight } });
    widest = Math.max(widest, rowWidth);
    y += rowHeight + m.rowGap;
  }
  const height = rows.length ? y - m.rowGap : 0;
  return { rows, boards, lines, cells, bounds: { x: 0, y: 0, width: widest, height } };
}
