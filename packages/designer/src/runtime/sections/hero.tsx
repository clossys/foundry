/** sections.hero: Hero with its intro header, chart or mark media and up to two Link actions. */
import type { ReactNode } from "react";
import { checkConsumerArtContract, type StillBackdropArt } from "../../backdrop/consumer-art.js";
import { checkRuntimeBackdrop, type BackdropModuleLoaders, type RuntimeBackdropResource } from "../../backdrop/runtime-module.js";
import { checkVideoBackdrop, type VideoBackdropResource } from "../../backdrop/VideoBackdrop.js";
import { Hero } from "../../blocks/Hero.js";
import { actionNode, mediaNode, memberValue, object, optionalText, readSectionContent, required, SectionContentError, text, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const heroInputs: SectionRendererInputs = {
  slots: ["actions", "backdrop", "header", "media"],
  members: ["layout.editorial", "layout.split", "layout.full-bleed", "ground.base", "ground.inverse", "backdrop.scrim.light", "backdrop.scrim.strong", "size.display", "size.compact", "size.default"],
};

export function renderHeroSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.hero", heroInputs);
  const header = object(content, required(content, "header"), "header");
  const actions = content.values.actions === undefined ? undefined : object(content, content.values.actions, "actions");
  const extra = actions && Object.keys(actions).find(key => key !== "primary" && key !== "secondary");
  if (extra) throw new SectionContentError(content.leaf, `actions.${extra}: one primary and one secondary action`);
  const backdrop = content.values.backdrop;
  const runtimeBackdrop = checkRuntimeBackdrop(backdrop);
  const videoBackdrop = checkVideoBackdrop(backdrop);
  if (backdrop !== undefined && !runtimeBackdrop && !videoBackdrop && !checkConsumerArtContract(backdrop).ok) throw new SectionContentError(content.leaf, "backdrop must be checked static art, video or a local runtime declaration");
  let backdropModules: BackdropModuleLoaders | undefined;
  if (runtimeBackdrop) {
    const modules = input.sectionHost?.backdropModules;
    if (!modules || typeof modules !== "object" || Array.isArray(modules)
      || !Object.hasOwn(modules, backdrop.moduleRef) || typeof (modules as Record<string, unknown>)[backdrop.moduleRef] !== "function") {
      throw new SectionContentError(content.leaf, "runtime backdrop requires its local module loader on the section host");
    }
    backdropModules = modules as BackdropModuleLoaders;
  }
  return (
    <Hero
      eyebrow={optionalText(content, header.eyebrow, "header.eyebrow")}
      heading={text(content, header.heading, "header.heading")}
      description={optionalText(content, header.description, "header.description")}
      actions={actions && <>
        {actionNode(content, actions.primary, "actions.primary", "primary")}
        {actions.secondary === undefined ? null : actionNode(content, actions.secondary, "actions.secondary", "outline")}
      </>}
      media={content.values.media === undefined ? undefined : mediaNode(content, content.values.media, "media")}
      backdrop={backdrop as StillBackdropArt | RuntimeBackdropResource | VideoBackdropResource | undefined}
      backdropModules={backdropModules}
      backdropScrim={memberValue(content, "backdrop.scrim", ["light", "strong"] as const)}
      ground={memberValue(content, "ground", ["base", "inverse"] as const)}
      composition={memberValue(content, "layout", ["editorial", "split", "full-bleed"] as const)}
      size={memberValue(content, "size", ["display", "compact", "default"] as const)}
    />
  );
}
