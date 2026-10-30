"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { componentLeaf } from "../runtime/component-leaf.js";
import type { IconNode } from "../components/Icon.js";
import type { ResolvedMember } from "../catalog-core/types.js";
import { malformed, unsafeText } from "../catalog-core/model.js";
import { inspectGlyph, inspectSvg } from "../catalog-assets/svg.js";
import { isImageResource } from "../catalog-assets/media.js";
import { checkedPreviewCss } from "../tokens/preview/checked-css.js";
import { specimenDataset } from "./specimen-dataset.js";
import { componentSpecimenPreview, type ComponentSpecimenBinding } from "./component-specimens.js";
import type { DesignerSpecimenContext, DesignerSpecimenNeed } from "./DesignerSpecimen.js";
import { SpecimenLayoutSection, specimenLayoutNeeds, type SpecimenItem, type SpecimenLeafDefinition, type SpecimenLeafId, type SpecimenLeafProps, type SpecimenLayout, type SpecimenSpan } from "./specimen-layouts.js";

const Content = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Button = componentLeaf<typeof import("../components/Button.js").Button>("components.button");
const Icon = componentLeaf<typeof import("../components/Icon.js").Icon>("components.icon");
const Logomark = componentLeaf<typeof import("../components/Logomark.js").Logomark>("components.logo");

/** The cell carries native member identities. Values always come from the current consumer resolution. */
export interface TokenAssetSpecimenValue { readonly memberId: string }
export interface ColorRampSpecimenValue { readonly memberIds: readonly string[] }
export interface TokenAssetSpecimenDefinition extends SpecimenLeafDefinition {
  readonly cardinality: { readonly minItems: 1 };
  readonly requiredLeaves: readonly string[];
  readonly capabilities: readonly string[];
  validate(props: SpecimenLeafProps): readonly DesignerSpecimenNeed[];
}

const valid = (member: ResolvedMember): boolean => (["light", "dark"] as const).every(mode => {
  const css = member.css[mode], value = member.value[mode];
  return mode === "dark" && css === undefined && value === undefined || typeof css === "string" && value !== undefined
    && !unsafeText(css) && !malformed(member.$type, value, member.$type === "gradient" ? undefined : css) && checkedPreviewCss(member.$type, css);
});
const memberId = (value: unknown): string | undefined => value !== null && typeof value === "object" && "memberId" in value && typeof value.memberId === "string" ? value.memberId : undefined;
const memberIds = (value: unknown): readonly string[] | undefined => {
  if (!value || typeof value !== "object" || !("memberIds" in value) || !Array.isArray(value.memberIds) || !value.memberIds.length) return undefined;
  return value.memberIds.every((id: unknown) => typeof id === "string") ? value.memberIds : undefined;
};
function selected(context: DesignerSpecimenContext, leaf: string): ComponentSpecimenBinding | DesignerSpecimenNeed {
  const result = componentSpecimenPreview({ modules: context.modules }).bind(leaf, context.profile);
  return "binding" in result ? result.binding : { leaf, reason: `${result.refusal.code}: ${result.refusal.detail}` };
}
const isNeed = (value: ComponentSpecimenBinding | DesignerSpecimenNeed): value is DesignerSpecimenNeed => "reason" in value;
function memberOf(context: DesignerSpecimenContext, value: unknown): ResolvedMember | undefined {
  const id = memberId(value);
  return id === undefined ? undefined : context.profile.values.members[id];
}
function pairOf(context: DesignerSpecimenContext, member: ResolvedMember): [string, ResolvedMember] | undefined {
  return Object.entries(context.profile.values.members).find(([, value]) => value.emit === (member.emit?.includes("ink") ? "--color-surface-base" : "--color-ink-primary") && value.$type === "color" && valid(value));
}
function typeStyle(member: ResolvedMember): CSSProperties | undefined {
  const css = member.css.light;
  if (member.$type === "fontFamily") return { fontFamily: css };
  if (member.$type === "fontWeight") return { fontWeight: css };
  if (member.slot === "tokens.line-height") return { lineHeight: css };
  if (member.slot === "tokens.letter-spacing") return { letterSpacing: css };
  if (member.$type === "dimension" && /(?:font|body|heading|display|caption)-size$/.test(member.slot)) return { fontSize: css };
  return undefined;
}
const entries = (context: DesignerSpecimenContext, leaf: string) => Object.entries(context.profile.values.members).filter(([, member]) => member.slot === leaf);
export function tokenSpecimenItems(context: DesignerSpecimenContext, leaf: string): readonly SpecimenItem<TokenAssetSpecimenValue>[] {
  return entries(context, leaf).map(([id]) => ({ id, label: id.slice(leaf.length + 1), value: { memberId: id } }));
}
export const assetSpecimenItems = tokenSpecimenItems;
export function colorRampSpecimenItems(context: DesignerSpecimenContext, leaf: string): readonly SpecimenItem<ColorRampSpecimenValue>[] {
  const members = entries(context, leaf).filter(([, member]) => member.$type === "color" || member.$type === "gradient");
  return members.length ? [{ id: leaf, label: leaf, value: { memberIds: members.map(([id]) => id) } }] : [];
}

type Mode = "swatch" | "color-ramp" | "type-ladder" | "spacing-ladder" | "radius-ladder" | "motion-player" | "asset-grid" | "icon-grid";
function chromeNeeds(mode: Mode, context: DesignerSpecimenContext): readonly string[] {
  const dimensions = mode === "swatch" || mode === "color-ramp"
    ? [["tokens.spacing.5xl", "--spacing-5xl"], ["tokens.spacing.4xl", "--spacing-4xl"]] as const
    : mode === "motion-player" ? [["tokens.spacing.4xl", "--spacing-4xl"]] as const : [];
  const colors = mode === "asset-grid" || mode === "icon-grid" ? [
    ["tokens.surface-color.raised", "--color-surface-raised"], ["tokens.surface-color.inverse", "--color-surface-inverse"],
    ["tokens.text-color.primary", "--color-ink-primary"], ["tokens.text-color.on-inverse", "--color-ink-on-inverse"],
  ] as const : [];
  return [...dimensions.map(([id, emit]) => ({ id, emit, type: "dimension" })), ...colors.map(([id, emit]) => ({ id, emit, type: "color" }))].flatMap(({ id, emit, type }) => {
    const member = context.profile.values.members[id];
    return member && member.slot === id.slice(0, id.lastIndexOf(".")) && member.$type === type && member.emit === emit && valid(member)
      ? [] : [`required-token: ${id} requires a valid selected ${type} mapped to ${emit}.`];
  });
}
const baseLeaves = ["components.semantic-content"] as const;
function requirements(mode: Mode): readonly string[] {
  return [...baseLeaves, ...(mode === "motion-player" ? ["components.button"] : mode === "asset-grid" ? ["components.logo"] : mode === "icon-grid" ? ["components.icon"] : [])];
}
function valueNeed(mode: Mode, item: SpecimenItem, context: DesignerSpecimenContext): string | undefined {
  if (mode === "color-ramp") {
    const ids = memberIds(item.value);
    if (!ids) return "A color ramp needs one or more selected color member identities.";
    for (const id of ids) {
      const member = context.profile.values.members[id];
      if (!member || !["color", "gradient"].includes(member.$type) || !valid(member) || !pairOf(context, member)) return `No valid selected color and contrast pair for ${id}.`;
    }
    return;
  }
  const member = memberOf(context, item.value);
  if (!member) return "The specimen item does not identify a selected consumer member.";
  if (mode === "icon-grid") {
    if (member.$type !== "glyph") return "The icon specimen requires a selected glyph.";
    try { inspectGlyph(member.value.light); } catch { return "The selected glyph is invalid."; }
    return;
  }
  if (mode === "asset-grid") {
    if (isImageResource(member.value.light)) return "A native image rendering capability is unavailable for this selected image resource.";
    if (member.$type !== "svg" || typeof member.value.light !== "string") return "No native value-applied asset capability is available for this member.";
    try { inspectSvg(member.value.light, memberId(item.value) === "assets.favicon.vector" ? { favicon: true } : undefined); } catch { return "The selected artwork is invalid."; }
    return;
  }
  if (!valid(member)) return "The selected token value is invalid.";
  if (mode === "swatch" && (!["color", "gradient"].includes(member.$type) || !pairOf(context, member))) return "A swatch requires a selected color and contrast pair.";
  if (mode === "type-ladder" && !typeStyle(member)) return "The token has no applicable typography property.";
  if ((mode === "spacing-ladder" || mode === "radius-ladder") && member.$type !== "dimension") return "The ruler or box requires a selected dimension.";
  if (mode === "motion-player" && (!["duration", "cubicBezier"].includes(member.$type) || !motionValues(context, member))) return "Motion requires valid selected duration and easing tokens.";
}
function motionValues(context: DesignerSpecimenContext, member: ResolvedMember): { duration: string; easing: string } | undefined {
  const values = Object.values(context.profile.values.members);
  const duration = member.$type === "duration" ? member : values.find(value => value.$type === "duration" && valid(value));
  const easing = member.$type === "cubicBezier" ? member : values.find(value => value.$type === "cubicBezier" && valid(value));
  return duration && easing && valid(duration) && valid(easing) ? { duration: duration.css.light, easing: easing.css.light } : undefined;
}
function validate(mode: Mode, props: SpecimenLeafProps, layout: SpecimenLayout): readonly DesignerSpecimenNeed[] {
  const leaf: SpecimenLeafId = `sections.specimen-${mode}`;
  if (!props.items.length) return [{ leaf, reason: "zero-items: a specimen leaf requires at least one item" }];
  const needs: DesignerSpecimenNeed[] = [...specimenLayoutNeeds({ ...props, id: leaf, layout })];
  for (const reason of chromeNeeds(mode, props.context)) needs.push({ leaf, reason });
  for (const required of requirements(mode).filter(leaf => leaf !== "components.semantic-content")) { const bound = selected(props.context, required); if (isNeed(bound)) needs.push(bound); }
  for (const item of props.items) { const reason = valueNeed(mode, item, props.context); if (reason) needs.push({ leaf, reason: `${item.id}: ${reason}` }); }
  return needs;
}
function Swatch({ id, member, context }: { id: string; member: ResolvedMember; context: DesignerSpecimenContext }): ReactNode {
  const pair = pairOf(context, member);
  if (!pair) return null; // The leaf validates every item before rendering any layout.
  return <>{(["light", ...(member.css.dark === undefined ? [] : ["dark"])] as const).map(mode => {
    const color = mode === "dark" ? member.css.dark ?? member.css.light : member.css.light;
    const pairColor = mode === "dark" ? pair[1].css.dark ?? pair[1].css.light : pair[1].css.light;
    return <Content as="section" key={mode} data-specimen-mode={mode}>
      <Content as="span" role="img" aria-label={`${id} ${mode}`} style={{ display: "inline-block", inlineSize: "var(--spacing-5xl)", blockSize: "var(--spacing-4xl)", background: color }} />
      <Content as="span">{id}</Content><Content as="span">{color}</Content>
      <Content as="p" data-contrast-pair={pair[0]} style={{ background: member.emit?.includes("ink") ? pairColor : color, color: member.emit?.includes("ink") ? color : pairColor }}>{specimenDataset.tokens.sampleText}</Content>
    </Content>;
  })}</>;
}
/** Animation state is local to the specimen; the cell and consumer values stay read-only. */
function MotionPlayer({ id, duration, easing }: { id: string; duration: string; easing: string }): ReactNode {
  const target = useRef<HTMLDivElement | null>(null), running = useRef<Animation | undefined>(undefined);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : undefined;
    const changed = () => { setReduced(media?.matches ?? false); if (media?.matches) running.current?.cancel(); };
    changed(); media?.addEventListener?.("change", changed);
    return () => { media?.removeEventListener?.("change", changed); running.current?.cancel(); };
  }, []);
  const play = () => {
    running.current?.cancel();
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(reduce);
    if (reduce) return;
    running.current = target.current?.animate?.([{ transform: "translateX(0)" }, { transform: "translateX(var(--spacing-4xl))" }], { duration: Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000), easing, fill: "forwards" });
  };
  return <Content as="section" data-motion-specimen={id}>
    <Content as="div" ref={target} role="img" aria-label={id} className="size-lg bg-accent" style={{ transform: reduced ? "translateX(var(--spacing-4xl))" : undefined }} data-reduced-motion={reduced ? "static-final" : undefined} />
    <Button onPress={play}>Play motion</Button>
    {reduced ? <Content as="p" role="status">Reduced motion is enabled.</Content> : null}
  </Content>;
}
function renderItem(mode: Mode, item: SpecimenItem, props: SpecimenLeafProps): ReactNode {
  const semantic = selected(props.context, "components.semantic-content");
  if (isNeed(semantic)) return props.need(semantic);
  if (mode === "color-ramp") return <>{memberIds(item.value)?.map(id => {
    const member = props.context.profile.values.members[id];
    return member ? <Swatch key={id} id={id} member={member} context={props.context} /> : null;
  })}</>;
  const member = memberOf(props.context, item.value), id = memberId(item.value);
  if (!member || !id) return props.need({ leaf: item.id, reason: "No selected specimen value." });
  if (mode === "swatch") return <Swatch id={id} member={member} context={props.context} />;
  if (mode === "type-ladder") return <Content as="p" data-type-sample={id} style={typeStyle(member)}>{specimenDataset.tokens.sampleText}</Content>;
  if (mode === "spacing-ladder") return <Content as="div" role="img" aria-label={id} className="h-sm max-w-full bg-accent border-s border-e border-line-strong" style={{ inlineSize: member.css.light }} />;
  if (mode === "radius-ladder") return <Content as="div" role="img" aria-label={id} className="size-3xl border border-line-strong bg-surface-raised" style={{ borderRadius: member.css.light }} />;
  if (mode === "motion-player") {
    const button = selected(props.context, "components.button"), motion = motionValues(props.context, member);
    return isNeed(button) ? props.need(button) : motion ? <MotionPlayer id={id} {...motion} /> : props.need({ leaf: id, reason: "Selected motion values are unavailable." });
  }
  const artwork = selected(props.context, mode === "icon-grid" ? "components.icon" : "components.logo");
  if (isNeed(artwork)) return props.need(artwork);
  return <>{(["light", "dark"] as const).map(ground => <Content as="div" key={ground} data-asset-ground={ground} style={{ background: ground === "light" ? "var(--color-surface-raised)" : "var(--color-surface-inverse)", color: ground === "light" ? "var(--color-ink-primary)" : "var(--color-ink-on-inverse)" }}>
    {mode === "icon-grid" ? <Icon glyph={member.value.light as IconNode} decorative={false} label={`${id} ${ground}`} /> : typeof member.value.light === "string" ? <Logomark src={`data:image/svg+xml,${encodeURIComponent(member.value.light)}`} size="lg" title={id} /> : null}
  </Content>)}</>;
}
function definition(mode: Mode, kind: string, layout: SpecimenLayout, layer: "tokens" | "assets", span: SpecimenSpan): TokenAssetSpecimenDefinition {
  const id: SpecimenLeafId = `sections.specimen-${mode}`;
  const requiredLeaves = [...requirements(mode), "components.grid-list", "components.disclosure"];
  return {
    id, layout, span, compatible: [{ kind, layer }], cardinality: { minItems: 1 }, requirements: requiredLeaves, requiredLeaves, capabilities: ["native-consumer-components", "read-only", "value-applied", ...(mode === "motion-player" ? ["reduced-motion-static-final"] : [])],
    validate: props => validate(mode, props, layout),
    render: props => {
      const needs = validate(mode, props, layout);
      if (needs.length) return needs.map((need, index) => <ContentNeed key={index} need={need} render={props.need} />);
      return <SpecimenLayoutSection {...props} id={id} label={id} layout={layout} renderItem={item => renderItem(mode, item, props)} />;
    },
  };
}
function ContentNeed({ need, render }: { need: DesignerSpecimenNeed; render: SpecimenLeafProps["need"] }): ReactNode { return render(need); }
/** Concrete executable cohort registry; the aggregate imports this array rather than reconstructing metadata. */
export const tokenAssetSpecimenLeaves: readonly TokenAssetSpecimenDefinition[] = [
  definition("swatch", "color", "grid", "tokens", "third"), definition("color-ramp", "color-ramp", "grid", "tokens", "full"),
  definition("type-ladder", "type", "ladder", "tokens", "full"), definition("spacing-ladder", "spacing", "ladder", "tokens", "full"),
  definition("radius-ladder", "radius", "ladder", "tokens", "full"), definition("motion-player", "motion", "ladder", "tokens", "full"),
  definition("asset-grid", "asset", "grid", "assets", "third"), definition("icon-grid", "icon", "grid", "assets", "third"),
];
export const SpecimenSwatch = tokenAssetSpecimenLeaves[0]!.render;
export const SpecimenColorRamp = tokenAssetSpecimenLeaves[1]!.render;
export const SpecimenTypeLadder = tokenAssetSpecimenLeaves[2]!.render;
export const SpecimenSpacingLadder = tokenAssetSpecimenLeaves[3]!.render;
export const SpecimenRadiusLadder = tokenAssetSpecimenLeaves[4]!.render;
export const SpecimenMotionPlayer = tokenAssetSpecimenLeaves[5]!.render;
export const SpecimenAssetGrid = tokenAssetSpecimenLeaves[6]!.render;
export const SpecimenIconGrid = tokenAssetSpecimenLeaves[7]!.render;
