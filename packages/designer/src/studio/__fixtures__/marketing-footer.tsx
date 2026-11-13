import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { renderSiteFooter } from "../../runtime/frames/site-footer.js";

/** Generic authored example content; production copy remains host-owned. */
export const marketingFooterContent = {
  columns: [
    { id: "company", heading: "ExampleCo", links: [{ label: "About", href: "/about" }, { label: "Contact", href: "/contact" }] },
    { id: "resources", heading: "Resources", links: [{ label: "Help", href: "/help" }, { label: "Guides", href: "/guides" }] },
  ],
  links: [{ label: "Accessibility", href: "/accessibility" }],
  legal: { entity: "ExampleCo", linksLabel: "Legal and privacy", links: [{ label: "Privacy", href: "/privacy" }, { label: "Terms", href: "/terms" }], privacyChoices: { label: "Privacy choices" } },
} as const satisfies Readonly<Record<string, RuntimeJson>>;

export const marketingFooterSpecimen = {
  leaf: "frames.site-footer", specimen: "sections.specimen-frame-viewports",
  payload: marketingFooterContent,
  native: { leaf: "components.button", part: "LinkButton", variant: "link", source: "shadcn@aria" },
  states: ["default", "without-privacy"] as const,
  needs: [
    "NEED the selected components.button descriptor to expose its actual LinkButton secondary export.",
    "NEED the host ConsumerComponentProvider and selected module index from the native component bridge.",
    "NEED the registered sections.specimen-frame-viewports protocol and descriptor-matched host surface binding.",
  ],
} as const;

/** Shape consumed by DesignerSpecimenContext.surfaces; the host supplies its checked descriptor hash. */
export function marketingFooterSpecimenBinding(descriptorHash: string, input: RuntimeRenderInput<ReactNode>) {
  return {
    descriptorHash,
    states: marketingFooterSpecimen.states,
    render({ state }: { width: number; state: string }): ReactNode {
      if (!marketingFooterSpecimen.states.includes(state as "default" | "without-privacy")) throw new TypeError("NEED a registered footer specimen state");
      const { privacyChoices: _control, ...legal } = marketingFooterContent.legal;
      const values = { ...marketingFooterContent, legal: state === "without-privacy" ? legal : marketingFooterContent.legal };
      const content = Object.fromEntries(Object.entries(values).map(([slot, value]) => [slot, {
        reference: { kind: "region" as const, ref: `example-footer:${slot}` }, value, hash: "sha256:0" as const,
      }]));
      return renderSiteFooter({ ...input, content });
    },
  };
}
