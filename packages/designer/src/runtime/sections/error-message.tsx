import { ErrorState } from "../../blocks/ErrorState.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import type { SurfaceRendererEntry } from "../contract.js";
import { memberValue, optionalText, readSectionContent, required, text } from "./group-a-content.js";
import { messageActions, messageHost } from "./boundary-message-content.js";

const LEAF = "sections.error-message";
const KINDS = ["not-found", "error", "global-error"] as const;
export const errorMessageInputs = {
  slots: ["status", "title", "description", "actions", "reference"],
  members: KINDS.map(kind => `kind.${kind}`),
};

/** Named retired-id adapter. All status copy renders inside the registered ErrorState anatomy. */
export const errorMessageRenderer: SurfaceRendererEntry = {
  leaf: LEAF,
  sample: dataset => ({
    status: dataset.sections.errorState.code,
    title: dataset.sections.errorState.title,
    description: dataset.sections.errorState.description,
    actions: [{ label: dataset.sections.errorState.report.label, href: dataset.sections.errorState.report.href }],
  }),
  render(input) {
    const content = readSectionContent(input, LEAF, errorMessageInputs);
    const kind = memberValue(content, "kind", KINDS) ?? "error";
    const status = text(content, required(content, "status"), "status");
    const title = text(content, required(content, "title"), "title");
    const description = text(content, required(content, "description"), "description");
    const reference = optionalText(content, content.values.reference, "reference");
    const host = messageHost(input, content), [action] = messageActions(content, host, 1);
    return (
      <SemanticContent as="section" {...dsAttrs("sections", LEAF, `foundry/${LEAF}`)} aria-label={title} data-message-kind={kind} aria-busy={host.pending} className="flex flex-col gap-sm text-center">
        <ErrorState kind={kind === "not-found" ? "not-found" : "failure"} title={<SemanticContent as="span" dir="auto">{title}</SemanticContent>} description={<SemanticContent as="span" dir="auto">{description}</SemanticContent>} code={<><SemanticContent as="span" dir="auto">{status}</SemanticContent>{reference === undefined ? null : <SemanticContent as="span" dir="auto">{reference}</SemanticContent>}</>} retry={action} />
      </SemanticContent>
    );
  },
};
