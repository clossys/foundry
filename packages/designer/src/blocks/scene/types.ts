import type { StatusMarkTone } from "../../components/StatusMark.js";

export type SceneDisorder = "none" | "low" | "medium";
export type SceneFormat = "pdf" | "email" | "sheet" | "doc" | "note" | "scan" | "calendar";
export interface SceneDocument { id: string; format: SceneFormat; title: string; origin?: string }
export interface SceneRow { id: string; label: string; value: string; status?: StatusMarkTone; figure?: boolean; quiet?: boolean }
export interface SceneStatus { tone: StatusMarkTone; text: string }
export interface ScenePerson { initials: string; name: string; note: string }
interface SceneBase { seed: string }
export interface SceneConverge extends SceneBase {
  template: "converge";
  disorder?: SceneDisorder;
  sources: { heading: string; items: readonly SceneDocument[] };
  target: { heading: string; title: string; meta?: string; rows: readonly SceneRow[] };
  relations: readonly { from: string; to: string; emphasis?: true }[];
}
export interface SceneEvidenceTrail extends SceneBase {
  template: "evidence-trail";
  disorder?: "none" | "low";
  sources: readonly (SceneDocument & { cites: string; cite: string })[];
  result: { title: string; meta?: string; rows: readonly SceneRow[]; status: SceneStatus; person?: ScenePerson };
}
export interface SceneFinding { id: string; fn: string; title: string; subjectOf: string; status: SceneStatus; subject?: true }
export interface SceneApprovalChain extends SceneBase {
  template: "approval-chain";
  disorder?: "none" | "low";
  prepared: { heading: string; meta?: string };
  findings: readonly SceneFinding[];
  node: { label: string };
  decision: { title: string; meta?: string; status: SceneStatus; rows: readonly SceneRow[]; person: ScenePerson };
}
/** Closed launch vocabulary; layout and style are owned by the renderer. */
export type SceneInput = SceneConverge | SceneEvidenceTrail | SceneApprovalChain;
export interface ScenePoint { x: number; y: number }
export interface ScenePart extends ScenePoint { id: string; width: number; height: number; nudge: number }
export interface SceneWire { from: string; to: string; start: ScenePoint; end: ScenePoint; path: string; subject: boolean; emphasis: boolean }
export interface SceneTerminal extends ScenePoint { id: string; subject: boolean }
export interface SceneTag extends ScenePart { text: string }
export interface SceneNode extends ScenePart { text: string }
export interface ScenePersonLayout extends ScenePart { marked: boolean }
/** User-unit geometry only: no DOM measurements, CSS or presentation data. */
export interface SceneLayout {
  width: number; height: number;
  docs: ScenePart[]; cards: ScenePart[]; wires: SceneWire[]; terminals: SceneTerminal[];
  tags: SceneTag[]; nodes: SceneNode[]; people: ScenePersonLayout[];
}
