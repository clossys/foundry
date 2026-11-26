/** CP1-U3 G8: a placed seat's round and stage take the package's authored labels (pipeline/seats.json), not their ids. */
import { describe, expect, it } from "vitest";
import { readPipelineSeats } from "../records/slot-model/pipeline-seats.js";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { placeSeat } from "./owner.js";

type Step = Parameters<typeof placeSeat>[1];
const empty = () => ({ schema: "clossys.ia/1", source: "@clossys/producer#pipeline/seats.json", extensions: [] as string[], nodes: [] as { id: string; label: string; children: { id: string; label: string; slots: string[] }[] }[] });

describe("placeSeat labels", () => {
  it("labels every package round and stage as pipeline/seats.json authors it", () => {
    const tree = readPipelineSeats().nodes;
    for (const round of tree) for (const stage of round.children) {
      const step = stage.slots[0]!.replace(/^seat\./, "");
      const placed = placeSeat(empty(), { id: step, stage: stage.id } as unknown as Step);
      expect(placed.nodes).toEqual([{ id: round.id, label: round.label, children: [{ id: stage.id, label: stage.label, slots: [`seat.${step}`] }] }]);
    }
  });

  it("keeps the labels already in the consumer IA when it adds a seat to a placed stage", () => {
    const round = readPipelineSeats().nodes[0]!, stage = round.children[0]!;
    const ia = { ...empty(), nodes: [{ id: round.id, label: "Kept", children: [{ id: stage.id, label: "Kept too", slots: [] as string[] }] }] };
    const placed = placeSeat(ia, { id: stage.slots[0]!.replace(/^seat\./, ""), stage: stage.id } as unknown as Step);
    expect(placed.nodes[0]).toMatchObject({ label: "Kept", children: [{ label: "Kept too" }] });
  });
});
