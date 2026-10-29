import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runtimeHash } from "@clossys/designer/catalog";
import { getAdminCopy } from "@clossys/writer/admin-copy";
import { createRequire } from "node:module";
const { openStrategy, readStrategyRoot } = createRequire(import.meta.url)("../../../../../strategist/dist/index.js");
import designer from "../../../../../designer/strategy-brief.json" with { type: "json" };
import writer from "../../../../../writer/strategy-brief.json" with { type: "json" };
import publisher from "../../../../strategy-brief.json" with { type: "json" };
import ui from "../../../../examples/strategy-page.copy.r1.en.json" with { type: "json" };
import { prepareAdminPageCopyEnvelopes } from "../admin-copy-source.js";
import { prepareStrategyPage } from "../strategy-page.js";

export const strategyExampleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../strategist/test-fixtures/strategy-v2/example");
export const strategyExampleRef = key => ({ id: ui.records.find(record => record.context === `foundry.example.strategy.${key}`).id });
/** This local allocator proposes canonical draft ids; it is not a Writer mint
 * API. The adapter collision-checks the actual owned ids and all input envelopes. */
export const strategyExampleLabels = {
  ...Object.fromEntries(["title", "direction", "because", "watch", "status", "missing", "empty"].map(key => [key, strategyExampleRef(key)])),
  templates: Object.fromEntries(["scope", "levels", "storyline", "l1", "l2", "brief", "metadata"].map(key => [key, strategyExampleRef(`${key}Summary`)])),
  boolean: { true: strategyExampleRef("valueTrue"), false: strategyExampleRef("valueFalse") },
  fileStatus: Object.fromEntries(["draft", "active", "retired", "missing"].map(key => [key, strategyExampleRef(`value${key[0].toUpperCase()}${key.slice(1)}`)])),
  briefState: Object.fromEntries(["ready", "missing", "stale"].map(key => [key, strategyExampleRef(`value${key[0].toUpperCase()}${key.slice(1)}`)])),
  critic: { "not judged": strategyExampleRef("valueNotJudged"), pass: strategyExampleRef("valuePass"), fail: strategyExampleRef("valueFail") },
  unlocked: { true: strategyExampleRef("valueUnlocked"), false: strategyExampleRef("valueLocked") },
  coherent: { true: strategyExampleRef("valueCoherent"), false: strategyExampleRef("valueNotCoherent") },
  scope: { core: strategyExampleRef("valueCore"), full: strategyExampleRef("valueFull") }, none: strategyExampleRef("valueNone"),
};
export function strategyPageFixture() {
  const contracts = [designer, writer, publisher];
  const result = prepareStrategyPage({
    open: () => openStrategy(strategyExampleRoot, { contracts }),
    issues: readStrategyRoot(strategyExampleRoot).issues,
    source: { id: "strategy.example", revision: 1 }, namespace: "example.strategy", selected: { id: "focus.segment.core" }, scope: "core",
    contracts: contracts.map(contract => contract.id), ownedRecords: getAdminCopy().records,
    recordIdForContext: context => `st.${runtimeHash(context).slice(7, 17)}`,
    envelopes: prepareAdminPageCopyEnvelopes([{ source: "strategy-page.copy.r1.en.json", envelope: ui }]),
    labels: strategyExampleLabels,
  });
  if (result.status !== "prepared") throw new Error(JSON.stringify(result.findings));
  return result;
}
