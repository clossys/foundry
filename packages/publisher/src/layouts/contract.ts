import type { ArrangementModel, LayoutId } from "./ids.js";

export type SectionLeafId = `sections.${string}`;
export type LayoutSpan = "1x1" | "2x1" | "1x2" | "2x2";
export type LayoutRead = "tokens.spacing" | "tokens.gutter" | "tokens.content-size" | "tokens.region-width" | "tokens.breakpoint";
export type LayoutBreakpoint = "mobile" | "mobile-lg" | "tablet" | "tablet-lg" | "desktop" | "wide";
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
  readonly reflow: readonly { readonly at: `tokens.breakpoint.${LayoutBreakpoint}`; readonly columns: number; readonly spans?: "clamp" }[];
  readonly allowedReads: readonly LayoutRead[];
  readonly requiresSection?: { readonly container: "adaptive" };
}
export interface LayoutLeaf {
  readonly id: LayoutId;
  readonly layer: "layouts";
  readonly contract: PageLayoutContract;
  readonly requires: readonly string[];
  readonly status: "draft" | "stable" | "held" | "deprecated";
}
export interface LayoutIA {
  readonly layer: "layouts";
  readonly nodes: readonly {
    readonly id: ArrangementModel;
    readonly label: string;
    readonly children: readonly {
      readonly id: string;
      readonly label: string;
      readonly leaves: readonly LayoutId[];
    }[];
  }[];
}
export interface RetiredLayout {
  readonly replacedBy: LayoutId;
  readonly config?: string;
}
export interface LayoutFinding {
  readonly code: "id" | "contract" | "section" | "config" | "ia" | "retired";
  readonly subject: string;
  readonly message: string;
}
