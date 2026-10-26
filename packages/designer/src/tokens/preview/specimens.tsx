"use client";

import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Card } from "../../components/Card.js";
import { Toggle } from "../../components/toggle-button/index.js";
import { unsafeText } from "../../catalog-core/model.js";
import type { ResolvedMember } from "../../catalog-core/types.js";
import { TOKENS } from "../tokens.js";
import { checkedPreviewCss } from "./checked-css.js";
import { displayTokenValue } from "./member-order.js";

/**
 * One specimen type per token leaf (C21-4). Every member of a leaf paints the same specimen;
 * only the member's own checked value differs, bound once as `--studio-specimen-value` on the
 * specimen root and read by token utilities. Specimens compose existing Foundry parts (Card,
 * Toggle) and token classes; they hold no copy beyond the host-overridable defaults.
 */
export type TokenSpecimenKind = "motion" | "radius" | "shadow" | "blur" | "text-metric" | "ruler" | "density" | "focus" | "layer-fan";

export const TOKEN_LEAF_SPECIMENS: Readonly<Record<string, TokenSpecimenKind>> = Object.freeze({
  "tokens.duration": "motion",
  "tokens.transition-duration": "motion",
  "tokens.behavior-timing": "motion",
  "tokens.easing": "motion",
  "tokens.transition-easing": "motion",
  "tokens.radius": "radius",
  "tokens.shadow": "shadow",
  "tokens.blur": "blur",
  "tokens.font-size": "text-metric",
  "tokens.font-weight": "text-metric",
  "tokens.letter-spacing": "text-metric",
  "tokens.line-height": "text-metric",
  "tokens.breakpoint": "ruler",
  "tokens.control-size": "ruler",
  "tokens.content-size": "ruler",
  "tokens.region-width": "ruler",
  "tokens.density": "density",
  "tokens.focus-outline": "focus",
  "tokens.z-index": "layer-fan",
});

/**
 * Per-specimen minimum and maximum inline size (FB-12b). D3 is an owner decision; these are the
 * defaults, taken from existing size tokens only (px = the shipped token value). Every specimen
 * clips at its maximum, so its content can never push a cell past the bound.
 */
export const TOKEN_SPECIMEN_WIDTHS: Readonly<Record<TokenSpecimenKind, { readonly min: number; readonly max: number; readonly className: string }>> = Object.freeze({
  motion: { min: 128, max: 256, className: "min-w-(--spacing-6xl) max-w-(--ui-layout-sidebar-w)" },
  radius: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  shadow: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  blur: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  "text-metric": { min: 52, max: 256, className: "min-w-(--ui-control-h-lg) max-w-(--ui-layout-sidebar-w)" },
  ruler: { min: 256, max: 256, className: "min-w-[256px] max-w-[256px]" },
  density: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  focus: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  "layer-fan": { min: 128, max: 128, className: "min-w-(--spacing-6xl) max-w-(--spacing-6xl)" },
});

/**
 * One true-px ruler per size leaf: a 256px track drawn at a fixed scale, so every member of the
 * leaf is measured against the same axis. The bar is the member's own length times `factor`.
 */
const RULERS: Readonly<Record<string, { readonly scale: string; readonly factor: number; readonly ticks: readonly number[] }>> = {
  "tokens.breakpoint": { scale: "1:6.25", factor: 0.16, ticks: [0, 400, 800, 1200, 1600] },
  "tokens.content-size": { scale: "1:5", factor: 0.2, ticks: [0, 320, 640, 960, 1280] },
  "tokens.region-width": { scale: "1:1.5625", factor: 0.64, ticks: [0, 100, 200, 300, 400] },
  "tokens.control-size": { scale: "4:1", factor: 4, ticks: [0, 16, 32, 48, 64] },
};
// Static class strings so the utilities are generated; index = tick position on the track.
const TICK_POSITIONS = ["start-0", "start-1/4 -translate-x-1/2", "start-1/2 -translate-x-1/2", "start-3/4 -translate-x-1/2", "end-0"] as const;

const TEXT_METRIC: Readonly<Record<string, string>> = {
  "tokens.font-size": "text-(length:--studio-specimen-value) leading-none",
  "tokens.font-weight": "text-body-l font-(weight:--studio-specimen-value)",
  "tokens.letter-spacing": "text-body-l tracking-(--studio-specimen-value)",
  // The line box is tinted so the leading itself is visible.
  "tokens.line-height": "text-body leading-(--studio-specimen-value) bg-accent-tint",
};

const CAPTION = "text-caption text-ink-muted";
const join = (...classes: Array<string | false | undefined>): string => classes.filter(Boolean).join(" ");
const bound = (css: string, extra?: Record<string, string | number>): CSSProperties => ({ "--studio-specimen-value": css, ...extra }) as CSSProperties;

/** The checked value a specimen may paint, or undefined when the member is outside its grammar. */
function paintable(member: ResolvedMember): string | undefined {
  const css = member.css.light;
  return typeof css === "string" && css.trim() && !unsafeText(css) && checkedPreviewCss(member.$type, css) ? css : undefined;
}

/** The four control points of a cubic-bezier value (a `var()` reads its authored fallback). */
export function cubicBezierPoints(css: string): readonly [number, number, number, number] | undefined {
  const reference = /^var\(--[a-zA-Z][\w-]*,\s*([\s\S]+)\)$/.exec(css.trim());
  if (reference) return cubicBezierPoints(reference[1]!);
  const match = /^cubic-bezier\(\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*\)$/.exec(css.trim());
  const points = match?.slice(1).map(Number);
  return points && points.every(Number.isFinite) ? points as unknown as [number, number, number, number] : undefined;
}

function MotionSpecimen({ css, role, linear, curve, playLabel }: { css: string; role: "duration" | "easing"; linear: boolean; curve?: readonly [number, number, number, number]; playLabel: string }): ReactElement {
  const [playing, setPlaying] = useState(false);
  const timing = role === "duration"
    ? join("duration-(--studio-specimen-value)", linear ? "ease-linear" : "ease-(--ease-default)")
    : "duration-(--ui-duration-deliberate) ease-(--studio-specimen-value)";
  return <figure data-token-specimen="motion" data-kind="motion" data-playing={String(playing)} style={bound(css)}
    className={join("m-0 grid justify-items-start gap-xs overflow-hidden", TOKEN_SPECIMEN_WIDTHS.motion.className)}>
    <div className="flex items-center gap-sm">
      {curve ? <svg aria-hidden="true" data-easing-curve="" viewBox="0 0 1 1" className="size-xl shrink-0 overflow-visible fill-none stroke-accent">
        <path d={`M0 1 C${curve[0]} ${1 - curve[1]} ${curve[2]} ${1 - curve[3]} 1 0`} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg> : null}
      {/* The track mirrors in right-to-left documents, so the dot always travels from the inline start. */}
      <span aria-hidden="true" className="relative block h-md w-(--spacing-6xl) shrink-0 rounded-pill bg-surface-sunken rtl:-scale-x-100">
        <span data-motion-target="" className={join(
          "absolute start-0 top-0 block size-md rounded-pill bg-accent transition-transform",
          timing,
          playing ? "translate-x-[calc(var(--spacing-6xl)-var(--spacing-md))]" : "translate-x-0",
          // Reduced motion shows where the movement ends, with no transition.
          "motion-reduce:transition-none motion-reduce:translate-x-[calc(var(--spacing-6xl)-var(--spacing-md))]",
        )} />
      </span>
    </div>
    <Toggle size="sm" variant="outline" isSelected={playing} onChange={setPlaying}>{playLabel}</Toggle>
  </figure>;
}

function RulerSpecimen({ css, leaf }: { css: string; leaf: string }): ReactElement {
  const ruler = RULERS[leaf]!;
  return <figure data-token-specimen="ruler" data-kind="ruler" data-ruler-scale={ruler.scale} style={bound(css, { "--studio-ruler-bar": `calc(${css} * ${ruler.factor})` })}
    className={join("m-0 grid gap-xs overflow-hidden", TOKEN_SPECIMEN_WIDTHS.ruler.className)}>
    <span aria-hidden="true" className="relative block h-sm w-[256px] overflow-hidden rounded-pill bg-surface-sunken">
      <span data-ruler-bar="" className="absolute inset-y-0 start-0 block w-(--studio-ruler-bar) max-w-full rounded-pill bg-accent" />
    </span>
    <span aria-hidden="true" className={join("relative block h-lg w-[256px]", CAPTION)}>
      {ruler.ticks.map((tick, index) => <span key={tick} data-ruler-tick={tick} className={join("absolute top-0", TICK_POSITIONS[index])}>{index === ruler.ticks.length - 1 ? `${tick}px` : tick}</span>)}
    </span>
  </figure>;
}

function LayerFanSpecimen({ css, property }: { css: string; property?: string }): ReactElement {
  const ranks = Object.values(TOKENS).filter(token => token.family === "z").sort((a, b) => Number(a.value) - Number(b.value));
  return <figure data-token-specimen="layer-fan" data-kind="layer-fan" style={bound(css)}
    className={join("relative isolate m-0 h-4xl overflow-hidden", TOKEN_SPECIMEN_WIDTHS["layer-fan"].className)}>
    {ranks.map((token, rank) => {
      const current = token.property === property;
      return <span key={token.property} aria-hidden="true" data-layer-rank={rank} data-layer={token.property} data-current={current ? "" : undefined}
        style={{
          "--plate-x": `calc(${rank} * var(--spacing-sm))`, "--plate-y": `calc(${rank} * var(--spacing-xs))`,
          "--plate-z": current ? css : `var(${token.property}, ${token.value})`,
        } as CSSProperties}
        className={join(
          "absolute block h-xl w-3xl rounded-control border start-(--plate-x) top-(--plate-y) z-(--plate-z)",
          current ? "border-accent bg-accent" : "border-line-strong bg-surface-raised",
        )} />;
    })}
  </figure>;
}

function frame(kind: TokenSpecimenKind, css: string, children: ReactNode, className?: string): ReactElement {
  return <figure data-token-specimen={kind} data-kind={kind} style={bound(css)} className={join("m-0 overflow-hidden", TOKEN_SPECIMEN_WIDTHS[kind].className, className)}>{children}</figure>;
}

export interface TokenLeafSpecimenProps {
  id: string;
  member: ResolvedMember;
  /** Text shown by text specimens. */
  sampleText: string;
  /** The motion control's label. @default "Play" */
  playLabel?: string;
}

/**
 * The specimen kind this member paints, or undefined when its leaf has none or its value is
 * outside the leaf's grammar (the caller then keeps its generic preview).
 */
export function tokenLeafSpecimenKind(member: ResolvedMember): TokenSpecimenKind | undefined {
  const kind = TOKEN_LEAF_SPECIMENS[member.slot];
  const css = kind ? paintable(member) : undefined;
  if (!kind || css === undefined) return undefined;
  if (kind === "motion" && member.$type === "cubicBezier" && !cubicBezierPoints(css)) return undefined;
  if (kind === "motion" && member.$type !== "cubicBezier" && member.$type !== "duration") return undefined;
  return kind;
}

/** The one specimen of a token leaf for this member, or null when `tokenLeafSpecimenKind` has none. */
export function TokenLeafSpecimen({ id, member, sampleText, playLabel = "Play" }: TokenLeafSpecimenProps): ReactElement | null {
  const kind = tokenLeafSpecimenKind(member);
  const css = member.css.light;
  if (!kind) return null;
  const key = id.slice(member.slot.length + 1);
  switch (kind) {
    case "motion": {
      const role = member.$type === "cubicBezier" ? "easing" : "duration";
      const curve = role === "easing" ? cubicBezierPoints(css) : undefined;
      return <MotionSpecimen key={id} css={css} role={role} linear={member.slot === "tokens.behavior-timing"} curve={curve} playLabel={playLabel} />;
    }
    case "ruler": return <RulerSpecimen css={css} leaf={member.slot} />;
    case "layer-fan": return <LayerFanSpecimen css={css} property={member.emit} />;
    case "radius": return frame(kind, css, <span aria-hidden="true" data-specimen-target="" className="block size-3xl border-2 border-line-strong bg-surface-sunken rounded-(--studio-specimen-value)" />);
    case "shadow": return frame(kind, css, <Card variant="plate" className="flex p-lg">
      <span aria-hidden="true" data-specimen-target="" className="block h-2xl w-3xl rounded-control bg-surface-raised shadow-(--studio-specimen-value)" />
    </Card>);
    case "blur": return frame(kind, css, <Card variant="plate" className="relative flex items-center gap-xs p-md">
      <span aria-hidden="true" className="block size-lg shrink-0 rounded-pill bg-accent" />
      <span aria-hidden="true" className="text-body-l font-semibold text-ink-primary">Aa</span>
      <span aria-hidden="true" data-specimen-target="" className="absolute inset-y-0 end-0 block w-1/2 border-s border-line-base bg-surface-glass backdrop-blur-(--studio-specimen-value)" />
    </Card>);
    case "text-metric": {
      const sample = member.slot === "tokens.font-size" ? sampleText.trim().split(/\s+/)[0] ?? sampleText : sampleText;
      return frame(kind, css, <span data-specimen-target="" className={join("block whitespace-nowrap text-ink-primary", TEXT_METRIC[member.slot])}>{sample}</span>);
    }
    case "density": {
      // One sample row; the member applies to its own role: the gap, the padding or the row height.
      const role = key === "gap" ? "gap-(--studio-specimen-value) p-xs" : key === "pad" ? "gap-xs p-(--studio-specimen-value)" : "gap-xs px-xs h-(--studio-specimen-value)";
      return frame(kind, css, <span aria-hidden="true" data-specimen-target="" data-density-role={key} className={join("inline-flex items-center rounded-control border border-line-strong bg-surface-raised", role)}>
        <span className="block size-lg rounded-subtle bg-accent-tint" /><span className="block size-lg rounded-subtle bg-accent-tint" />
      </span>);
    }
    case "focus": {
      // A focused sample: the member is the ring width or its offset; the other keeps the shipped token.
      const role = key === "offset" ? "outline-(length:--ui-border-focus) outline-offset-(--studio-specimen-value)" : "outline-(length:--studio-specimen-value) outline-offset-(--ui-focus-offset)";
      return frame(kind, css, <span data-specimen-target="" data-focus-role={key} className={join("inline-flex h-(--ui-control-h-sm) items-center whitespace-nowrap rounded-control border border-line-strong bg-surface-raised px-md text-caption text-ink-primary outline-solid outline-focus-ring", role)}>{sampleText}</span>, "p-sm");
    }
  }
}

/** The labelled channels of a CSS `oklch()` value, `none` included, or undefined outside that grammar. */
export function oklchChannels(css: string): { l: string; c: string; h: string; alpha?: string } | undefined {
  const match = /^oklch\(\s*((?:\d*\.)?\d+%?|none)\s+((?:\d*\.)?\d+%?|none)\s+((?:\d*\.)?\d+(?:deg)?|none)\s*(?:\/\s*((?:\d*\.)?\d+%?|none)\s*)?\)$/i.exec(css.trim());
  if (!match) return undefined;
  return { l: match[1]!, c: match[2]!, h: match[3]!, ...(match[4] ? { alpha: match[4] } : {}) };
}

/** Rebuilds an oklch value from its parsed channels, so only the strict grammar ever reaches CSS. */
function oklchCss(channels: NonNullable<ReturnType<typeof oklchChannels>>): string {
  return `oklch(${channels.l} ${channels.c} ${channels.h}${channels.alpha ? ` / ${channels.alpha}` : ""})`;
}

/**
 * A light/dark swatch for an `oklch()` value with a `none` channel (achromatic Tailwind ramps),
 * painted only from strictly parsed channels. Other colours keep `TokenValuePreview`.
 */
export function OklchSwatch({ id, light, dark, lightLabel, darkLabel }: { id: string; light: string; dark?: string; lightLabel: string; darkLabel: string }): ReactElement | null {
  const lightChannels = oklchChannels(light), darkChannels = oklchChannels(dark ?? light);
  if (!lightChannels || !darkChannels) return null;
  const paint = [oklchCss(lightChannels), oklchCss(darkChannels)] as const;
  return <span data-token-value-preview={id} data-studio-color-swatch="" className="inline-flex size-xl shrink-0 overflow-hidden border border-line-base">
    <span role="img" aria-label={`${lightLabel} ${light}`} className="h-full w-1/2 bg-(--studio-swatch)" style={{ "--studio-swatch": paint[0] } as CSSProperties} />
    <span role="img" aria-label={`${darkLabel} ${dark ?? light}`} className="h-full w-1/2 bg-(--studio-swatch)" style={{ "--studio-swatch": paint[1] } as CSSProperties} />
  </span>;
}

/** True when this colour is an `oklch()` value with a `none` channel that OklchSwatch can paint. */
export function oklchSwatchable(member: ResolvedMember): boolean {
  const { light, dark } = member.css;
  return member.$type === "color" && typeof light === "string" && /\bnone\b/i.test(light) && !unsafeText(light)
    && oklchChannels(light) !== undefined && (dark === undefined || (!unsafeText(dark) && oklchChannels(dark) !== undefined));
}

/**
 * A member value as readable text, resolved: a `var()` reference shows its resolved value and,
 * when the whole value is an alias, the referenced token's name as a quiet chip. An `oklch()`
 * value shows its channels labelled L, C and H. The exact source string stays on the element
 * for copy and as its title. The text wraps inside the token-bounded specimen box.
 */
export function TokenValueText({ css }: { css: string }): ReactElement {
  const { text, alias } = displayTokenValue(css);
  const chip = alias ? <span data-token-alias="" className="text-ink-muted">{alias}</span> : null;
  const channels = oklchChannels(text);
  // The exact source rides on the element only when the visible text differs from it.
  if (!channels) return <code data-member-value="" data-copy-value={text === css && !alias ? undefined : css} title={text === css ? undefined : css} className="token-specimen-contain inline-flex flex-wrap gap-x-sm">{alias ? <span>{text}</span> : text}{chip}</code>;
  const entries: Array<[string, string]> = [["L", channels.l], ["C", channels.c], ["H", channels.h], ...(channels.alpha ? [["A", channels.alpha] as [string, string]] : [])];
  return <code data-member-value="" data-copy-value={css} title={css} className="token-specimen-contain inline-flex flex-wrap gap-x-sm">
    {entries.map(([channel, value]) => <span key={channel} data-channel={channel} className="inline-flex gap-xs whitespace-nowrap">
      <span className="text-ink-muted">{channel}</span><span data-channel-value="">{value}</span>
    </span>)}
    {chip}
  </code>;
}
