// This real compiler fixture is also reused against both emitted public entries.
import type { CompositeChangeSet } from "./index.js";
// @ts-expect-error Component authoring requires its typed fill and source files.
const invalid: CompositeChangeSet = {baseHash: "x", changes: [{portion: "components", change: {op: "author", slot: "components.button", tokens: {}}}]};
void invalid;
