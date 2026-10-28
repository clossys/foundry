import type { ReactNode } from "react";
/** Agent-owned history facts. This page never invokes a write command. */
export interface DesignerHistoryRow { readonly index: number; readonly command: string; readonly contentHash: string; readonly inputs: Readonly<Record<string, unknown>> }
export interface DesignerAgentData {
  readonly changeCommandFor?: (leaf: string) => string | undefined;
  readonly writeHistory?: (leaf: string) => readonly DesignerHistoryRow[];
  readonly decisions?: Readonly<Record<string, { readonly reason: string }>>;
  readonly renderStaticThumbnail?: (leaf: string) => ReactNode;
}
export interface InspectorFill { readonly source?: string; readonly pin?: unknown; readonly origin?: string; readonly status?: string; readonly constituents?: readonly string[]; readonly root?: string }
export interface InspectorIdentity { readonly id: string; readonly layer: string; readonly path: readonly string[]; readonly status: string; readonly fill: InspectorFill }
