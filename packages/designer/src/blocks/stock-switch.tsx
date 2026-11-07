"use client";

import { useId, type ComponentProps, type ReactNode } from "react";

import { componentLeaf } from "../runtime/component-leaf.js";

type StockSwitchModule = typeof import("../components/preview-runtime/components/switch/switch.js");
const Switch = componentLeaf<StockSwitchModule["Switch"]>("components.switch");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

export type StockSwitchProps = Omit<ComponentProps<StockSwitchModule["Switch"]>, "children" | "aria-labelledby"> & {
  /** The visible label beside the track; also the switch's accessible name. */
  readonly children: ReactNode;
};

/**
 * One labelled stock shadcn@aria switch, resolved through the selected components.switch leaf. The stock
 * switch draws its children inside the track, so the label is selected SemanticContent beside it that names
 * the switch by id.
 */
export function StockSwitch({ children, ...props }: StockSwitchProps) {
  const labelId = useId();
  return <SemanticContent as="span" className="inline-flex items-center gap-sm text-body text-ink-primary">
    <Switch {...props} aria-labelledby={labelId} />
    <SemanticContent as="span" id={labelId}>{children}</SemanticContent>
  </SemanticContent>;
}
