import { DetailView, type DetailViewField } from "../../blocks/DetailView.js";
import { Badge } from "../../components/Badge.js";
import { ActionPart, type ActionContent } from "./group-b-parts.js";
import { entryOf, recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

/**
 * sections.record-detail: fields render as DetailView's description list, actions as Buttons (at most two,
 * per the contract) and the status copy as a Badge in the title row. DetailView has no grouped ledger API, so
 * the fill leaves groups unmapped and the renderer never invents it.
 */
export function renderRecordDetail(input: SectionRenderInput) {
  const entry = entryOf<ActionContent | readonly ActionContent[]>(input, "actions");
  const actions: readonly ActionContent[] = entry === undefined ? [] : Array.isArray(entry) ? entry : [entry as ActionContent];
  const status = entryOf<string>(input, "status");
  return <DetailView
    title={status === undefined ? "Order details" : <>Order details <Badge>{status}</Badge></>}
    fields={recordsOf<DetailViewField>(input, "fields")}
    actions={actions.length ? <>{actions.slice(0, 2).map((action, index) => <ActionPart key={action.id ?? index} content={action} />)}</> : undefined}
  />;
}

export const recordDetailSection: GroupBSection = { leaf: "sections.record-detail", slots: ["actions", "fields", "status"], render: renderRecordDetail };
