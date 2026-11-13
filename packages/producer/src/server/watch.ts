import { join, resolve } from "node:path";
import type { AgentKind } from "../agents.js";
import { watchSlotModel } from "../records/slots.js";
import { AGENT_KINDS, CELL_ID } from "./cells.js";
import type { ChangeEvent } from "./contract.js";

/**
 * One recursive watcher per server, including when the agents directory is absent (the one reader's
 * watcher). With `memo`, it also keeps the one reader's answers between changes (see watchSlotModel).
 */
export async function watchCells(root: string, onChange: (event: ChangeEvent) => void, options: { readonly memo?: boolean } = {}): Promise<() => void> {
  return watchSlotModel(join(resolve(root), "clossys"), segments => {
    if (segments === null) { onChange({ agent: null, id: null, reload: true }); return; }
    // Flat slot model: agents/<agent>/<slot-id>/{slot.json,candidates/,pin.json}.
    const [kind, slot] = segments;
    const agent = AGENT_KINDS.includes(kind as AgentKind) ? kind as AgentKind : null;
    const id = agent && slot && CELL_ID.test(slot) ? slot : null;
    onChange({ agent, id, reload: true });
  }, options);
}
