// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement } from "react";
import { notFound } from "next/navigation";
import { PublishedPage, publishedLeaf } from "../../../components/StudioInstalledPage";

/** The leaves the record store held at install, from the content map's static params. */
const leaves: { slug: string }[] = [
  { slug: "context.market.size" },
  { slug: "context.market.trend" },
  { slug: "context.customer.need" },
  { slug: "context.customer.buying" },
  { slug: "context.competition.alternative" },
  { slug: "context.competition.gap" },
  { slug: "context.company.strength" },
  { slug: "context.company.constraint" },
  { slug: "aspiration.purpose.mission" },
  { slug: "aspiration.purpose.vision" },
  { slug: "aspiration.culture.belief" },
  { slug: "aspiration.culture.behavior" },
  { slug: "aspiration.goal.long-term" },
  { slug: "aspiration.goal.annual" },
  { slug: "focus.category.definition" },
  { slug: "focus.category.stance" },
  { slug: "focus.segment.core" },
  { slug: "focus.segment.next" },
  { slug: "focus.offer.included" },
  { slug: "focus.offer.excluded" },
  { slug: "focus.reach.geography" },
  { slug: "focus.reach.channel" },
  { slug: "focus.lifecycle.acquisition" },
  { slug: "focus.lifecycle.retention" },
  { slug: "advantage.proposition.promise" },
  { slug: "advantage.proposition.proof" },
  { slug: "advantage.defensibility.differentiator" },
  { slug: "advantage.defensibility.moat" },
  { slug: "advantage.model.pricing" },
  { slug: "advantage.model.margin" },
  { slug: "identity.brand.essence" },
  { slug: "identity.brand.personality" },
  { slug: "identity.naming.name" },
  { slug: "identity.naming.architecture" },
  { slug: "identity.verbal.narrative" },
  { slug: "identity.verbal.voice" },
  { slug: "identity.visual.style" },
  { slug: "identity.visual.imagery" },
  { slug: "capability.competency.critical" },
  { slug: "capability.competency.gap" },
  { slug: "capability.sourcing.build" },
  { slug: "capability.sourcing.partner" },
  { slug: "capability.sourcing.acquire" },
  { slug: "capability.operation.delivery" },
  { slug: "capability.operation.technology" },
  { slug: "capability.team.role" },
  { slug: "capability.team.structure" },
  { slug: "capability.resource.funding" },
  { slug: "capability.resource.allocation" },
  { slug: "execution.priority.bet" },
  { slug: "execution.priority.parked" },
  { slug: "execution.roadmap.milestone" },
  { slug: "execution.roadmap.release" },
  { slug: "execution.measure.north-star" },
  { slug: "execution.measure.driver" },
  { slug: "execution.risk.threat" },
  { slug: "execution.risk.mitigation" },
];
export const dynamicParams = true;
export function generateStaticParams() {
  return leaves;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await publishedLeaf("director", slug))) notFound();
  return createElement(PublishedPage, { page: "director", slug });
}
