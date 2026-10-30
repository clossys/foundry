import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { StatusMark } from "../atoms/StatusMark.js";
import { cx } from "../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_BORDER_RULE } from "../atoms/internal/ui-vars.js";
import { layoutFlowCanvas, type FlowCanvasEdge, type FlowCanvasNode, type FlowCanvasOrientation } from "./flow-canvas-layout.js";

export interface FlowCanvasProps {
  /** The diagram's boxes. Their order sets tie-breaks in the layout; reading order follows the drawing. */
  nodes: readonly FlowCanvasNode[];
  /** Directed connections between `nodes` ids. */
  edges: readonly FlowCanvasEdge[];
  /** Required. The accessible name of the node list, the diagram's semantic source. */
  label: string;
  /** Required. Shown instead of the diagram when `nodes` is empty. */
  emptyMessage: ReactNode;
  /** Required. Introduces each node's outgoing edges in its description ("Leads to"). */
  outgoingLabel: ReactNode;
  /**
   * Which way layers run. Choose `"vertical"` for a narrow region; either way
   * the canvas scrolls rather than clipping when it is wider than its host.
   * @default "horizontal"
   */
  orientation?: FlowCanvasOrientation;
  /** The selected node id, controlled by the host. An id that is not in `nodes` selects nothing. */
  selectedId?: string | null;
  /** Called with a node's id when it is activated by click, Enter or Space. Focus alone never selects. */
  onSelect?: (id: string) => void;
  className?: string;
}

/** One layout unit. Every position and size on the canvas is a multiple of it. */
const UNIT = "var(--spacing-xs, 4px)";
const units = (value: number) => "calc(" + value + " * " + UNIT + ")";

/** Forced colors flatten border colours; a dashed selected perimeter distinguishes selection from the solid keyboard-focus outline. */
const SELECTED_FORCED = "forced-colors:border-dashed forced-colors:outline-solid forced-colors:outline-2 forced-colors:outline-offset-2 forced-colors:outline-current";

/**
 * The canvas's own direction: the closest `dir`, as `:dir()` reads it, so a
 * local `dir` overrides the document's. The drawing's mirror
 * (`flow-canvas-drawing`) is keyed on the same `:dir(rtl)` of the drawing
 * itself, never on an ancestor's `[dir]`, and the node positions are logical
 * insets. Engines without `:dir()` fall back to the closest `dir` attribute.
 */
function isRtl(element: Element) {
  try { return element.matches(":dir(rtl)"); }
  catch { return element.closest("[dir]")?.getAttribute("dir")?.toLowerCase() === "rtl"; }
}

const PLATE = "box-border flex h-full w-full min-w-0 flex-col items-start justify-start gap-xs overflow-hidden rounded-panel border-solid p-sm text-start font-body forced-colors:border-current focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent";

/**
 * A node-and-edge diagram: boxes in layers joined by arrowed edges, laid out
 * deterministically from the props alone (see `layoutFlowCanvas`), so the
 * server renders the finished drawing and hydration changes nothing.
 *
 * The semantic source is an ordered list of nodes in reading order. Each
 * node is a native button named by its label and described by its kind, its
 * status and the nodes it leads to, with any edge labels, so the diagram
 * reads the same without the picture. The SVG lines, arrowheads and edge
 * label boxes are presentation and hidden from assistive technology.
 *
 * The node list is one tab stop. Arrow keys along the layer direction follow
 * edges forward and back (returning along the path just taken where it can),
 * arrow keys across it move between nodes in the same layer, and Home and End
 * jump to the first and last node. Inline keys, the drawing and the node
 * positions all follow the canvas's closest `dir`, so they mirror together in
 * RTL and a local `dir` overrides the document's. Enter, Space or a click
 * calls `onSelect`; the host owns `selectedId`. The canvas has no motion, and scrolls inside its own
 * viewport at narrow widths. Every visible word comes from props.
 */
export function FlowCanvas({ nodes, edges, label, emptyMessage, outgoingLabel, orientation = "horizontal", selectedId, onSelect, className }: FlowCanvasProps) {
  const layout = useMemo(() => layoutFlowCanvas(nodes, edges, { orientation }), [nodes, edges, orientation]);
  const base = useId();
  const [focusedId, setFocusedId] = useState<string>();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const trail = useRef({ forward: new Map<string, string>(), back: new Map<string, string>() });

  const graph = useMemo(() => {
    const byId = new Map(nodes.map((node, index) => [node.id, { node, index }]));
    const successors = new Map<string, string[]>(), predecessors = new Map<string, string[]>();
    const outgoing = new Map<string, { target: FlowCanvasNode; label?: string }[]>();
    for (const edge of edges) {
      successors.set(edge.from, [...(successors.get(edge.from) ?? []), edge.to]);
      predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge.from]);
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), { target: byId.get(edge.to)!.node, label: edge.label }]);
    }
    const layers = new Map<number, string[]>();
    for (const node of layout.nodes) layers.set(node.layer, [...(layers.get(node.layer) ?? []), node.id]);
    return { byId, successors, predecessors, outgoing, layers };
  }, [nodes, edges, layout]);

  const selected = selectedId != null && graph.byId.has(selectedId) ? selectedId : undefined;
  const tabStop = focusedId !== undefined && graph.byId.has(focusedId) ? focusedId : selected ?? layout.nodes[0]?.id;

  if (layout.nodes.length === 0) {
    return (
      <div className={cx("min-w-0 max-w-full", className)} data-flowchart-region="content" data-orientation={orientation}>
        <p className="text-body-s text-ink-secondary">{emptyMessage}</p>
      </div>
    );
  }

  const move = (from: string, to: string | undefined) => {
    if (to === undefined || to === from) return;
    setFocusedId(to);
    buttons.current.get(to)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    // Modified arrows belong to the browser and the platform (Alt+Arrow is history navigation), so leave them alone.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = (event.target as HTMLElement).closest<HTMLElement>("[data-flowchart-node]")?.dataset.flowchartNode;
    if (current === undefined || !graph.byId.has(current)) return;
    const rtl = isRtl(event.currentTarget);
    const vertical = layout.orientation === "vertical";
    const inlineNext = rtl ? "ArrowLeft" : "ArrowRight", inlinePrevious = rtl ? "ArrowRight" : "ArrowLeft";
    const forwardKey = vertical ? "ArrowDown" : inlineNext, backKey = vertical ? "ArrowUp" : inlinePrevious;
    const nextKey = vertical ? inlineNext : "ArrowDown", previousKey = vertical ? inlinePrevious : "ArrowUp";
    const { forward, back } = trail.current;
    const layer = graph.layers.get(layout.nodes.find(node => node.id === current)!.layer)!;
    let target: string | undefined;
    if (event.key === forwardKey) {
      const options = graph.successors.get(current) ?? [];
      const remembered = forward.get(current);
      target = remembered !== undefined && options.includes(remembered) ? remembered : options[0];
      if (target !== undefined) { forward.set(current, target); back.set(target, current); }
    } else if (event.key === backKey) {
      const options = graph.predecessors.get(current) ?? [];
      const remembered = back.get(current);
      target = remembered !== undefined && options.includes(remembered) ? remembered : options[0];
      if (target !== undefined) { back.set(current, target); forward.set(target, current); }
    } else if (event.key === nextKey) target = layer[layer.indexOf(current) + 1];
    else if (event.key === previousKey) target = layer[layer.indexOf(current) - 1];
    else if (event.key === "Home") target = layout.nodes[0]!.id;
    else if (event.key === "End") target = layout.nodes[layout.nodes.length - 1]!.id;
    else return;
    event.preventDefault();
    move(current, target);
  };

  const incident = (edge: FlowCanvasEdge) => selected !== undefined && (edge.from === selected || edge.to === selected);

  return (
    <div className={cx("min-w-0 max-w-full", className)} data-flowchart-region="content" data-orientation={layout.orientation}>
      <div className="max-w-full overflow-auto rounded-panel bg-surface-base" data-flowchart-region="viewport">
        <div className="relative" style={{ inlineSize: units(layout.width), blockSize: units(layout.height) }}>
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox={"0 0 " + layout.width + " " + layout.height}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full flow-canvas-drawing"
            data-flowchart-region="drawing"
            data-flowchart-drawing=""
          >
            {layout.edges.map((edge, i) => {
              const highlighted = incident(edges[i]!);
              return (
                <g key={i}>
                  <path
                    d={edge.path}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    className={cx(highlighted ? "stroke-accent" : "stroke-ink-muted", "forced-colors:stroke-current")}
                    style={{ strokeWidth: highlighted ? UI_BORDER_RULE : UI_BORDER_HAIRLINE }}
                    data-flowchart-edge={i}
                    data-selected={highlighted ? "" : undefined}
                  />
                  <path d={edge.arrow} className={cx(highlighted ? "fill-accent" : "fill-ink-muted", "forced-colors:fill-current")} data-flowchart-arrow={i} />
                </g>
              );
            })}
          </svg>
          <div aria-hidden="true" className="pointer-events-none" data-flowchart-region="edge-labels">
            {layout.edges.map((edge, i) => edge.label === undefined ? null : (
              <span
                key={i}
                className="absolute flex min-w-0 items-center justify-center"
                style={{ insetInlineStart: units(edge.label.x), top: units(edge.label.y), inlineSize: units(edge.label.width), blockSize: units(edge.label.height) }}
              >
                <span className="max-w-full truncate rounded-panel bg-surface-base px-xs text-caption text-ink-secondary">{edges[i]!.label}</span>
              </span>
            ))}
          </div>
          <ol aria-label={label} className="m-0 list-none p-0" data-flowchart-region="nodes" onKeyDown={onKeyDown}>
            {layout.nodes.map(placed => {
              const { node, index } = graph.byId.get(placed.id)!;
              // Plain concatenation, not template literals, so the class scanner reads every literal here. Numeric suffixes keep ids free of words: 0 label, 1 kind, 2 status, 3 outgoing edges.
              const id = base + "-" + index;
              const labelId = id + "-0";
              const isSelected = placed.id === selected;
              const outgoing = graph.outgoing.get(placed.id) ?? [];
              const describedBy = [node.kind !== undefined && id + "-1", node.status !== undefined && id + "-2", outgoing.length > 0 && id + "-3"].filter(Boolean).join(" ");
              return (
                <li
                  key={placed.id}
                  className="absolute"
                  style={{ insetInlineStart: units(placed.x), top: units(placed.y), inlineSize: units(placed.width), blockSize: units(placed.height) }}
                  data-flowchart-node={placed.id}
                  data-kind={node.kind}
                >
                  <button
                    type="button"
                    ref={element => { if (element) buttons.current.set(placed.id, element); else buttons.current.delete(placed.id); }}
                    tabIndex={placed.id === tabStop ? 0 : -1}
                    aria-labelledby={labelId}
                    aria-describedby={describedBy || undefined}
                    aria-current={isSelected ? "true" : undefined}
                    className={cx(PLATE, isSelected ? cx("border-accent bg-surface-selected", SELECTED_FORCED) : "border-line-panel bg-surface-raised hover:bg-surface-sunken")}
                    style={{ borderWidth: isSelected ? UI_BORDER_RULE : UI_BORDER_HAIRLINE }}
                    onFocus={() => setFocusedId(placed.id)}
                    onClick={() => onSelect?.(placed.id)}
                  >
                    {node.kind !== undefined && <span id={id + "-1"} className="block max-w-full truncate text-caption text-ink-secondary">{node.kind}</span>}
                    <span id={labelId} className="line-clamp-2 max-w-full text-body-s font-semibold text-ink-primary">{node.label}</span>
                    {node.status !== undefined && <StatusMark id={id + "-2"} tone={node.status.tone} className="max-w-full">{node.status.label}</StatusMark>}
                  </button>
                  {outgoing.length > 0 && (
                    <div id={id + "-3"} className="sr-only">
                      {outgoingLabel}
                      <ul>
                        {outgoing.map((link, i) => <li key={i}>{link.target.label}{link.label !== undefined && <>{", "}{link.label}</>}</li>)}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
