"use client";

import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CompositeResolved, ResolvedMember, Resolved } from "../catalog-core/types.js";
import type { SurfaceSlot } from "../catalog-core/surface-types.js";
import { inspectGlyph, inspectSvg } from "../catalog-assets/svg.js";
import { isImageResource } from "../catalog-assets/media.js";
import { malformed, unsafeText } from "../catalog-core/model.js";
import { checkedPreviewCss } from "../tokens/preview/checked-css.js";
import { componentSpecimenPreview, type ComponentSpecimenBinding, type ComponentSpecimenOptions } from "./component-specimens.js";
import { specimenDataset } from "./specimen-dataset.js";
import { PreviewOutcomeContext, type PreviewFailureReason } from "./preview-outcome.js";
import { packageSurfacePreview } from "./planned-surface-previews.js";

/** A source surface is executable only through a host binding to its exact resolved descriptor. */
export interface DesignerSurfaceSpecimen {
  readonly descriptorHash: string;
  readonly render: (options: { readonly width: number; readonly state: string }) => ReactNode;
}
export interface DesignerSpecimenContext {
  /** The consumer's native resolution, including any native default selections. Never a catalog snapshot. */
  readonly profile: CompositeResolved;
  /** Exact module addresses from that resolution, including consumer source entries. */
  readonly modules: ComponentSpecimenOptions["modules"];
  readonly componentOptions?: Pick<ComponentSpecimenOptions, "specimens" | "provider">;
  readonly surfaces?: Readonly<Record<string, DesignerSurfaceSpecimen>>;
}
export interface DesignerSpecimenNeed { readonly leaf: string; readonly reason: string }
export interface DesignerSpecimenProps {
  readonly leaf: string;
  readonly context?: DesignerSpecimenContext;
  /** The host's selected NEED presentation. This module never substitutes Foundry chrome. */
  readonly need: (need: DesignerSpecimenNeed) => ReactNode;
}

function binding(context: DesignerSpecimenContext, leaf: string): ComponentSpecimenBinding | DesignerSpecimenNeed {
  const result = componentSpecimenPreview({ modules: context.modules }).bind(leaf, context.profile);
  return "binding" in result ? result.binding : { leaf, reason: `${result.refusal.code}: ${result.refusal.detail}` };
}
function isNeed(value: ComponentSpecimenBinding | DesignerSpecimenNeed): value is DesignerSpecimenNeed { return "reason" in value; }
function valid(member: ResolvedMember): boolean {
  return (["light", "dark"] as const).every(mode => {
    const css = member.css[mode], value = member.value[mode];
    return mode === "dark" && css === undefined && value === undefined || typeof css === "string" && value !== undefined && !unsafeText(css) && !malformed(member.$type, value, member.$type === "gradient" ? undefined : css) && checkedPreviewCss(member.$type, css);
  });
}

/**
 * Read-only, value-applied specimens. Every piece of chrome binds through the consumer profile.
 * Missing modules, selections and runtime samples return NEED; none falls back to another source.
 */
export function DesignerSpecimen({ leaf, context, need }: DesignerSpecimenProps): ReactNode {
  if (!context) return need({ leaf, reason: "Consumer Designer resolution is unavailable." });
  const semantic = binding(context, "components.semantic-content");
  if (isNeed(semantic)) return need(semantic);
  const Content = semantic.Component;
  const inside = (children: ReactNode) => <Content as="section" data-ds-leaf="components.semantic-content" data-designer-specimen={leaf} className="flex flex-col gap-md">{children}</Content>;
  if (leaf.startsWith("tokens.") || leaf.startsWith("assets.")) {
    const members = Object.entries(context.profile.values.members).filter(([, member]) => member.slot === leaf);
    if (!members.length) return need({ leaf, reason: "not-chosen: no resolved consumer members" });
    return inside(<Content as="div" data-ds-leaf={leaf} className="flex flex-wrap gap-md">{members.map(([id, member]) => <Content key={id} as="section" className="flex flex-col gap-sm">
      <Content as="h3">{id.slice(leaf.length + 1)}</Content>
      {leaf.startsWith("assets.") ? <AssetMember id={id} member={member} context={context} need={need} semantic={semantic} /> : <TokenMember id={id} member={member} values={context.profile.values} context={context} need={need} semantic={semantic} />}
    </Content>)}</Content>);
  }
  if (leaf.startsWith("components.")) {
    const preview = componentSpecimenPreview({ ...context.componentOptions, modules: context.modules });
    const selected = preview.bind(leaf, context.profile);
    if ("refusal" in selected) return need({ leaf, reason: `${selected.refusal.code}: ${selected.refusal.detail}` });
    const badge = binding(context, "components.badge");
    if (isNeed(badge)) return need(badge);
    const Badge = badge.Component;
    return inside(<Content as="div" data-ds-leaf={leaf} className="flex flex-col gap-md">
      <Badge data-ds-leaf="components.badge">{selected.binding.source}</Badge>
      {(["default", "hover", "focus", "disabled", "invalid"] as const).map(state => <Content as="section" key={state} className="flex flex-col gap-sm" data-specimen-state={state}>
        <Content as="h3">{state}</Content>
        {state === "hover" || state === "focus" ? <Content as="p">{state === "hover" ? "Hover the live specimen to inspect its hover state." : "Focus the live specimen with the keyboard to inspect its focus state."}</Content> : null}
        <ComponentProbe leaf={leaf} context={context} need={need} state={state} />
      </Content>)}
    </Content>);
  }
  if (/^(sections|frames)\./.test(leaf)) {
    const selected = context.profile.surfaces?.fills[leaf as SurfaceSlot];
    if (!selected) return need({ leaf, reason: "not-chosen: no resolved consumer surface" });
    const bound = context.surfaces?.[leaf];
    if (bound && bound.descriptorHash !== selected.descriptorHash) return need({ leaf, reason: "The selected surface has no matching runtime specimen binding." });
    // This registry accepts only the precise selected package export and canonical mapping.
    // Source/custom surfaces need the host's exact descriptor-bound executable port.
    const registered = bound ? undefined : packageSurfacePreview(selected.document);
    if (!bound && (!registered || "reason" in registered)) return need({ leaf, reason: registered && "reason" in registered ? registered.reason : "The selected surface has no runtime specimen binding." });
    const widths = leaf.startsWith("frames.") ? [1280] : [1280, 375];
    return inside(<Content as="div" data-ds-leaf={leaf} className="flex flex-col gap-md">{widths.map(width => <Content as="section" key={width} className="overflow-auto" data-specimen-viewport={width}>
      <Content as="h3">{width === 375 ? "Mobile" : "Desktop"}</Content>
      <SpecimenViewport semantic={semantic} leaf={leaf} width={width}>{bound ? bound.render({ width, state: "default" }) : registered && "render" in registered ? registered.render() : null}</SpecimenViewport>
    </Content>)}</Content>);
  }
  return need({ leaf, reason: "No Designer specimen is registered for this layer." });
}

/** A real isolated viewport makes responsive media queries use the fixture width. */
function SpecimenViewport({ semantic, leaf, width, children }: { semantic: ComponentSpecimenBinding; leaf: string; width: number; children: ReactNode }): ReactNode {
  const Content = semantic.Component;
  const [body, setBody] = useState<HTMLElement>();
  const loaded = (frame: HTMLIFrameElement) => {
    const target = frame.contentDocument;
    if (!target) return;
    // Copy only the host's applied presentation, never its page body or cell source.
    target.head.replaceChildren(...Array.from(frame.ownerDocument.querySelectorAll('style,link[rel="stylesheet"]'), node => node.cloneNode(true)));
    for (const attr of Array.from(frame.ownerDocument.documentElement.attributes)) target.documentElement.setAttribute(attr.name, attr.value);
    target.body.className = frame.ownerDocument.body.className;
    target.body.style.margin = "0";
    setBody(target.body);
  };
  return <Content as="div" style={{ inlineSize: width, zoom: width === 1280 ? 0.5 : 1 }}>
    <iframe title={`${leaf} ${width}px specimen`} width={width} height={720} sandbox="allow-same-origin" srcDoc="<!doctype html><html><head></head><body></body></html>" onLoad={event => loaded(event.currentTarget)} style={{ border: 0, display: "block" }} />
    {body ? createPortal(<Content as="div" data-ds-leaf="components.semantic-content" data-designer-specimen-frame={leaf}>{children}</Content>, body) : null}
  </Content>;
}

function ComponentProbe({ leaf, context, need, state }: { leaf: string; context: DesignerSpecimenContext; need: DesignerSpecimenProps["need"]; state: "default" | "hover" | "focus" | "disabled" | "invalid" }): ReactNode {
  const [reason, report] = useState<PreviewFailureReason>();
  const preview = componentSpecimenPreview({ ...context.componentOptions, modules: context.modules, probes: { [leaf]: { states: state === "default" ? [] : [state === "focus" ? "focus-visible" : state] } } }).preview(leaf, context.profile);
  return <PreviewOutcomeContext.Provider value={report}>{reason ? need({ leaf, reason }) : null}{preview}</PreviewOutcomeContext.Provider>;
}

type MemberProps = { id: string; member: ResolvedMember; context: DesignerSpecimenContext; need: DesignerSpecimenProps["need"]; semantic: ComponentSpecimenBinding };
function TokenMember({ id, member, values, context, need, semantic }: MemberProps & { values: Resolved }): ReactNode {
  const Content = semantic.Component;
  if (!valid(member)) return need({ leaf: member.slot, reason: `Invalid resolved value: ${id}` });
  const css = member.css.light;
  const modes = member.css.dark === undefined ? ["light"] as const : ["light", "dark"] as const;
  if (member.$type === "color" || member.$type === "gradient") return <>{modes.map(mode => {
    const ink = Object.entries(values.members).find(([, value]) => value.emit === "--color-ink-primary");
    const ground = Object.entries(values.members).find(([, value]) => value.emit === "--color-surface-base");
    const pair = member.emit?.includes("ink") ? ground : ink;
    const color = member.css[mode] ?? css;
    return <Content as="div" key={mode} data-specimen-mode={mode} className="flex flex-col gap-xs">
      <Content as="span" role="img" aria-label={`${id} ${mode}`} style={{ display: "inline-block", inlineSize: "6rem", blockSize: "4rem", background: color }} />
      <Content as="span">{color}</Content>
      {pair && valid(pair[1]) ? <Content as="span" data-contrast-pair={pair[0]} style={{ background: member.emit?.includes("ink") ? pair[1].css[mode] ?? pair[1].css.light : color, color: member.emit?.includes("ink") ? color : pair[1].css[mode] ?? pair[1].css.light }}>{specimenDataset.tokens.sampleText}</Content> : need({ leaf: member.slot, reason: "The consumer has no resolved contrast pair." })}
    </Content>;
  })}</>;
  if (member.$type === "duration" || member.$type === "cubicBezier") {
    const button = binding(context, "components.button");
    if (isNeed(button)) return need(button);
    const duration = member.$type === "duration" ? member : Object.values(values.members).find(value => value.$type === "duration");
    const easing = member.$type === "cubicBezier" ? member : Object.values(values.members).find(value => value.$type === "cubicBezier");
    if (!duration || !easing || !valid(duration) || !valid(easing)) return need({ leaf: member.slot, reason: "Motion needs resolved duration and easing tokens." });
    return <MotionMember semantic={semantic} button={button} duration={duration.css.light} easing={easing.css.light} id={id} />;
  }
  let style: CSSProperties | undefined;
  if (member.$type === "fontFamily") style = { fontFamily: css };
  else if (member.$type === "fontWeight") style = { fontWeight: css };
  else if (member.$type === "dimension" && /(?:body|heading|display|caption)-size$/.test(member.slot)) style = { fontSize: css };
  else if (member.slot === "tokens.line-height") style = { lineHeight: css };
  else if (member.slot === "tokens.letter-spacing") style = { letterSpacing: css };
  else if (member.$type === "dimension" && member.slot.includes("radius")) return <><Content as="div" role="img" aria-label={id} className="size-3xl border border-line-strong bg-surface-raised" style={{ borderRadius: css }} /><Content as="span">{css}</Content></>;
  else if (member.$type === "dimension" && /spacing|size|width|breakpoint/.test(member.slot)) return <><Content as="div" role="img" aria-label={id} className="block h-sm max-w-full bg-accent" style={{ inlineSize: css }} /><Content as="span">{css}</Content></>;
  else if (member.$type === "shadow") return <Content as="div" className="size-3xl bg-surface-raised" style={{ boxShadow: css }} aria-label={id} />;
  if (!style) return need({ leaf: member.slot, reason: `No value-applied specimen for ${id}.` });
  return <Content as="p" data-type-sample={id} style={style}>{specimenDataset.tokens.sampleText}</Content>;
}

/** Web Animations uses the selected values. Reduced motion never starts an animation. */
function MotionMember({ semantic, button, duration, easing, id }: { semantic: ComponentSpecimenBinding; button: ComponentSpecimenBinding; duration: string; easing: string; id: string }): ReactNode {
  const Content = semantic.Component, Button = button.Component;
  const target = useRef<HTMLElement | null>(null);
  const running = useRef<Animation | undefined>(undefined);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : undefined;
    const changed = () => { setReduced(media?.matches ?? false); if (media?.matches) running.current?.cancel(); };
    changed();
    media?.addEventListener?.("change", changed);
    return () => { media?.removeEventListener?.("change", changed); running.current?.cancel(); };
  }, []);
  const play = () => {
    running.current?.cancel();
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(reduce);
    if (reduce) return;
    const milliseconds = Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
    running.current = target.current?.animate?.([{ transform: "translateX(0)" }, { transform: "translateX(4rem)" }, { transform: "translateX(0)" }], { duration: milliseconds, easing });
  };
  return <Content as="div" className="flex flex-col gap-sm" data-motion-specimen={id}>
    <Content as="div" ref={target} role="img" aria-label={id} className="size-lg bg-accent" />
    <Button data-ds-leaf="components.button" onPress={play}>Play motion</Button>
    {reduced ? <Content as="p" role="status">Reduced motion is enabled.</Content> : null}
  </Content>;
}

function AssetMember({ id, member, context, need, semantic }: MemberProps): ReactNode {
  const Content = semantic.Component;
  const artwork = () => {
    if (member.$type === "glyph") {
      const icon = binding(context, "components.icon");
      if (isNeed(icon)) return need(icon);
      try { inspectGlyph(member.value.light); } catch { return need({ leaf: member.slot, reason: `Invalid glyph: ${id}` }); }
      return createElement(icon.Component, { glyph: member.value.light, decorative: false, label: id, "data-ds-leaf": "components.icon" });
    }
    if (member.$type === "svg" && typeof member.value.light === "string") {
      try { inspectSvg(member.value.light, id === "assets.favicon.vector" ? { favicon: true } : undefined); } catch { return need({ leaf: member.slot, reason: `Invalid artwork: ${id}` }); }
      return <img src={`data:image/svg+xml,${encodeURIComponent(member.value.light)}`} alt={id} width={160} height={96} />;
    }
    const value = member.value.light;
    if (isImageResource(value)) return <img src={value.src} alt={value.decorative ? "" : value.alt} width={value.width} height={value.height} />;
    return need({ leaf: member.slot, reason: `No artwork specimen for ${id}.` });
  };
  return <>{(["light", "dark"] as const).map(ground => <Content as="div" key={ground} data-asset-ground={ground} className="flex items-center justify-center p-md" style={{ background: ground === "light" ? "white" : "black", color: ground === "light" ? "black" : "white" }}>{artwork()}</Content>)}</>;
}
