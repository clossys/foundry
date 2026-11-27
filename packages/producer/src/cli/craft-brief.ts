/**
 * The P2 craft brief (slot-constitution.md section 5b, stage 1), assembled by the CLI rather than
 * typed by the maker (foundry-feedback-0018): the slot's pinned inputs (its Director slots, and for
 * a Publisher slot its Designer and Writer slots) with each pin's candidate and sha, the slot
 * contract with its sha, the standard the slot is certified against (id, sha, requirement checks,
 * taste criteria and their anchors), and the recipe code chooses for the standard (its one producing recipe) with its axes.
 *
 * Every mistake it can see is refused here, at stage 1, with a one-line fix, instead of at the
 * submit guard after four stages of work: an input that is not pinned (R20 would find nothing to
 * cite), a slot with no standard or one that does not exist (R05.1 certifies nothing), and a recipe
 * that does not produce the slot's standard (R15.5). Deterministic: reads records only, no model,
 * network, clock or randomness.
 */
import { createHash } from "node:crypto";
import { jsonBytes } from "../records/slot-model/layout.js";
import type { SlotAgent } from "../records/slot-model/types.js";
import { readiness, readPin, readSlot, slotIndex } from "../records/slots.js";
import { loadStandards, standardFor } from "../records/standards.js";
import { loadRecipes, standardRecipe } from "../records/recipes.js";
import { craftLineageOf, type CraftLineage } from "../records/code-adopt.js";

export interface BriefInput { readonly agent: string; readonly slot: string; readonly candidate: string; readonly sha256: string }
export interface AssembledBrief {
  readonly inputs: readonly BriefInput[];
  readonly contract: { readonly value: Readonly<Record<string, unknown>>; readonly sha256: string };
  readonly standard: {
    readonly id: string; readonly sha256: string;
    readonly requirements: readonly { readonly check: string; readonly params: unknown }[];
    readonly taste: readonly { readonly id: string; readonly anchors: Readonly<Record<string, string>> }[];
  };
  readonly recipe: { readonly id: string; readonly axes: readonly string[] };
  /**
   * A Designer frames or sections slot: the stock row its contract fixture gives, cited as the lineage source (ref and
   * hash; a registry:example may be one), the candidate's own type (registry:block) and the gallery imports the craft
   * removes (records/code-adopt.ts craftLineageOf). Absent when no stock row ships the fixture.
   */
  readonly lineage?: CraftLineage;
}

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The brief for `<agent>/<slot>`, or the refusal (`<why>; fix: <one line>`). `root` holds `packages/<agent>/{standards,recipes}`. */
export function assembleBrief(root: string, consumer: string, agent: SlotAgent, slot: string, recipeId?: string): { brief: AssembledBrief } | { refusal: string } {
  const doc = readSlot(consumer, agent, slot);
  const index = slotIndex(consumer);
  const ready = readiness(consumer, agent, slot, index);
  // R20 (Director-derived) covers Designer and Writer slots. A Producer seat (next --stage passes it
  // through as a SlotAgent) with no inputs configures the pipeline rather than realising content:
  // it is briefed from its contract alone.
  const seatRoot = (agent as string) === "producer" && !doc.inputs.length;
  if (!seatRoot && !ready.ready) {
    const first = ready.blockedBy[0]!;
    if (first.reason === "inputs-undeclared") return { refusal: `${agent}/${slot} declares no inputs, so nothing pinned upstream can be cited (R20); fix: declare the slot's inputs (clossys migrate inputs), then pin them` };
    const owner = index.get(first.slot)?.agent ?? "director";
    return { refusal: `input ${owner}/${first.slot} is ${first.reason}${ready.blockedBy.length > 1 ? ` (and ${ready.blockedBy.length - 1} more)` : ""}; fix: pin every input first (clossys pin ${owner}/${first.slot} <candidate>), so the brief cites pinned values (R20)` };
  }
  const inputs: BriefInput[] = [];
  for (const id of doc.inputs) {
    const entry = index.get(id)!;
    const pin = readPin(consumer, entry.agent, id)!;
    inputs.push({ agent: entry.agent, slot: id, candidate: pin.candidate, sha256: pin.sha256 });
  }
  const standardId = doc.standard;
  if (typeof standardId !== "string" || !standardId) return { refusal: `${agent}/${slot} names no standard (slot.json standard), so no candidate can certify (R05.1); fix: name the standard the slot is judged by (clossys standard), then brief` };
  const standard = standardFor(loadStandards(root), agent, standardId);
  if (!standard) return { refusal: `standard ${standardId} does not exist under packages/${agent}/standards/ (R05.1); fix: create it with clossys standard, or name an existing one in slot.json` };
  if (!standard.doc || standard.issues.length) return { refusal: `standard ${standardId} is not well-formed${standard.issues.length ? `: ${standard.issues[0]}` : ""} (R15.2); fix: repair it with clossys standard` };
  // Code chooses the run's recipe: the one recipe producing for the standard (records/recipes.ts standardRecipe). A
  // --recipe naming any other (an unknown id, one not producing the standard) is refused, never recorded.
  const recipes = loadRecipes(root);
  if (recipeId !== undefined) {
    const found = recipes.find(each => each.agent === agent && each.id === recipeId);
    if (!found?.doc) return { refusal: `recipe ${recipeId} does not exist (or is not well-formed) under packages/${agent}/recipes/; fix: name an existing recipe that produces ${standardId}` };
    if (!found.doc.produces.includes(standardId)) return { refusal: `recipe ${recipeId} produces ${found.doc.produces.join(", ") || "nothing"}, not ${standardId} (R15.5); fix: name a recipe whose produces lists ${standardId}` };
  }
  const chosen = standardRecipe(recipes, agent, standardId);
  if ("issue" in chosen) return { refusal: `${chosen.issue} (R15.5); fix: give the standard exactly one producing recipe under packages/${agent}/recipes/, then brief` };
  if (recipeId !== undefined && recipeId !== chosen.recipe.id) return { refusal: `recipe ${recipeId} is not the recipe code chooses for ${standardId} (${chosen.recipe.id}, its one producing recipe) (R15.5); fix: omit --recipe or name ${chosen.recipe.id}` };
  const recipe: AssembledBrief["recipe"] = { id: chosen.recipe.id, axes: [...(chosen.recipe.doc?.axes ?? [])] };
  const contract = doc.contract ?? {};
  const lineage = agent === "designer" && /^(frames|sections)\./.test(slot) ? craftLineageOf(root, slot) : undefined;
  return {
    brief: {
      inputs,
      contract: { value: contract, sha256: sha(jsonBytes(contract)) },
      standard: {
        id: standardId, sha256: standard.sha256,
        requirements: standard.doc.requirements.map(each => ({ check: each.check, params: each.params ?? {} })),
        taste: (standard.taste?.criteria ?? []).map(each => ({ id: each.id, anchors: Object.fromEntries(Object.entries(each.anchors)) as Record<string, string> })),
      },
      recipe,
      ...(lineage && "lineage" in lineage ? { lineage: lineage.lineage } : {}),
    },
  };
}
