/**
 * sections.pricing: PricingTable tiers with interval prices, features and a Link call to action. `interval`
 * selects the displayed amount; `highlight` names the highlighted tier ids.
 */
import type { ReactNode } from "react";
import { PricingTable, type PricingTier } from "../../blocks/PricingTable.js";
import { list, object, optionalText, readSectionContent, required, SectionContentError, text, texts, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

import { componentLeaf } from "../component-leaf.js";
const Link = componentLeaf<typeof import("../../components/Link.js").Link>("components.link");

export const pricingInputs: SectionRendererInputs = { slots: ["highlight", "interval", "plans"], members: [] };

export function renderPricingSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.pricing", pricingInputs);
  const highlighted = content.values.highlight === undefined ? [] : texts(content, content.values.highlight, "highlight");
  const tiers = list(content, required(content, "plans"), "plans").map((row, index): PricingTier => {
    const plan = object(content, row, `plans.${index}`), id = text(content, plan.id, `plans.${index}.id`), at = `plans.${index}`;
    const isHighlighted = highlighted.includes(id);
    const base = {
      id,
      name: text(content, plan.name, `${at}.name`),
      description: optionalText(content, plan.description, `${at}.description`),
      features: texts(content, plan.features, `${at}.features`),
      cta: (() => {
        const action = object(content, plan.cta, `${at}.cta`);
        const requested = optionalText(content, action.variant, `${at}.cta.variant`) ?? (isHighlighted ? "primary" : "outline");
        const variant = (["primary", "secondary", "outline", "ghost", "tonal", "quiet"] as const).find(value => value === requested);
        if (!variant) throw new SectionContentError(content.leaf, `${at}.cta.variant is not a link button variant`);
        return <Link href={text(content, action.href, `${at}.cta.href`)} buttonVariant={variant}>{text(content, action.label, `${at}.cta.label`)}</Link>;
      })(),
      isHighlighted,
      badge: optionalText(content, plan.badge, `${at}.badge`),
    };
    if (plan.price !== undefined && plan.price !== null) return { ...base, price: text(content, plan.price, `${at}.price`) };
    if (plan.priceByInterval === undefined) return { ...base, price: null };
    const prices = object(content, plan.priceByInterval, `${at}.priceByInterval`);
    return { ...base, priceByInterval: Object.fromEntries(Object.entries(prices).map(([interval, value]) => {
      const price = object(content, value, `${at}.priceByInterval.${interval}`);
      return [interval, { amount: text(content, price.amount, `${at}.priceByInterval.${interval}.amount`), priceText: text(content, price.priceText, `${at}.priceByInterval.${interval}.priceText`) }];
    })) };
  });
  for (const id of highlighted) if (!tiers.some(tier => tier.id === id)) throw new SectionContentError(content.leaf, `highlight names unknown plan ${id}`);
  return <PricingTable tiers={tiers} interval={optionalText(content, content.values.interval, "interval")} />;
}
