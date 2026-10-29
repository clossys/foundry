import type { CSSProperties, ReactNode } from "react";
import { cx } from "../../selected-components/internal/cx.js";
import { StatusMark } from "../../selected-components/StatusMark.js";
import { layoutScene, sceneRelationText } from "./geometry.js";
import type { SceneInput, SceneLayout, SceneRow, SceneStatus, ScenePerson, ScenePart, SceneFormat } from "./types.js";

export interface SceneProps {
  /** Caller-unique instance id; independent from the reusable geometry seed. */
  id: string;
  input: SceneInput;
  label: ReactNode;
  /** Authored label before each row's source list. */
  relationLabel?: ReactNode;
  headingLevel?: 3 | 4;
  sample?: ReactNode;
  className?: string;
}
const formats: Record<SceneFormat, string> = { pdf: "PDF", email: "EMAIL", sheet: "SHEET", doc: "DOC", note: "NOTE", scan: "SCAN", calendar: "CAL" };
const statusClasses = {
  success: "scene-status-success", warning: "scene-status-warning", danger: "scene-status-danger", info: "scene-status-info", neutral: "scene-status-neutral",
};
function hasContent(node: ReactNode): boolean {
  if (node === undefined || node === null || typeof node === "boolean") return false;
  if (typeof node === "string") return node.trim().length > 0;
  if (Array.isArray(node)) return node.some(hasContent);
  return true;
}
function short(text: string, length: number) { return text.length > length ? text.slice(0, length - 1) + "…" : text; }
function SvgStatus({ status, x, y }: { status: SceneStatus; x: number; y: number }) {
  const paths = { success: "M5 0a5 5 0 1 0 0 10a5 5 0 1 0 0-10Z", warning: "M5 0 10 10H0Z", danger: "M5 0 10 5 5 10 0 5Z", info: "M5 0a5 5 0 1 0 0 10a5 5 0 1 0 0-10ZM5 2a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z", neutral: "M1 4H9V6H1Z" };
  return <g className={statusClasses[status.tone]}><path className="scene-status-mark" d={paths[status.tone]} transform={"translate(" + x + " " + (y - 5) + ")"} fillRule="evenodd" /><text className="scene-status-text" x={x + 16} y={y + 4}>{status.text}</text></g>;
}
function SvgPerson({ person, geometry }: { person: ScenePerson; geometry: SceneLayout["people"][number] }) {
  const x = geometry.x + 18, y = geometry.y + geometry.height / 2;
  return <g><circle className="scene-person-disc" cx={x} cy={y} r={16} />{geometry.marked ? <circle className="scene-accent" cx={x} cy={y} r={22} /> : null}<text className="scene-initials" x={x} y={y + 4} textAnchor="middle">{person.initials}</text><text className="scene-title" x={x + 32} y={y - 3}>{person.name}</text><text className="scene-meta" x={x + 32} y={y + 15}>{person.note}</text></g>;
}
function SvgRows({ rows, card, head, pitch, offset }: { rows: readonly SceneRow[]; card: ScenePart; head: number; pitch: number; offset: number }) {
  return <>{rows.map((row, i) => { const top = card.y + head + i * pitch, y = top + pitch / 2 + 5; return <g key={row.id}><line className="scene-rule" x1={card.x + 16} x2={card.x + card.width - 16} y1={top} y2={top} /><text className={row.quiet ? "scene-label scene-secondary" : "scene-label"} x={card.x + 16} y={y}>{row.label}</text>{row.status ? <SvgStatus status={{ tone: row.status, text: row.value }} x={card.x + offset} y={y - 5} /> : <text className={cx(row.figure ? "scene-figure" : "scene-value", row.quiet && "scene-secondary")} x={card.x + offset} y={y}>{row.value}</text>}</g>; })}</>;
}
function Drawing({ input, layout }: { input: SceneInput; layout: SceneLayout }) {
  const card = layout.cards.at(-1)!;
  const content = input.template === "converge" ? input.target : input.template === "evidence-trail" ? input.result : input.decision;
  const head = input.template === "approval-chain" ? 84 : 72, pitch = input.template === "evidence-trail" ? 50 : 48;
  const offset = input.template === "evidence-trail" ? 128 : 150;
  return <svg aria-hidden="true" focusable="false" viewBox={"0 0 " + layout.width + " " + layout.height} className="scene-svg" style={{ "--sc-w": layout.width } as CSSProperties}>
    {input.template === "converge" ? <><text className="scene-column" x={24} y={20}>{input.sources.heading}</text><text className="scene-column" x={540} y={20}>{input.target.heading}</text></> : input.template === "approval-chain" ? <><text className="scene-column" x={14} y={20}>{input.prepared.heading}</text>{input.prepared.meta ? <text className="scene-meta" x={14} y={40}>{input.prepared.meta}</text> : null}</> : null}
    {layout.wires.map((w, i) => <path key={i} d={w.path} className={cx("scene-wire", w.subject && "scene-wire-subject", w.emphasis && "scene-accent")} />)}
    {layout.docs.map(d => { const doc = input.template === "converge" ? input.sources.items.find(s => s.id === d.id)! : input.template === "evidence-trail" ? input.sources.find(s => s.id === d.id)! : null; if (!doc) return null; return <g key={d.id} transform={"translate(" + d.x + " " + d.y + ")"}><rect className="scene-document" width={d.width} height={d.height} /><path className="scene-fold" d={"M " + (d.width - 14) + " 0 L " + (d.width - 14) + " 14 L " + d.width + " 14 Z"} /><rect className="scene-chip" x={12} y={9} width={formats[doc.format].length * 8 + 12} height={18} /><text className="scene-chip-text" x={18} y={22}>{formats[doc.format]}</text>{doc.origin ? <text className="scene-meta" x={formats[doc.format].length * 8 + 34} y={22}>{doc.origin}</text> : null}<text className="scene-title" x={12} y={45}>{short(doc.title, input.template === "converge" ? 28 : 22)}</text></g>; })}
    {input.template === "approval-chain" ? input.findings.map((f, i) => { const d = layout.cards[i]!; return <g key={f.id} transform={"translate(" + d.x + " " + d.y + ")"}><rect className={cx("scene-document", f.subject && "scene-subject-outline")} width={d.width} height={d.height} /><rect className="scene-chip" x={12} y={10} width={Math.min(f.fn.length, 12) * 8 + 14} height={20} /><text className="scene-chip-text" x={19} y={24}>{f.fn}</text><SvgStatus status={f.status} x={226} y={20} /><text className="scene-title" x={12} y={51}>{short(f.title, 40)}</text><text className="scene-meta" x={12} y={73}>{f.subjectOf}</text></g>; }) : null}
    <rect className="scene-panel" x={card.x} y={card.y} width={card.width} height={card.height} />
    <text className="scene-title" x={card.x + 16} y={card.y + 27}>{short(content.title, input.template === "evidence-trail" ? 24 : 28)}</text>
    {content.meta ? <text className="scene-meta" x={card.x + 16} y={card.y + 47}>{content.meta}</text> : null}
    {input.template === "approval-chain" ? <SvgStatus status={input.decision.status} x={card.x + 16} y={card.y + 65} /> : null}
    <SvgRows rows={content.rows} card={card} head={head} pitch={pitch} offset={offset} />
    {input.template === "evidence-trail" ? <SvgStatus status={input.result.status} x={card.x + 16} y={card.y + 72 + content.rows.length * 50 + 24} /> : null}
    {layout.terminals.map(t => <circle key={t.id} className={cx("scene-terminal", t.subject && "scene-terminal-subject")} cx={t.x} cy={t.y} r={4} />)}
    {layout.tags.map(t => <g key={t.id}><rect className="scene-tag" x={t.x} y={t.y} width={t.width} height={t.height} /><text className="scene-node-text" x={t.x + 7} y={t.y + 14}>{t.text}</text></g>)}
    {layout.nodes.map(n => <g key={n.id}><rect className="scene-node" x={n.x} y={n.y} width={n.width} height={n.height} /><text className="scene-node-text" x={n.x + n.width / 2} y={n.y + 23} textAnchor="middle">{n.text}</text></g>)}
    {layout.people.map(p => { const person = input.template === "evidence-trail" ? input.result.person : input.template === "approval-chain" ? input.decision.person : undefined; return person ? <SvgPerson key={p.id} person={person} geometry={p} /> : null; })}
  </svg>;
}
function Person({ person, marked }: { person: ScenePerson; marked: boolean }) { return <div className="scene-linear-person"><span className={cx("scene-linear-disc", marked && "scene-linear-mark")}>{person.initials}</span><div><p className="m-0 text-body font-medium text-ink-primary">{person.name}</p><p className="m-0 text-caption text-ink-secondary">{person.note}</p></div></div>; }
function Linear({ input, relationLabel }: { input: SceneInput; relationLabel?: ReactNode }) {
  const content = input.template === "converge" ? input.target : input.template === "evidence-trail" ? input.result : input.decision;
  const relations = sceneRelationText(input);
  return <div className="scene-linear" data-scene-linear="">
    {input.template === "converge" ? <p className="scene-linear-heading">{input.sources.heading} → {input.target.heading}</p> : null}
    {input.template === "approval-chain" ? <><p className="scene-linear-heading">{input.prepared.heading}</p>{input.prepared.meta ? <p className="m-0 text-caption text-ink-secondary">{input.prepared.meta}</p> : null}<ul className="scene-linear-findings">{input.findings.map((f, i) => <li key={f.id} className={cx("scene-linear-finding", f.subject && "scene-linear-subject")}><div className="flex items-center justify-between gap-sm"><span className="scene-linear-chip">{f.fn}</span><StatusMark tone={f.status.tone}>{f.status.text}</StatusMark></div><p className="m-0 text-body font-medium text-ink-primary">{f.title}</p><p className="m-0 text-caption text-ink-secondary">{f.subjectOf}</p><p className="sr-only">{relations[i]}</p></li>)}</ul><span className="scene-linear-connector" aria-hidden="true" /><p className="scene-linear-node">{input.node.label}</p><span className="scene-linear-connector" aria-hidden="true" /></> : null}
    <div className="scene-linear-panel"><div className="scene-linear-head"><p className="m-0 text-body font-medium text-ink-primary">{content.title}</p>{content.meta ? <p className="m-0 text-caption text-ink-secondary">{content.meta}</p> : null}{input.template === "approval-chain" ? <StatusMark tone={input.decision.status.tone}>{input.decision.status.text}</StatusMark> : null}</div>
      <ul className="scene-linear-rows">{content.rows.map(row => {
        const docs = input.template === "converge" ? input.sources.items.filter(d => input.relations.some(r => r.from === d.id && r.to === row.id)) : input.template === "evidence-trail" ? input.sources.filter(d => d.cites === row.id) : [];
        return <li key={row.id} data-scene-row=""><div className="scene-linear-row"><span className={cx("text-body-s", row.quiet ? "text-ink-secondary" : "text-ink-primary")}>{row.label}</span>{row.status ? <StatusMark tone={row.status}>{row.value}</StatusMark> : <span className={cx(row.figure ? "font-mono text-h2 tabular-nums" : "text-body-s", row.quiet ? "text-ink-secondary" : "text-ink-primary")}>{row.value}</span>}</div>{docs.length ? <div className="text-caption text-ink-secondary">{relationLabel !== undefined ? <p className="m-0">{relationLabel}</p> : null}<ul className="scene-linear-sources">{docs.map(d => <li key={d.id}>{formats[d.format]} · {d.title}{d.origin ? " · " + d.origin : ""}{"cite" in d ? " · " + d.cite : ""}</li>)}</ul></div> : null}</li>;
      })}</ul>
      {input.template === "evidence-trail" ? <div className="scene-linear-status"><StatusMark tone={input.result.status.tone}>{input.result.status.text}</StatusMark></div> : null}
      {input.template === "approval-chain" ? <Person person={input.decision.person} marked /> : input.template === "evidence-trail" && input.result.person ? <Person person={input.result.person} marked={false} /> : null}
    </div>
  </div>;
}
/** Static process illustration with a complete linear HTML form at every width. */
export function Scene({ id, input, label, relationLabel, sample, className }: SceneProps) {
  if (typeof id !== "string" || !id || /\s/.test(id) || !hasContent(label)) throw new TypeError("Scene: caller instance id and authored figure label are required.");
  const layout = layoutScene(input);
  const labelId = `${id}-label`;
  return <figure className={cx("scene-root", className)} data-template={input.template} aria-labelledby={labelId}><p id={labelId} className="sr-only">{label}</p><div className="scene-desktop" data-scene-desk=""><Drawing input={input} layout={layout} /></div><Linear input={input} relationLabel={relationLabel} />{hasContent(sample) ? <figcaption className="scene-caption">{sample}</figcaption> : null}</figure>;
}
