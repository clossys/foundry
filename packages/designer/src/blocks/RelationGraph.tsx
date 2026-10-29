"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "../selected-components/Link.js";
import { Button } from "../selected-components/Button.js";
import { UI_BORDER_HAIRLINE } from "../selected-components/internal/ui-vars.js";
import { layoutRelationGraph, relationGraphHref } from "./relation-graph-layout.js";
import type { RelationGraphProps } from "./relation-graph-types.js";

const CLASSES = {
  control: "min-w-0 w-full justify-start text-start whitespace-normal wrap-anywhere motion-reduce:transition-none forced-colors:focus-visible:outline forced-colors:focus-visible:outline-solid",
  neighbours: "m-0 list-none p-0 text-caption text-ink-secondary",
  edgeLabel: "ms-xs",
  content: "min-w-0 max-w-full text-ink-primary",
  message: "m-0 text-body",
  scroll: "overflow-auto",
  frame: "relative",
  drawing: "pointer-events-none absolute hidden text-ink-muted tablet-lg:block",
  list: "relative m-0 flex list-none flex-col gap-lg p-0",
  layered: " tablet-lg:grid",
  node: "relative flex min-w-0 flex-col gap-sm rounded-panel bg-surface-raised p-md ",
  selected: "border-accent",
  unselected: "border-line-base",
  kind: "text-caption text-ink-secondary",
  status: "m-0 text-caption",
};

/** A bounded, host-authored Navigation Material; its list is the sole interactive surface. */
export function RelationGraph<Kind extends string>({ nodes, edges, kinds, label, selectedId, onSelectionChange,
  /** @default "No relationships" */ emptyMessage = "No relationships",
  /** @default "Drawing unavailable: cycle" */ unavailableMessage = "Drawing unavailable: cycle",
  /** @default "Incoming" */ incomingLabel = "Incoming",
  /** @default "Outgoing" */ outgoingLabel = "Outgoing",
  /** @default "Refused links" */ refusedLabel = "Refused links",
}: RelationGraphProps<Kind>) {
  const layout = layoutRelationGraph(nodes, edges, kinds);
  if (typeof label !== "string" || !label.trim()) throw new TypeError("RelationGraph: label is required.");
  if (selectedId !== undefined && !nodes.some(node => node.id === selectedId)) throw new TypeError("RelationGraph: selected id must refer to a node.");
  const [focusedId, setFocusedId] = useState(selectedId);
  const activeId = layout.order.some(node => node.id === focusedId) ? focusedId : layout.order[0]?.id;
  const frame = useRef<HTMLDivElement>(null), rows = useRef(new Map<string, HTMLLIElement>());
  const [geometry, setGeometry] = useState<{ nodes: typeof nodes; edges: typeof edges; left: number; width: number; height: number; paths: string[] }>();
  const drawing = geometry?.nodes === nodes && geometry.edges === edges ? geometry : undefined;
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    function measure() {
      if (frame.current !== element) return;
      const origin = element!.getBoundingClientRect();
      const rects = new Map([...rows.current].map(([id, node]) => [id, node.getBoundingClientRect()]));
      if (edges.some(edge => !rects.has(edge.from) || !rects.has(edge.to))) return;
      const left = Math.min(0, ...[...rects.values()].map(rect => rect.left - origin.left));
      const width = Math.max(origin.width, ...[...rects.values()].map(rect => rect.right - origin.left)) - left;
      const height = Math.max(origin.height, ...[...rects.values()].map(rect => rect.bottom - origin.top));
      const paths = edges.map(edge => {
        const from = rects.get(edge.from)!, to = rects.get(edge.to)!;
        const x = from.left + from.width / 2 - origin.left, y = from.top + from.height / 2 - origin.top;
        const tx = to.left + to.width / 2 - origin.left, ty = to.top + to.height / 2 - origin.top, middle = (x + tx) / 2;
        return `M${x},${y} C${middle},${y} ${middle},${ty} ${tx},${ty}`;
      });
      const next = { nodes, edges, left, width, height, paths };
      setGeometry(previous => previous?.nodes === nodes && previous.edges === edges && previous.left === left && previous.width === width && previous.height === height
        && previous.paths.length === paths.length && previous.paths.every((path, i) => path === paths[i]) ? previous : next);
    }
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    observer?.observe(element); for (const node of rows.current.values()) observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [nodes, edges]);
  function move(event: KeyboardEvent<HTMLElement>, id: string) {
    let target: string | undefined;
    switch (event.key) {
      case "ArrowRight": case "ArrowDown": target = layout.outgoing.get(id)![0]?.to; break;
      case "ArrowLeft": case "ArrowUp": target = layout.incoming.get(id)![0]?.from; break;
      case "Home": target = layout.order[0]?.id; break;
      case "End": target = layout.order.at(-1)?.id; break;
      case "PageDown": case "PageUp": {
        const index = nodes.findIndex(node => node.id === id);
        target = nodes[(index + (event.key === "PageDown" ? 1 : nodes.length - 1)) % nodes.length]?.id;
        break;
      }
      default: return;
    }
    event.preventDefault();
    if (target) { setFocusedId(target); rows.current.get(target)?.querySelector<HTMLElement>("[data-relation-graph-control]")?.focus(); }
  }
  function neighbours(id: string, incoming: boolean, neighbourLabel: string) {
    const relations = (incoming ? layout.incoming : layout.outgoing).get(id)!;
    if (!relations.length) return null;
    return <ul aria-label={neighbourLabel} className={CLASSES.neighbours}>
      {relations.map((edge, i) => <li key={i}><span>{nodes.find(node => node.id === (incoming ? edge.from : edge.to))!.label}</span>{edge.label ? <span className={CLASSES.edgeLabel}>{edge.label}</span> : null}</li>)}
    </ul>;
  }
  const refused = nodes.filter(node => node.href !== undefined && !relationGraphHref(node.href));
  return <div data-relation-graph-region="content" className={CLASSES.content}>
    {nodes.length === 0 ? <p role="status" className={CLASSES.message}>{emptyMessage}</p> : null}
    {layout.cyclic ? <p role="status" className={CLASSES.message}>{unavailableMessage}</p> : null}
    <div className={CLASSES.scroll}>
      <div ref={frame} className={CLASSES.frame}>
        <svg data-relation-graph-region="drawing" aria-hidden="true" focusable="false" className={CLASSES.drawing}
          viewBox={drawing ? `${drawing.left} 0 ${drawing.width || 1} ${drawing.height || 1}` : "0 0 1 1"}
          style={{ left: drawing?.left ?? 0, top: 0, width: drawing?.width ?? 0, height: drawing?.height ?? 0 }}>
          {!layout.cyclic && drawing ? drawing.paths.map((d, i) => <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={UI_BORDER_HAIRLINE} />) : null}
        </svg>
        <ul data-relation-graph-region="list" aria-label={label} className={CLASSES.list + (layout.cyclic ? "" : CLASSES.layered)}
          style={{ gridTemplateColumns: `repeat(${layout.layers || 1}, minmax(var(--ui-layout-sidebar-w, 256px), 1fr))`, gridAutoRows: "1fr" }}>
          {layout.order.map(node => {
            const position = layout.positions.get(node.id), isSelected = selectedId === node.id;
            const control = { "data-relation-graph-control": "", "aria-current": isSelected ? "true" as const : undefined,
              excludeFromTabOrder: node.id !== activeId, onFocus: () => setFocusedId(node.id),
              style: { minBlockSize: "var(--ui-layout-tap-target, 44px)" },
              onKeyDown: (event: KeyboardEvent<HTMLElement>) => move(event, node.id), onPress: () => onSelectionChange?.(node.id),
              className: CLASSES.control };
            return <li key={node.id} data-relation-graph-node={node.id} ref={element => { if (element) rows.current.set(node.id, element); else rows.current.delete(node.id); }}
              className={CLASSES.node + (isSelected ? CLASSES.selected : CLASSES.unselected)}
              style={{ gridColumn: position ? position.layer + 1 : undefined, gridRow: position ? position.row + 1 : undefined, borderStyle: "solid", borderWidth: UI_BORDER_HAIRLINE }}>
              <span className={CLASSES.kind}>{node.kind}</span>
              {relationGraphHref(node.href) ? <Link {...control} href={node.href} buttonVariant="ghost">{node.label}</Link> : <Button {...control} variant="ghost">{node.label}</Button>}
              {node.description ? <p className={CLASSES.message}>{node.description}</p> : null}
              {node.status ? <p className={CLASSES.status}>{node.status}</p> : null}
              {neighbours(node.id, true, incomingLabel)}{neighbours(node.id, false, outgoingLabel)}
            </li>;
          })}
        </ul>
      </div>
    </div>
    {refused.length ? <ul aria-label={refusedLabel} className={CLASSES.kind}>{refused.map(node => <li key={node.id}>{node.label}</li>)}</ul> : null}
  </div>;
}
