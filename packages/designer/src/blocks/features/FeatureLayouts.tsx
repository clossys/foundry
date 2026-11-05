import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { SemanticContent } from "../../components/SemanticContent.js";
import type * as NativeTabs from "../../components/preview-runtime/components/tabs/tabs.js";
import { componentLeaf } from "../../runtime/component-leaf.js";
import { cx } from "../../components/internal/cx.js";
import { SectionHeader } from "../SectionHeader.js";
import { Item } from "../items/Item.js";
import { Items } from "../items/Items.js";
import type { ItemSpan } from "../items/types.js";
import type { FeatureLayoutItem, FeatureLayoutProps } from "./types.js";
import { FeatureMotionStyles } from "./parts.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";

type Props = FeatureLayoutProps;
const Tabs = componentLeaf<typeof NativeTabs.Tabs>("components.tabs");
const TabsList = componentLeaf<typeof NativeTabs.TabsList>("components.tabs", "TabsList");
const TabsTrigger = componentLeaf<typeof NativeTabs.TabsTrigger>("components.tabs", "TabsTrigger");
const TabsContent = componentLeaf<typeof NativeTabs.TabsContent>("components.tabs", "TabsContent");

function FeatureCopy({ item, ground }: { item: FeatureLayoutItem; ground: SectionGround }) {
  return <Item id={item.id} heading={item.heading} description={item.description} icon={item.icon} treatment="plain" size="standard" ground={ground} />;
}

/** The logical start column follows the document direction; odd rows reverse it at tablet. */
function FeatureRows({ items, ground }: Pick<Props, "items" | "ground">) {
  return <SemanticContent as="ul" role="list" className="m-0 grid list-none gap-3xl p-0">
    {items.map((item, index) => <SemanticContent as="li" key={item.id} data-feature-row={index} className="grid grid-cols-1 items-center gap-xl tablet:grid-cols-2">
      <SemanticContent as="div" data-feature-figure="" className={index % 2 === 0 ? "min-w-0 tablet:col-start-1 tablet:row-start-1" : "min-w-0 tablet:col-start-2 tablet:row-start-1"}>{item.visual}</SemanticContent>
      <SemanticContent as="div" className={index % 2 === 0 ? "min-w-0 tablet:col-start-2 tablet:row-start-1" : "min-w-0 tablet:col-start-1 tablet:row-start-1"}><FeatureCopy item={item} ground={ground} /></SemanticContent>
    </SemanticContent>)}
  </SemanticContent>;
}

/** Static first render is also the no-JavaScript rendering. Motion is progressive. */
export function ScrollFeatures({ items, ground }: Pick<Props, "items" | "ground">) {
  const [enhanced, setEnhanced] = useState(false);
  const [active, setActive] = useState(0);
  const steps = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setEnhanced(Boolean(preference && !preference.matches && window.CSS?.supports?.("animation-timeline", "view()") && window.IntersectionObserver));
    update();
    preference?.addEventListener("change", update);
    return () => preference?.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!enhanced || !steps.current) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.featureStep));
    }, { threshold: 0.5 });
    for (const step of steps.current.children) observer.observe(step);
    return () => observer.disconnect();
  }, [enhanced, items]);
  const motion: CSSProperties | undefined = enhanced ? { animation: "var(--animate-scroll-reveal)", animationName: "reveal", animationTimeline: "view()", animationRange: "entry 0% cover 50%" } : undefined;
  return <><FeatureMotionStyles /><SemanticContent as="div" data-features-scroll={enhanced ? "enhanced" : "static"} className={enhanced ? "grid grid-cols-1 gap-xl tablet:grid-cols-2 tablet:items-start" : "flex flex-col"}>
    {enhanced ? <SemanticContent as="div" data-feature-sticky="" className="min-w-0 tablet:sticky tablet:top-lg tablet:self-start" style={{ animation: "var(--animate-scroll-sticky)", animationName: "features-sticky", animationTimeline: "view()" }}>{items[active]?.visual}</SemanticContent> : null}
    <SemanticContent as="ul" ref={steps} role="list" className="m-0 flex list-none flex-col gap-3xl p-0">
      {items.map((item, index) => <SemanticContent as="li" key={item.id} data-feature-step={index} className="flex min-w-0 flex-col gap-xl" style={enhanced ? { paddingBlock: "var(--spacing-3xl)", minBlockSize: "calc(var(--spacing-3xl) * 4)" } : undefined}>
        {!enhanced ? <SemanticContent as="div" data-feature-figure="">{item.visual}</SemanticContent> : null}
        <SemanticContent as="div" data-feature-step-copy="" data-feature-motion={enhanced ? "" : undefined} data-designer-reveal={enhanced ? "" : undefined} style={motion}><FeatureCopy item={item} ground={ground} /></SemanticContent>
      </SemanticContent>)}
    </SemanticContent>
  </SemanticContent></>;
}

/** Default counts fill ordered twelve-unit rows; explicit authored spans use the engine's guard. */
function bentoItems(items: readonly FeatureLayoutItem[]) {
  const patterns: Readonly<Record<number, readonly ItemSpan[]>> = {
    2: ["half", "half"], 3: ["third", "third", "third"], 4: ["half", "half", "half", "half"],
    5: ["two-thirds", "third", "third", "third", "third"], 6: ["third", "third", "third", "third", "third", "third"],
  };
  return items.some(item => item.span !== undefined) ? items : items.map((item, index) => ({ ...item, span: patterns[items.length]?.[index] }));
}

/** New members compose the existing collection, tabs and copy primitives. */
export function FeatureLayouts({ eyebrow, heading, description, items, headingLevel = 2, ground, layout, className, style, ...rest }: Props) {
  const labelId = useId();
  const label = rest["aria-label"];
  if (layout === "tabs" && heading == null && !label) throw new TypeError("FeatureGrid: tabs need a heading or an authored aria-label.");
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.id || seen.has(item.id)) throw new TypeError("FeatureGrid: item ids must be unique and nonempty.");
    seen.add(item.id);
  }
  return <SemanticContent as="div" {...rest} className={cx("flex flex-col gap-xl", SECTION_GROUND_CLASSES[ground].surface, className)} style={style} data-features-layout={layout}>
    {eyebrow !== undefined || heading !== undefined || description !== undefined ? <SectionHeader density="standard" level={headingLevel} ground={ground} eyebrow={eyebrow} title={heading == null ? heading : <SemanticContent as="span" id={labelId}>{heading}</SemanticContent>} description={description} /> : null}
    {layout === "bento" ? <Items arrangement="bento" treatment="plate" items={bentoItems(items)} ground={ground} /> : layout === "tabs" ? <Tabs>
      <TabsList aria-label={heading == null ? label : undefined} aria-labelledby={heading == null ? undefined : labelId}>{items.map(item => <TabsTrigger key={item.id} id={item.id}>{item.heading}</TabsTrigger>)}</TabsList>
      {items.map(item => <TabsContent key={item.id} id={item.id}><SemanticContent as="div" className="grid grid-cols-1 items-center gap-xl tablet:grid-cols-2"><FeatureCopy item={item} ground={ground} /><SemanticContent as="div" data-feature-figure="">{item.visual}</SemanticContent></SemanticContent></TabsContent>)}
    </Tabs> : layout === "alternating" ? <FeatureRows items={items} ground={ground} /> : <ScrollFeatures items={items} ground={ground} />}
  </SemanticContent>;
}
