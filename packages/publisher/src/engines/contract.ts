import type { TailwindBreakpoint } from "@clossys/designer/catalog";
import type { EngineKey } from "./keys.js";

export type SectionLeafId = `sections.${string}`;
export type LayoutSpan = "1x1" | "2x1" | "1x2" | "2x2";
export type LayoutRead = "themes.spacing";
export type LayoutBreakpoint = TailwindBreakpoint;
export interface LayoutSlot {
  readonly id: string;
  readonly accepts: readonly SectionLeafId[];
  readonly min: number;
  readonly max: number;
  readonly position: "first" | "any" | "last";
  readonly tile?: { readonly spans: readonly LayoutSpan[] };
  readonly previewShape: "bar" | "panel" | "rail" | "tile";
}
export interface LayoutConfig {
  readonly id: string;
  readonly members: Readonly<Record<string, string>>;
  readonly slotOverrides?: Readonly<Record<string, {
    readonly accepts?: readonly SectionLeafId[];
    readonly min?: number;
    readonly max?: number;
  }>>;
}
export interface PageLayoutContract {
  readonly kind: "layout";
  readonly arrangement: "page";
  readonly surface: "site" | "app" | "both";
  readonly slots: readonly LayoutSlot[];
  readonly members: Readonly<Record<string, readonly string[]>>;
  readonly configs: readonly LayoutConfig[];
  readonly reflow: readonly { readonly at: LayoutBreakpoint; readonly columns: number; readonly spans?: "clamp" }[];
  readonly allowedReads: readonly LayoutRead[];
  readonly requiresSection?: { readonly container: "adaptive" };
}
/** A render engine: an internal primitive keyed by its engine key, with no slot identity, layer or pin. */
export interface LayoutEngine {
  readonly engine: EngineKey;
  readonly contract: PageLayoutContract;
  readonly requires: readonly string[];
  readonly status: "draft" | "stable" | "held" | "deprecated";
}
export interface LayoutFinding {
  readonly code: "id" | "contract" | "section" | "config";
  readonly subject: string;
  readonly message: string;
}
