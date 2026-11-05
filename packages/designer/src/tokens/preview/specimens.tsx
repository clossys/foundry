"use client";

import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Card } from "../../components/Card.js";
import { Icon, type IconSize } from "../../components/Icon.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { Toggle } from "../../components/toggle-button/index.js";
import { unsafeText } from "../../catalog-core/model.js";
import type { ResolvedMember } from "../../catalog-core/types.js";
import { TOKENS } from "../tokens.js";
import { checkedPreviewCss } from "./checked-css.js";
import { displayTokenValue } from "./member-order.js";
import { TokenValuePreview } from "./index.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

/**
 * One specimen type per token leaf (C21-4). Every member of a leaf paints the same specimen;
 * only the member's own checked value differs, bound once as `--studio-specimen-value` on the
 * specimen root (a `token-under-review` override, see {@link specimenOverride}) and read by token
 * utilities. Specimens compose existing Foundry parts (Card, Icon, Toggle, SemanticContent) and token
 * classes; their sample text, labels, glyph and rulers come from the shared specimen dataset, and a host
 * may override the text and the play label. A part that reads its own token (the Icon's size and
 * stroke) takes the member through that token, overridden on the same root.
 */
export type TokenSpecimenKind = "motion" | "radius" | "shadow" | "blur" | "text-metric" | "ruler" | "density" | "focus" | "layer-fan" | "icon" | "opacity" | "gradient";

export const TOKEN_LEAF_SPECIMENS: Readonly<Record<string, TokenSpecimenKind>> = Object.freeze({
  "themes.radius": "radius",
  "themes.shadow": "shadow",
  "themes.font-sans": "text-metric",
  "themes.font-heading": "text-metric",
  "themes.font-mono": "text-metric",
  "themes.font-serif": "text-metric",
  "themes.tracking-tight": "text-metric",
  "themes.spacing": "ruler",
  "themes.animate-marquee": "motion",
  "themes.animate-marquee-vertical": "motion",
  "themes.animate-shiny-text": "motion",
});

/**
 * Per-specimen minimum and maximum inline size (FB-12b). D3 is an owner decision; these are the
 * defaults, taken from existing size tokens only (px = the shipped token value). Every specimen
 * clips at its maximum, so its content can never push a cell past the bound.
 */
export const TOKEN_SPECIMEN_WIDTHS: Readonly<Record<TokenSpecimenKind, { readonly min: number; readonly max: number; readonly className: string }>> = Object.freeze({
  gradient: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  motion: { min: 128, max: 256, className: "min-w-(--spacing-6xl) max-w-(--ui-layout-sidebar-w)" },
  radius: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  shadow: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  blur: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  "text-metric": { min: 52, max: 256, className: "min-w-(--ui-control-h-lg) max-w-(--ui-layout-sidebar-w)" },
  ruler: { min: 256, max: 256, className: "min-w-(--ui-layout-sidebar-w) max-w-(--ui-layout-sidebar-w)" },
  density: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  focus: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  "layer-fan": { min: 128, max: 128, className: "min-w-(--spacing-6xl) max-w-(--spacing-6xl)" },
  icon: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
  opacity: { min: 52, max: 128, className: "min-w-(--ui-control-h-lg) max-w-(--spacing-6xl)" },
});

/**
 * One true-px ruler per size leaf, from the dataset: a track the sidebar width long (256px) drawn
 * at a fixed scale, so every member of the leaf is measured against the same axis. The bar is the
 * member's own length times `factor`.
 */
const SAMPLES = specimenDataset.tokens;
const RULERS = SAMPLES.rulers;
// Static class strings so the utilities are generated; index = tick position on the track.
const TICK_POSITIONS = ["start-0", "start-1/4 -translate-x-1/2", "start-1/2 -translate-x-1/2", "start-3/4 -translate-x-1/2", "end-0"] as const;

const TEXT_SIZE = "text-(length:--studio-specimen-value) leading-none";
/** Text-metric leaves whose member is a size: they set the sample's first word, so the largest step still fits. */
const TEXT_SIZE_LEAVES = new Set<string>();
/** The utility a text-metric member applies, by leaf or, where members differ in role, by leaf and member key. */
const TEXT_METRIC: Readonly<Record<string, string>> = {
  "themes.font-sans": "text-body-l font-(family-name:--studio-specimen-value)",
  "themes.font-heading": "text-body-l font-(family-name:--studio-specimen-value)",
  "themes.font-mono": "text-body-l font-(family-name:--studio-specimen-value)",
  "themes.font-serif": "text-body-l font-(family-name:--studio-specimen-value)",
  "themes.tracking-tight": "text-body-l tracking-(--studio-specimen-value)",
};

const CAPTION = "text-caption text-ink-muted";
const join = (...classes: Array<string | false | undefined>): string => classes.filter(Boolean).join(" ");

/**
 * Why a specimen sets a custom property inline. Closed: a specimen sets nothing inline but a
 * reason-coded custom-property override, and token utilities read it.
 * - `token-under-review`: the member value under review, bound on the token specimen root.
 * - `token-scale-context`: the shipped neighbours a member is judged against (the layer fan's plates).
 * - `asset-under-review`: the asset member's own checked value (a ratio, a pattern tile).
 */
export const SPECIMEN_OVERRIDE_REASONS = ["token-under-review", "token-scale-context", "asset-under-review"] as const;
export type SpecimenOverrideReason = typeof SPECIMEN_OVERRIDE_REASONS[number];
export interface SpecimenOverride {
  style: CSSProperties;
  "data-specimen-override": "";
  "data-override-reason": SpecimenOverrideReason;
}
/** The one audited door a specimen's inline style goes through: custom properties only, with their reason code. */
export function specimenOverride(reason: SpecimenOverrideReason, properties: Readonly<Record<`--${string}`, string>>): SpecimenOverride {
  return { style: { ...properties } as CSSProperties, "data-specimen-override": "", "data-override-reason": reason };
}
/** The member under review, bound on a token specimen root. */
const bound = (css: string, extra?: Readonly<Record<`--${string}`, string>>): SpecimenOverride => specimenOverride("token-under-review", { "--studio-specimen-value": css, ...extra });

/** A CSS `animation` shorthand: a keyframes name, a time (or one var() reference), then plain timing words or one cubic-bezier. */
const ANIMATION = /^[a-z][a-z0-9-]*\s+(?:(?:\d*\.)?\d+m?s|var\(--[a-z][\w-]*\))(?:\s+(?:[a-z-]+|cubic-bezier\([\d.\s,+-]+\)))*$/;

/** A CSS `font-style` keyword, the grammar of a display face's style member. */
const FONT_STYLE = /^(?:normal|italic|oblique(?:\s+-?(?:\d*\.)?\d+deg)?)$/;
/** The display face's style member: a font-style keyword under a dimension-typed leaf. */
const fontStyleMember = (member: ResolvedMember): boolean => member.slot === "themes.font-heading" && member.emit?.endsWith("-style") === true;

/** The checked value a specimen may paint, or undefined when the member is outside its grammar. */
function paintable(member: ResolvedMember): string | undefined {
  const css = member.css.light;
  const checked = member.slot.startsWith("themes.animate-") ? ANIMATION.test(css.trim())
    : fontStyleMember(member) ? FONT_STYLE.test(css.trim()) : checkedPreviewCss(member.$type, css);
  return typeof css === "string" && css.trim() && !unsafeText(css) && checked ? css : undefined;
}

/** The four control points of a cubic-bezier value (a `var()` reads its authored fallback). */
export function cubicBezierPoints(css: string): readonly [number, number, number, number] | undefined {
  const reference = /^var\(--[a-zA-Z][\w-]*,\s*([\s\S]+)\)$/.exec(css.trim());
  if (reference) return cubicBezierPoints(reference[1]!);
  const match = /^cubic-bezier\(\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*\)$/.exec(css.trim());
  const points = match?.slice(1).map(Number);
  return points && points.every(Number.isFinite) ? points as unknown as [number, number, number, number] : undefined;
}

function MotionSpecimen({ css, role, linear, curve, playLabel }: { css: string; role: "duration" | "easing" | "animation"; linear: boolean; curve?: readonly [number, number, number, number]; playLabel: string }): ReactElement {
  const [playing, setPlaying] = useState(false);
  if (role === "animation") return <figure data-layer="themes" data-token-specimen="motion" data-kind="motion" data-playing={String(playing)} {...bound(css)}
    className={join("m-0 grid justify-items-start gap-xs overflow-hidden", TOKEN_SPECIMEN_WIDTHS.motion.className)}>
    {/* The member's own keyframes run on the sample only while playing; reduced motion keeps it still. */}
    <span aria-hidden="true" data-motion-target="" className={join("block size-xl rounded-control bg-accent", playing && "animate-(--studio-specimen-value) motion-reduce:animate-none")} />
    <Toggle size="sm" variant="outline" isSelected={playing} onChange={setPlaying}>{playLabel}</Toggle>
  </figure>;
  const timing = role === "duration"
    ? join("duration-(--studio-specimen-value)", linear ? "ease-linear" : "ease-(--ease-default)")
    : "duration-(--ui-duration-deliberate) ease-(--studio-specimen-value)";
  return <figure data-layer="themes" data-token-specimen="motion" data-kind="motion" data-playing={String(playing)} {...bound(css)}
    className={join("m-0 grid justify-items-start gap-xs overflow-hidden", TOKEN_SPECIMEN_WIDTHS.motion.className)}>
    <div className="flex items-center gap-sm">
      {curve ? <svg aria-hidden="true" data-easing-curve="" viewBox="0 0 1 1" className="size-xl shrink-0 overflow-visible fill-none stroke-accent">
        <path d={`M0 1 C${curve[0]} ${1 - curve[1]} ${curve[2]} ${1 - curve[3]} 1 0`} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg> : null}
      {/* The track mirrors in right-to-left documents, so the dot always travels from the inline start. */}
      <span aria-hidden="true" className="relative block h-md w-(--spacing-6xl) shrink-0 rounded-pill bg-surface-sunken rtl:-scale-x-100">
        {/* The lane is the track less one dot, so moving the full lane width ends the dot at the track's end. */}
        <span className="absolute inset-y-0 start-0 end-md block">
          <span data-motion-target="" className={join(
            "block h-full w-full transition-transform",
            timing,
            playing ? "translate-x-full" : "translate-x-0",
            // Reduced motion shows where the movement ends, with no transition.
            "motion-reduce:transition-none motion-reduce:translate-x-full",
          )}>
            <span className="block size-md rounded-pill bg-accent" />
          </span>
        </span>
      </span>
    </div>
    <Toggle size="sm" variant="outline" isSelected={playing} onChange={setPlaying}>{playLabel}</Toggle>
  </figure>;
}

function RulerSpecimen({ css, leaf }: { css: string; leaf: string }): ReactElement {
  const ruler = RULERS[leaf]!;
  return <figure data-layer="themes" data-token-specimen="ruler" data-kind="ruler" data-ruler-scale={ruler.scale} {...bound(css, { "--studio-ruler-bar": `calc(${css} * ${ruler.factor})` })}
    className={join("m-0 grid gap-xs overflow-hidden", TOKEN_SPECIMEN_WIDTHS.ruler.className)}>
    <span aria-hidden="true" className="relative block h-sm w-(--ui-layout-sidebar-w) overflow-hidden rounded-pill bg-surface-sunken">
      <span data-ruler-bar="" className="absolute inset-y-0 start-0 block w-(--studio-ruler-bar) max-w-full rounded-pill bg-accent" />
    </span>
    <span aria-hidden="true" className={join("relative block h-lg w-(--ui-layout-sidebar-w)", CAPTION)}>
      {ruler.ticks.map((tick, index) => <span key={tick} data-ruler-tick={tick} className={join("absolute top-0", TICK_POSITIONS[index])}>{index === ruler.ticks.length - 1 ? `${tick}${SAMPLES.unit}` : tick}</span>)}
    </span>
  </figure>;
}

function LayerFanSpecimen({ css, property }: { css: string; property?: string }): ReactElement {
  const ranks = Object.values(TOKENS).filter(token => token.family === "z").sort((a, b) => Number(a.value) - Number(b.value));
  return <figure data-layer="themes" data-token-specimen="layer-fan" data-kind="layer-fan" {...bound(css)}
    className={join("relative isolate m-0 h-4xl overflow-hidden", TOKEN_SPECIMEN_WIDTHS["layer-fan"].className)}>
    {ranks.map((token, rank) => {
      const current = token.property === property;
      // Each plate sits at its shipped rank and z value; only the member's own plate takes the value under review.
      return <span key={token.property} aria-hidden="true" data-layer-rank={rank} data-layer-property={token.property} data-current={current ? "" : undefined}
        {...specimenOverride("token-scale-context", {
          "--plate-x": `calc(${rank} * var(--spacing-sm))`, "--plate-y": `calc(${rank} * var(--spacing-xs))`,
          "--plate-z": current ? css : String(token.value),
        })}
        className={join(
          "absolute block h-xl w-3xl rounded-control border start-(--plate-x) top-(--plate-y) z-(--plate-z)",
          current ? "border-accent bg-accent" : "border-line-strong bg-surface-raised",
        )} />;
    })}
  </figure>;
}

/** The icon steps the registered Icon takes; an icon-size member draws at its own step. */
const ICON_STEPS: readonly IconSize[] = ["sm", "md", "lg"];
/** A member's emitted custom property, when it is a plain one a registered part can read. */
const emitted = (member: ResolvedMember): `--${string}` | undefined => member.emit !== undefined && /^--[a-z][a-z0-9-]*$/.test(member.emit) ? member.emit : undefined;

function frame(kind: TokenSpecimenKind, css: string, children: ReactNode, className?: string, extra?: Readonly<Record<`--${string}`, string>>): ReactElement {
  return <figure data-layer="themes" data-token-specimen={kind} data-kind={kind} {...bound(css, extra)} className={join("m-0 overflow-hidden", TOKEN_SPECIMEN_WIDTHS[kind].className, className)}>{children}</figure>;
}

export interface TokenLeafSpecimenProps {
  id: string;
  member: ResolvedMember;
  /** Text shown by text specimens. @default the shared dataset's sample text */
  sampleText?: string;
  /** The motion control's label. @default the shared dataset's play label */
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
  if (kind === "motion" && !member.slot.startsWith("themes.animate-") && member.$type !== "cubicBezier" && member.$type !== "duration") return undefined;
  return kind;
}

/** The one specimen of a token leaf for this member, or null when `tokenLeafSpecimenKind` has none. */
export function TokenLeafSpecimen({ id, member, sampleText = SAMPLES.sampleText, playLabel = SAMPLES.playLabel }: TokenLeafSpecimenProps): ReactElement | null {
  const kind = tokenLeafSpecimenKind(member);
  const css = member.css.light;
  if (!kind) return null;
  const key = id.slice(member.slot.length + 1);
  switch (kind) {
    case "gradient": return frame(kind, css, <TokenValuePreview id={id} member={member} sampleText={sampleText} lightLabel="" darkLabel="" compact />);
    case "motion": {
      const role = member.slot.startsWith("themes.animate-") ? "animation" : member.$type === "cubicBezier" ? "easing" : "duration";
      const curve = role === "easing" ? cubicBezierPoints(css) : undefined;
      return <MotionSpecimen key={id} css={css} role={role} linear={false} curve={curve} playLabel={playLabel} />;
    }
    case "ruler": return <RulerSpecimen css={css} leaf={member.slot} />;
    case "layer-fan": return <LayerFanSpecimen css={css} property={member.emit} />;
    case "radius": return frame(kind, css, <span aria-hidden="true" data-specimen-target="" className="block size-3xl border-2 border-line-strong bg-surface-sunken rounded-(--studio-specimen-value)" />);
    case "shadow": return frame(kind, css, <Card variant="plate" className="flex p-lg">
      <span aria-hidden="true" data-specimen-target="" className="block h-2xl w-3xl rounded-control bg-surface-raised shadow-(--studio-specimen-value)" />
    </Card>);
    case "blur": return frame(kind, css, <Card variant="plate" className="relative flex items-center gap-xs p-md">
      <span aria-hidden="true" className="block size-lg shrink-0 rounded-pill bg-accent" />
      <SemanticContent as="span" aria-hidden="true" className="text-body-l font-semibold text-ink-primary">{SAMPLES.glyphs}</SemanticContent>
      <span aria-hidden="true" data-specimen-target="" className="absolute inset-y-0 end-0 block w-1/2 border-s border-line-base bg-surface-glass backdrop-blur-(--studio-specimen-value)" />
    </Card>);
    case "text-metric": {
      if (member.slot === "themes.font-heading" && key === "optical-size") return frame(kind, css, <TokenValuePreview id={id} member={member} sampleText={sampleText} lightLabel="" darkLabel="" />);
      // No utility reads a font-style value, so the style member picks the keyword's own utility.
      const metric = fontStyleMember(member) ? join("text-body-l", css.trim() === "normal" ? "not-italic" : "italic") : TEXT_METRIC[`${member.slot}.${key}`] ?? TEXT_METRIC[member.slot];
      const sample = TEXT_SIZE_LEAVES.has(member.slot) ? sampleText.trim().split(/\s+/)[0] ?? sampleText : sampleText;
      return frame(kind, css, <SemanticContent as="span" data-specimen-target="" className={join("block whitespace-nowrap text-ink-primary", metric)}>{sample}</SemanticContent>);
    }
    case "icon": {
      // The registered Icon reads its own size and stroke tokens; the member overrides the one it emits, on the root.
      const target = emitted(member);
      const step = ICON_STEPS.find(candidate => candidate === key) ?? "lg";
      return frame(kind, css, <span data-specimen-target="" className="inline-flex text-ink-primary">
        <Icon decorative glyph={specimenDataset.icon.glyph} size={step} />
      </span>, "p-sm", target ? { [target]: css } : undefined);
    }
    case "opacity": return frame(kind, css, <Card variant="plate" className="flex items-center gap-xs p-md">
      <span aria-hidden="true" className="block size-lg rounded-control bg-accent" />
      <span aria-hidden="true" data-specimen-target="" className="block size-lg rounded-control bg-accent opacity-(--studio-specimen-value)" />
    </Card>);
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
      return frame(kind, css, <SemanticContent as="span" data-specimen-target="" data-focus-role={key} className={join("inline-flex h-(--ui-control-h-sm) items-center whitespace-nowrap rounded-control border border-line-strong bg-surface-raised px-md text-caption text-ink-primary outline-solid outline-focus-ring", role)}>{sampleText}</SemanticContent>, "p-sm");
    }
  }
}

/** The labelled channels of a CSS `oklch()` value, `none` included, or undefined outside that grammar. */
export function oklchChannels(css: string): { l: string; c: string; h: string; alpha?: string } | undefined {
  const match = /^oklch\(\s*((?:\d*\.)?\d+%?|none)\s+((?:\d*\.)?\d+%?|none)\s+((?:\d*\.)?\d+(?:deg)?|none)\s*(?:\/\s*((?:\d*\.)?\d+%?|none)\s*)?\)$/i.exec(css.trim());
  if (!match) return undefined;
  return { l: match[1]!, c: match[2]!, h: match[3]!, ...(match[4] ? { alpha: match[4] } : {}) };
}

/**
 * A light/dark swatch for an `oklch()` value with a `none` channel (achromatic Tailwind ramps),
 * painted only from strictly parsed channels. Other colours keep `TokenValuePreview`.
 */
export function OklchSwatch({ id, light, dark, lightLabel, darkLabel }: { id: string; light: string; dark?: string; lightLabel: string; darkLabel: string }): ReactElement | null {
  // Only a value the anchored oklch grammar accepts whole ever reaches CSS, as the member under review.
  if (!oklchChannels(light) || !oklchChannels(dark ?? light)) return null;
  const paint = [light.trim(), (dark ?? light).trim()] as const;
  return <span data-layer="themes" data-token-value-preview={id} data-studio-color-swatch="" className="inline-flex size-xl shrink-0 overflow-hidden border border-line-base">
    <span role="img" aria-label={`${lightLabel} ${light}`} className="h-full w-1/2 bg-(--studio-swatch)" {...specimenOverride("token-under-review", { "--studio-swatch": paint[0] })} />
    <span role="img" aria-label={`${darkLabel} ${dark ?? light}`} className="h-full w-1/2 bg-(--studio-swatch)" {...specimenOverride("token-under-review", { "--studio-swatch": paint[1] })} />
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
