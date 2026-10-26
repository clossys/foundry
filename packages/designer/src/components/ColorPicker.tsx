"use client";
import { createContext, forwardRef, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ColorPicker as AriaColorPicker, ColorArea, ColorWheel, ColorWheelTrack, ColorSlider, SliderTrack, ColorThumb, ColorField, Input, Label, ColorSwatchPicker, ColorSwatchPickerItem, ColorSwatch, type ColorPickerProps as AriaColorPickerProps, type ColorAreaProps, type ColorWheelProps, type ColorSliderProps, type ColorFieldProps, type ColorSwatchPickerProps, type ColorSwatchPickerItemProps } from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";
type ControlSize = "sm" | "md" | "lg";
export interface ColorPickerProps extends AriaColorPickerProps { size?: ControlSize }
const SizeContext = createContext<ControlSize>("md");
const height = (size: ControlSize) => `var(--ui-control-h-${size})`;
/** Root is a context provider, matching RAC; it does not invent a DOM ref. */
function Root({ size = "md", ...props }: ColorPickerProps) { return <SizeContext.Provider value={size}><AriaColorPicker {...props} /></SizeContext.Provider>; }
function Thumb() { return <ColorThumb className="border border-line-base rounded-full forced-colors:outline" style={state => ({ width: "var(--ui-control-mark)", height: "var(--ui-control-mark)", boxShadow: state.isFocusVisible ? UI_RING_FOCUS : undefined })} />; }
const Area = forwardRef<HTMLDivElement, ColorAreaProps>(function Area({ children, style, ...props }, ref) {
  const size = useContext(SizeContext);
  return <ColorArea {...props} ref={ref} style={state => ({ inlineSize: `calc(${height(size)} * 4)`, blockSize: `calc(${height(size)} * 4)`, opacity: state.isDisabled ? UI_ALPHA_DISABLED : undefined, ...(typeof style === "function" ? style(state) : style) })}>{children ?? <Thumb />}</ColorArea>;
});
type WheelProps = Omit<ColorWheelProps, "outerRadius" | "innerRadius"> & { outerRadius?: number; innerRadius?: number };
/** Native wheel radii are measured from the token-sized frame. */
const Wheel = forwardRef<HTMLDivElement, WheelProps>(function Wheel({ children, outerRadius, innerRadius, style, ...props }, ref) {
  const size = useContext(SizeContext), frame = useRef<HTMLDivElement>(null);
  const [radius, setRadius] = useState(1);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => { const width = element.getBoundingClientRect().width; if (width > 0) setRadius(width / 2); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={frame} style={{ inlineSize: `calc(${height(size)} * 4)`, blockSize: `calc(${height(size)} * 4)` }}><ColorWheel {...props} ref={ref} outerRadius={outerRadius ?? radius} innerRadius={innerRadius ?? radius * .75} style={state => ({ inlineSize: "100%", blockSize: "100%", opacity: state.isDisabled ? UI_ALPHA_DISABLED : undefined, ...(typeof style === "function" ? style(state) : style) })}>{children ?? <><ColorWheelTrack /><Thumb /></>}</ColorWheel></div>;
});
const Slider = forwardRef<HTMLDivElement, ColorSliderProps & { label: ReactNode }>(function Slider({ label, children, className, ...props }, ref) {
  const size = useContext(SizeContext);
  return <ColorSlider {...props} ref={ref} className={state => cx("flex flex-col gap-sm text-body text-ink-primary font-body", typeof className === "function" ? className(state) : className)}>{state => <><Label>{label}</Label>{typeof children === "function" ? children(state) : children ?? <SliderTrack style={{ blockSize: height(size), minInlineSize: `calc(${height(size)} * 4)` }}><Thumb /></SliderTrack>}</>}</ColorSlider>;
});
const Field = forwardRef<HTMLDivElement, Omit<ColorFieldProps, "children"> & { label: ReactNode }>(function Field({ label, className, ...props }, ref) {
  const size = useContext(SizeContext);
  return <ColorField {...props} ref={ref} className={state => cx("flex flex-col gap-xs text-body font-body text-ink-primary", typeof className === "function" ? className(state) : className)}><Label className="text-caption text-ink-secondary">{label}</Label><Input className="border border-line-base bg-surface-raised rounded-control px-sm outline-none forced-colors:outline" style={({ isFocusVisible }) => ({ minBlockSize: height(size), boxShadow: isFocusVisible ? UI_RING_FOCUS : undefined })} /></ColorField>;
});
const SwatchPicker = forwardRef<HTMLDivElement, ColorSwatchPickerProps>(function SwatchPicker({ className, ...props }, ref) { return <ColorSwatchPicker {...props} ref={ref} className={state => cx("flex flex-wrap gap-sm", typeof className === "function" ? className(state) : className)} />; });
const Swatch = forwardRef<HTMLDivElement, ColorSwatchPickerItemProps>(function Swatch({ children, style, ...props }, ref) {
  return <ColorSwatchPickerItem {...props} ref={ref} style={state => ({ minInlineSize: "var(--ui-layout-tap-target)", minBlockSize: "var(--ui-layout-tap-target)", boxShadow: state.isFocusVisible ? UI_RING_FOCUS : undefined, ...(typeof style === "function" ? style(state) : style) })}>{children ?? <ColorSwatch style={{ inlineSize: "var(--ui-layout-tap-target)", blockSize: "var(--ui-layout-tap-target)" }} />}</ColorSwatchPickerItem>;
});
/** Inspectable compound controls. Craft qualification is required before catalog adoption. */
export const ColorPicker = Object.assign(Root, { Area, Wheel, Slider, Field, SwatchPicker, Swatch });
