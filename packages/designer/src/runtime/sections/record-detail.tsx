import { DetailView } from "../../blocks/DetailView.js";

import { ActionPart, type ActionContent } from "./group-b-parts.js";
import { entryOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { recordDetailCopyOf } from "./copy-ports.js";
import { componentLeaf } from "../component-leaf.js";

const Badge = componentLeaf<typeof import("../../components/preview-runtime/components/badge/badge.js").Badge>("components.badge");
const Button = componentLeaf<typeof import("../../components/Button.js").Button>("components.button");
const Menu = componentLeaf<typeof import("../../components/Menu.js").Menu>("components.menu");

/**
 * sections.record-detail: fields render as DetailView's description list, actions as Buttons (at most two,
 * per the contract) and the status copy as a Badge in the title row. DetailView has no grouped ledger API, so
 * the fill leaves groups unmapped and the renderer never invents it.
 */

export function renderRecordDetail(input: SectionRenderInput) {
  const copy = recordDetailCopyOf(input);
  const entry = entryOf<ActionContent | readonly ActionContent[]>(input, "actions");
  const actions: readonly ActionContent[] = entry === undefined ? [] : Array.isArray(entry) ? entry : [entry as ActionContent];
  const status = entryOf<string>(input, "status");
  return <DetailView
    title={status === undefined ? copy.title : <>{copy.title} <Badge>{status}</Badge></>}
    fields={copy.fields}
    actions={actions.length ? <>{actions.slice(0, 2).map((action, index) => <ActionPart key={action.id ?? index} content={action} />)}</> : undefined}
    compactActions={actions.length ? <Menu trigger={<Button variant="secondary" size="md">{copy.actionsLabel}</Button>}>
      {actions.slice(0, 2).map((action, index) => <Menu.Item key={action.id ?? index} id={action.id ?? String(index)}>{action.label}</Menu.Item>)}
    </Menu> : undefined}
  />;
}

export const recordDetailSection: GroupBSection = { leaf: "sections.record-detail", slots: ["actions", "fields", "status"], render: renderRecordDetail };
