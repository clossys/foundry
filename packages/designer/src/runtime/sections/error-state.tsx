import { ErrorState } from "../../blocks/ErrorState.js";
import type { ErrorStateKind } from "../../blocks/ErrorState.js";

import { actionsOf, anatomyOf, memberOf, noop, refuseUnmapped, requiredAnatomy, slotValue, textOf, type SectionInputs, type SectionRenderer } from "./group-c-content.js";
import { componentLeaf } from "../component-leaf.js";

const Button = componentLeaf<typeof import("../../components/Button.js").Button>("components.button");
const Link = componentLeaf<typeof import("../../components/Link.js").Link>("components.link");

const LEAF = "sections.error-state";
const KINDS: readonly ErrorStateKind[] = ["not-found", "failure", "forbidden", "offline"];

/**
 * code -> ErrorState.code; retry -> ErrorState.retry (a button); report -> ErrorState.report (a link when it has
 * an href); kind.* -> ErrorState.kind. The title is anatomy copy no contract slot carries.
 */
export const errorStateInputs: SectionInputs = {
  slots: ["code", "retry", "report"],
  members: ["kind.not-found", "kind.failure", "kind.forbidden", "kind.offline"],
};

export const renderErrorState: SectionRenderer = input => {
  refuseUnmapped(input, errorStateInputs);
  const title = requiredAnatomy(input, LEAF, "heading");
  const { description } = anatomyOf(input);
  // ErrorState requires a kind; with no kind member selected the generic failure renders.
  const kind = memberOf(input, "kind") ?? "failure";
  if (!(KINDS as readonly string[]).includes(kind)) throw new TypeError(`${LEAF}: kind.${kind} is not an ErrorState kind`);
  const [retry] = actionsOf(LEAF, "retry", slotValue(input, "retry"), 1);
  const [report] = actionsOf(LEAF, "report", slotValue(input, "report"), 1);
  return (
    <ErrorState
      kind={kind as ErrorStateKind}
      title={title}
      description={description}
      code={textOf(slotValue(input, "code"))}
      retry={retry ? <Button variant="primary" onPress={noop}>{retry.label}</Button> : undefined}
      report={report ? report.href ? <Link href={report.href}>{report.label}</Link> : <Button variant="secondary" onPress={noop}>{report.label}</Button> : undefined}
    />
  );
};
