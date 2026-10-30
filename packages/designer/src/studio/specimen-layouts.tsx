"use client";

import type { ReactNode } from "react";
import type { DesignerSpecimenContext, DesignerSpecimenNeed } from "./DesignerSpecimen.js";

/** Layout is an intrinsic property of a registered specimen leaf. */
export type SpecimenLayout = "single" | "ladder" | "grid" | "matrix";
export type SpecimenLeafId = `sections.specimen-${string}`;
export interface SpecimenAxisValue { readonly id: string; readonly label: string }
export interface SpecimenAxis { readonly id: string; readonly label: string; readonly values: readonly SpecimenAxisValue[] }
/** Cell-authored data, never a React render function. Coordinates refer to the leaf's declared axes. */
export interface SpecimenItem<Value = unknown> {
  readonly id: string;
  readonly label: string;
  readonly value: Value;
  readonly coordinates?: Readonly<Record<string, string>>;
}
export interface SpecimenLabels { readonly showAllVariants: (count: number) => ReactNode }
export interface SpecimenLeafProps<Value = unknown> {
  readonly items: readonly SpecimenItem<Value>[];
  readonly axes?: readonly SpecimenAxis[];
  readonly context: DesignerSpecimenContext;
  readonly need: (need: DesignerSpecimenNeed) => ReactNode;
  /** Link-out hosts pass true: all items render expanded at full size. */
  readonly expanded?: boolean;
  readonly labels: SpecimenLabels;
}
export interface SpecimenLeafDefinition {
  readonly id: SpecimenLeafId;
  readonly layout: SpecimenLayout;
  readonly compatible: readonly { readonly kind: string; readonly layer?: string }[];
  /** Executable implementation owned by the leaf; Studio only dispatches its id and data. */
  render(props: SpecimenLeafProps): ReactNode;
}
/** Internal rendering section shared by the intrinsic leaf implementations, never cell input. */
export interface SpecimenSection {
  readonly id: string;
  readonly label: string;
  readonly layout: SpecimenLayout;
  readonly axes: readonly SpecimenAxis[];
  readonly items: readonly SpecimenItem[];
}
