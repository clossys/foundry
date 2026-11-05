"use client";
import { Children, cloneElement, forwardRef, isValidElement, type ForwardedRef, type ReactElement, type ReactNode, type RefAttributes } from "react";
import {
  Label,
  Slider as AriaSlider,
  SliderFill,
  SliderOutput,
  SliderThumb,
  SliderTrack,
  type SliderProps as AriaSliderProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";

/** One value for a single thumb; an array of values for a range with one thumb per entry. */
export type SliderValue = number | number[];

export interface SliderProps<T extends SliderValue = SliderValue> extends Omit<AriaSliderProps<T>, "children" | "className" | "style"> {
  /** Required visible label; it names the slider group and every thumb. */
  label: ReactNode;
  /**
   * One host-supplied name per thumb, required for a range (two or more
   * values) so each thumb is announced distinctly ("Minimum", "Maximum").
   */
  thumbLabels?: readonly string[];
  /** Shows the formatted value (or range) next to the label. Defaults to true. */
  showValue?: boolean;
  /** Host-owned visible and spoken copy for each numeric value. */
  formatValue?: (value: number, index: number) => string;
  /** Merged onto the outer wrapper. */
  className?: string;
}

const AXIS = {
  horizontal: {
    root: "flex w-full flex-col gap-xs",
    track: "control-h-md flex w-full items-center",
    rail: "slider-rail",
    thumb: "top-1/2",
  },
  vertical: {
    root: "inline-flex flex-col items-center gap-xs",
    track: "slider-track-vertical tap-target flex flex-col items-center",
    rail: "slider-rail-vertical",
    thumb: "slider-thumb-vertical",
  },
} as const;

const RAIL = "overflow-hidden rounded-pill bg-surface-sunken";
const FILL = "rounded-pill bg-action";
const THUMB = "slider-thumb rounded-pill border border-action bg-surface-raised focus-ring transition-colors motion-reduce:transition-none";

function thumbCount(value: SliderValue | undefined): number {
  return Array.isArray(value) ? value.length : 1;
}

/** Use the peer's render port to change only spoken copy, retaining its native input and handlers. */
function withSpokenValue(children: ReactNode, text: string): ReactNode {
  let inputs = 0;
  const visit = (nodes: ReactNode): ReactNode => Children.map(nodes, child => {
    if (!isValidElement<{ children?: ReactNode; type?: string; "aria-valuetext"?: string }>(child)) return child;
    if (child.type === "input" && child.props.type === "range") {
      inputs++;
      return cloneElement(child, { "aria-valuetext": text });
    }
    return child.props.children === undefined ? child : cloneElement(child, { children: visit(child.props.children) });
  });
  const result = visit(children);
  if (inputs !== 1) throw new TypeError("Slider.formatValue.input");
  return result;
}

function SliderImpl<T extends SliderValue>(
  { label, thumbLabels, showValue = true, formatValue, className, orientation = "horizontal", ...props }: SliderProps<T>,
  ref: ForwardedRef<HTMLDivElement>,
) {
  const count = thumbCount(props.value ?? props.defaultValue);
  if (count > 1 && (thumbLabels?.length !== count || thumbLabels.some((name) => !name.trim()))) {
    throw new TypeError("Slider range requires one thumb label per value.");
  }
  const axis = AXIS[orientation];
  return (
    <AriaSlider<T>
      {...props}
      ref={ref}
      orientation={orientation}
      className={({ isDisabled }) => cx(axis.root, isDisabled && "control-disabled", className)}
    >
      {({ state }) => (
        <>
          <div className="flex items-center justify-between gap-sm">
            <Label className="text-body-s text-ink-secondary font-body">{label}</Label>
            {showValue ? <SliderOutput className="text-body-s text-ink-muted tabular-nums font-body">{formatValue ? state.values.map(formatValue).join(" ") : undefined}</SliderOutput> : null}
          </div>
          <SliderTrack data-part="slider-track" className={axis.track}>
            <div data-part="slider-rail" className={cx(axis.rail, RAIL)}>
              <SliderFill data-part="slider-fill" className={FILL} />
            </div>
            {state.values.map((_, index) => (
              <SliderThumb
                key={index}
                index={index}
                data-part="slider-thumb"
                aria-label={count > 1 ? thumbLabels![index] : undefined}
                render={formatValue ? props => <div {...props}>{withSpokenValue(props.children, formatValue(state.values[index]!, index))}</div> : undefined}
                className={cx(THUMB, axis.thumb)}
              />
            ))}
          </SliderTrack>
        </>
      )}
    </AriaSlider>
  );
}

/**
 * A single value or a range on one track, built on react-aria-components'
 * `Slider`/`SliderTrack`/`SliderFill`/`SliderThumb`/`SliderOutput`: each thumb
 * is a real `role="slider"` input with `aria-valuenow`/`aria-valuetext`,
 * Arrow/Page/Home/End keys, pointer dragging and track presses, all owned by
 * the peer rather than re-implemented here. Every class is a named, token-bound
 * utility: the rail reads the sunken surface, the fill the action colour, the
 * thumb the raised surface with an action border, and focus uses the shared
 * `focus-ring`. The only inline geometry is the peer's own thumb and fill
 * positioning (a continuously variable percentage).
 */
export const Slider = forwardRef(SliderImpl) as <T extends SliderValue = SliderValue>(
  props: SliderProps<T> & RefAttributes<HTMLDivElement>,
) => ReactElement | null;
