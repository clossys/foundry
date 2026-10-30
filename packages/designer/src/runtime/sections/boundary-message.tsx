import { EmptyState } from "../../blocks/EmptyState.js";

import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import type { SurfaceRendererEntry } from "../contract.js";
import { memberValue, optionalText, readSectionContent, required, SectionContentError, text } from "./group-a-content.js";
import { messageActions, messageHost } from "./boundary-message-content.js";
import { componentLeaf } from "../component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

const LEAF = "sections.boundary-message";
const KINDS = ["sign-in-unavailable", "not-authorized", "service-unavailable", "sign-out-confirm"] as const;
export const boundaryMessageInputs = {
  slots: ["status", "title", "description", "actions", "notes"],
  members: KINDS.map(kind => `kind.${kind}`),
};

/** Private, landmark-free page content. The consumer selects state and performs every command. */
export const boundaryMessageRenderer: SurfaceRendererEntry = {
  leaf: LEAF,
  sample: dataset => ({
    status: dataset.sections.errorState.code,
    title: dataset.sections.errorState.title,
    description: dataset.sections.errorState.description,
    actions: [{ label: dataset.sections.errorState.report.label, href: dataset.sections.errorState.report.href }],
  }),
  render(input) {
    const content = readSectionContent(input, LEAF, boundaryMessageInputs);
    const kind = memberValue(content, "kind", KINDS) ?? "sign-in-unavailable";
    const status = text(content, required(content, "status"), "status");
    const title = text(content, required(content, "title"), "title");
    const description = text(content, required(content, "description"), "description");
    const notes = optionalText(content, content.values.notes, "notes");
    const host = messageHost(input, content), actions = messageActions(content, host, 2);
    if (kind === "sign-out-confirm" && actions.length !== 2) throw new SectionContentError(LEAF, "kind.sign-out-confirm requires confirm and cancel actions");
    return (
      <SemanticContent as="section" {...dsAttrs("sections", LEAF, `foundry/${LEAF}`)} aria-label={title} data-boundary-kind={kind} aria-busy={host.pending} className="flex flex-col gap-sm text-center">
        <SemanticContent as="h1" dir="auto" className="text-display-l font-display text-ink-primary">{status}</SemanticContent>
        <EmptyState title={<SemanticContent as="span" dir="auto">{title}</SemanticContent>} description={<SemanticContent as="span" dir="auto">{description}</SemanticContent>} action={actions.length ? actions : undefined} />
        {notes === undefined ? null : <SemanticContent as="p" dir="auto" className="text-body-s text-ink-secondary">{notes}</SemanticContent>}
      </SemanticContent>
    );
  },
};
