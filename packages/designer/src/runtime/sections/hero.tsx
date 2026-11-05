/** sections.hero: Hero with its intro header, chart or mark media and up to two Link actions. */
import type { ComponentProps, ReactNode } from "react";
import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";
import type { LinkButton as NativeLinkButton } from "../../components/preview-runtime/components/button/button.js";
import type { BarChart as BarChartComponent } from "../../charts/BarChart.js";
import type { LineChart as LineChartComponent } from "../../charts/LineChart.js";
import type { Logomark as LogoComponent } from "../../components/Logomark.js";
import { componentLeaf } from "../component-leaf.js";
import { heroCopyOf } from "./hero-copy.js";
import { resolveHeroBackdrop, type HeroBackdrop } from "../../blocks/hero/hero-backdrop.js";
import { Hero } from "../../blocks/Hero.js";
import { list, memberValue, numbers, object, readSectionContent, required, SectionContentError, text, texts, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

const LinkButton = componentLeaf<typeof NativeLinkButton>("components.button", "LinkButton");
type NativeActionVariant = NonNullable<ComponentProps<typeof NativeLinkButton>["variant"]>;
const ACTION_VARIANTS = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const satisfies readonly NativeActionVariant[];
const Logo = componentLeaf<typeof LogoComponent>("components.logo");
const BarChart = componentLeaf<typeof BarChartComponent>("components.chart-bar");
const LineChart = componentLeaf<typeof LineChartComponent>("components.chart-line");

export const heroInputs: SectionRendererInputs = {
  slots: ["actions", "backdrop", "header", "media"],
  members: ["layout.editorial", "layout.split", "layout.full-bleed", "ground.base", "ground.inverse", "backdrop.scrim.light", "backdrop.scrim.strong", "size.display", "size.compact", "size.default"],
};

export function renderHeroSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.hero", heroInputs);
  object(content, required(content, "header"), "header");
  const copy = heroCopyOf(input);
  const actions = content.values.actions === undefined ? undefined : object(content, content.values.actions, "actions");
  const extra = actions && Object.keys(actions).find(key => key !== "primary" && key !== "secondary");
  if (extra) throw new SectionContentError(content.leaf, `actions.${extra}: one primary and one secondary action`);
  const backdrop = content.values.backdrop;
  resolveHeroBackdrop(backdrop, input.profile.values, input.cell.theme === "dark" ? "dark" : "light");
  const action = (value: RuntimeJson | undefined, path: "primary" | "secondary", fallback: "default" | "outline") => {
    const record = object(content, value, `actions.${path}`);
    const label = copy[`actions.${path}.label`];
    if (!label) throw new SectionContentError(content.leaf, `heroCopy.actions.${path}.label is required for the bound action`);
    const variant = record.variant === undefined ? fallback : text(content, record.variant, `actions.${path}.variant`);
    if (!(ACTION_VARIANTS as readonly string[]).includes(variant)) throw new SectionContentError(content.leaf, `actions.${path}.variant must be a native LinkButton variant`);
    return <LinkButton href={text(content, record.href, `actions.${path}.href`)} variant={variant as NativeActionVariant} size="default">{label}</LinkButton>;
  };
  const media = content.values.media === undefined ? undefined : object(content, content.values.media, "media");
  let renderedMedia: ReactNode;
  if (media) {
    if (!copy["media.title"]) throw new SectionContentError(content.leaf, "heroCopy.media.title is required for bound media");
    if (media.kind === "mark") renderedMedia = <Logo src={text(content, media.src, "media.src")} size="lg" title={copy["media.title"]} />;
    else {
      if (media.kind !== "chart") throw new SectionContentError(content.leaf, "media.kind has no registered media component");
      const series = list(content, media.series, "media.series").map((value, index) => {
        const row = object(content, value, `media.series.${index}`);
        return { name: copy["media.series[].name"] ?? text(content, row.name, `media.series.${index}.name`), values: numbers(content, row.values, `media.series.${index}.values`) };
      });
      if (media.chart === "bar") renderedMedia = <BarChart title={copy["media.title"]} categories={texts(content, media.categories, "media.categories")} series={series} fit="fluid" marks="static" />;
      else if (media.chart === "line") renderedMedia = <LineChart title={copy["media.title"]} x={numbers(content, media.x, "media.x")} series={series} />;
      else throw new SectionContentError(content.leaf, "media.chart has no registered chart component");
    }
  }
  return (
    <Hero
      eyebrow={copy["header.eyebrow"]}
      heading={copy["header.heading"]}
      description={copy["header.description"]}
      actions={actions && <>
        {action(actions.primary, "primary", "default")}
        {actions.secondary === undefined ? null : action(actions.secondary, "secondary", "outline")}
      </>}
      media={renderedMedia}
      backdrop={backdrop as HeroBackdrop | undefined}
      backdropValues={input.profile.values}
      backdropMode={input.cell.theme === "dark" ? "dark" : "light"}
      backdropScrim={memberValue(content, "backdrop.scrim", ["light", "strong"] as const)}
      ground={memberValue(content, "ground", ["base", "inverse"] as const)}
      composition={memberValue(content, "layout", ["editorial", "split", "full-bleed"] as const)}
      size={memberValue(content, "size", ["display", "compact", "default"] as const)}
    />
  );
}
