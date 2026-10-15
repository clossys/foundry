import { Items } from "./Items.js";
import { Items as NativeItems } from "./Items.server.js";
import type { ItemData, ItemsProps } from "./types.js";

const items: readonly ItemData[] = [
  { id: "one", heading: "One", description: "Support", lane: "team" },
  { id: "two", heading: "Two", description: "Support", lane: "review" },
  { id: "three", heading: "Three", description: "Support", lane: "team" },
];
const lanes = [{ id: "team", label: "Team" }, { id: "review", label: "Review" }] as const;
const flow: ItemsProps = { arrangement: "stacked", order: "connected", reveal: "all", items, lanes, end: "continues", endLabel: "Next" };
void <Items {...flow} />;
void <NativeItems {...flow} />;
const answers: readonly ItemData[] = [0, 1, 2, 3].map(i => ({ id: String(i), heading: `Question ${i}`, description: `Answer ${i}` }));
void <Items arrangement="rows" order="numbered" reveal="disclose" items={answers} />;
// @ts-expect-error Order is a closed axis.
void <Items arrangement="columns" order="progress" items={items} />;
// @ts-expect-error Reveal is a closed axis; tabs are deferred.
void <Items arrangement="rows" reveal="tabs" items={items} />;
// @ts-expect-error Reveal is a closed axis; carousel is deferred.
void <Items arrangement="rows" reveal="carousel" items={items} />;
// @ts-expect-error End is a closed axis.
void <Items arrangement="stacked" order="connected" end="complete" items={items} />;
// @ts-expect-error Lane definitions are an array, not the legacy actor map.
void <Items arrangement="stacked" order="connected" lanes={{ a: "Team", b: "Review" }} items={items} />;
// @ts-expect-error Items has no legacy continuation-copy field.
void <Items arrangement="columns" order="connected" continuesLabel="Next" items={items} />;
// @ts-expect-error Recipes are resolved by the content contract, not Designer.
void <Items arrangement="rows" recipe="faq" items={items} />;
// @ts-expect-error Public Items axes do not expose recipe variants.
void <Items arrangement="rows" variant="faq" items={items} />;
// @ts-expect-error Rendering adapters are internal.
void <Items arrangement="rows" renderRow={() => null} items={items} />;
// @ts-expect-error Validation cannot be disabled.
void <Items arrangement="rows" validate={false} items={items} />;

import type { ItemsLane as PublicLane } from "../index.js";
import type { ItemsLane as NativeLane } from "../server.js";
import type { ItemsLane as PackageLane } from "../../index.js";
const named: ItemsProps = { arrangement: "columns", order: "connected", items: answers.slice(0, 3), "aria-labelledby": "sequence-heading" };
void <Items {...named} />; void <NativeItems {...named} />;
const lane: PublicLane & NativeLane & PackageLane = { id: "team", label: "Team" }; void lane;
// @ts-expect-error List naming uses the standard string-valued ARIA field.
const invalidListName: ItemsProps = { ...named, "aria-labelledby": 3 }; void invalidListName;
// @ts-expect-error Items has no invented list naming alias.
void <Items {...named} labelledBy="sequence-heading" />;

void <Items {...flow} endLabel={new Set(["Repeats ", "monthly"])} />;
void <NativeItems {...flow} endLabel={new Set(["Repeats ", "monthly"])} />;
