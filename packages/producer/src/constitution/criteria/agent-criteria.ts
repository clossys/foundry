/**
 * The per-agent criteria by id: the static twin of every `criteria/<agent>/<unit>/index.json` folder,
 * so certification (synchronous) resolves agent requirements as it resolves core ones. agents.test.ts
 * joins each folder's index.json to this map both ways, so a registered criterion can never be
 * missing here and nothing unregistered can resolve.
 */
import type { Criterion } from "./core/types.js";
import { DIRECTOR_CRITERIA } from "./director/st-d/index.js";
import { PRODUCER_CRITERIA } from "./producer/st-p/index.js";
import { PUBLISHER_CRITERIA } from "./publisher/st-p/index.js";
import { WRITER_CRITERIA } from "./writer/st-w/index.js";

/** Every agent folder's map, by `<agent>/<unit>` folder. */
export const AGENT_CRITERIA_FOLDERS: Readonly<Record<string, Readonly<Record<string, Criterion>>>> = Object.freeze({
  "director/st-d": DIRECTOR_CRITERIA,
  "producer/st-p": PRODUCER_CRITERIA,
  "publisher/st-p": PUBLISHER_CRITERIA,
  "writer/st-w": WRITER_CRITERIA,
});

function merge(): Readonly<Record<string, Criterion>> {
  const out: Record<string, Criterion> = {};
  for (const [folder, map] of Object.entries(AGENT_CRITERIA_FOLDERS)) {
    for (const [id, fn] of Object.entries(map)) {
      if (Object.hasOwn(out, id)) throw new Error(`criterion ${id} is registered twice (again in ${folder})`);
      out[id] = fn;
    }
  }
  return Object.freeze(out);
}

export const AGENT_CRITERIA: Readonly<Record<string, Criterion>> = merge();
