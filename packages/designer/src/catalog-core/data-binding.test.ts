/** @vitest-environment node */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../../references/manifest.json" with { type: "json" };
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import sections from "../catalog/slot-contracts/sections.json" with { type: "json" };
import { dataBindingFindings, readRecords } from "./data-binding.js";
import { slotContractFindings, type SlotContractContext, type SlotContractRecord } from "./slot-contracts.js";

// foundry-build-0048 U20: the data-bound section contract. Each admin record section states, in its slot contract
// limits, how the host binds the clossys records it reads; every rule is a slotContractFindings finding.
const references = fileURLToPath(new URL("../../references/", import.meta.url));
const context: SlotContractContext = { layer: "sections", slots: sectionSlots as unknown as SlotContractContext["slots"], manifest, folderExists: dir => existsSync(references + dir) && statSync(references + dir).isDirectory() };
const committed = sections as unknown as SlotContractRecord[];
const ADMIN = ["slot-gallery", "slot-detail", "candidate-preview", "question-packet", "queue-list"].map(leaf => `sections.${leaf}`);
const withLimits = (slot: string, edit: (limits: Record<string, number | string | boolean>) => void): SlotContractRecord[] => committed.map(row => {
  if (row.slot !== slot) return row;
  const limits = { ...row.limits };
  edit(limits);
  return { ...row, limits };
});

describe("the data-bound section contract", () => {
  it("binds each admin record section host-injected, read-only, through its records slot, under a route scope", () => {
    const bound = Object.fromEntries(ADMIN.map(slot => {
      const limits = committed.find(row => row.slot === slot)!.limits;
      return [slot, [limits["binding"], limits["reads.access"], limits["reads.port"], limits["reads.scope"]]];
    }));
    expect(bound).toEqual({
      "sections.slot-gallery": ["host-injected", "read-only", "slots", "agent"],
      "sections.slot-detail": ["host-injected", "read-only", "slot", "agent, slot"],
      "sections.candidate-preview": ["host-injected", "read-only", "candidates", "agent, slot"],
      "sections.question-packet": ["host-injected", "read-only", "questions", "workspace"],
      "sections.queue-list": ["host-injected", "read-only", "entries", "workspace"],
    });
    expect(committed.filter(row => Object.keys(row.limits).some(key => key.startsWith("reads.") || key === "binding")).map(row => row.slot).sort()).toEqual([...ADMIN].sort());
    expect(slotContractFindings(committed, context)).toEqual([]);
  });

  // CP1-G1: the record sections stay copy-less. Their labels (column heads, headings, empty text, status names) come
  // with the records the host injects, from the pinned Writer strings slot writer/sections.records.copy, never as copy fields.
  it("keeps each admin record section copy-less: one required records slot, no copy fields, no Writer passage", () => {
    const shapes = Object.fromEntries(ADMIN.map(slot => {
      const contract = (sectionSlots as unknown as { id: string; contract: { slots?: { name: string; type: string; required?: boolean }[]; copy?: { fields?: unknown[] }; passageSchema?: unknown } }[]).find(row => row.id === slot)!.contract;
      return [slot, { records: (contract.slots ?? []).filter(port => port.type === "records" && port.required === true).length, copyFields: contract.copy?.fields?.length ?? 0, passage: contract.passageSchema ?? null }];
    }));
    expect(shapes).toEqual(Object.fromEntries(ADMIN.map(slot => [slot, { records: 1, copyFields: 0, passage: null }])));
  });

  it("reads the record schemas, a parenthesised qualifier included", () => {
    expect(readRecords("clossys.queue-entry/1 (queue.pick, queue.approve, queue.clarify)")).toEqual({ ok: true, schemas: ["clossys.queue-entry/1"] });
    expect(readRecords("clossys.ia/1, clossys.slot/2")).toEqual({ ok: true, schemas: ["clossys.ia/1", "clossys.slot/2"] });
  });

  it("mutation: each broken rule is a finding on the section", () => {
    const one = (slot: string, edit: (limits: Record<string, number | string | boolean>) => void) => slotContractFindings(withLimits(slot, edit), context);
    expect(one("sections.slot-gallery", limits => { limits["binding"] = "declared requirement: not built yet"; })).toEqual(['sections.slot-gallery: binding is "declared requirement: not built yet", not "host-injected": the host reads the records and fills the "slots" slot']);
    expect(one("sections.slot-gallery", limits => { limits["reads.access"] = "read-write"; })).toEqual(['sections.slot-gallery: reads.access is "read-write", not "read-only": a record section never writes a record']);
    expect(one("sections.slot-detail", limits => { limits["reads.port"] = "slots"; })).toEqual(['sections.slot-detail: reads.port is "slots", not its required records slot "slot"']);
    expect(one("sections.queue-list", limits => { limits["reads.records"] = "clossys.secret/1"; })).toEqual(["sections.queue-list: reads.records names clossys.secret/1, which is no record the admin workspace reads (clossys.ia/1, clossys.slot/2, clossys.pin/2, clossys.candidate/1, clossys.queue-entry/1, clossys.queue-entry/2)"]);
    expect(one("sections.queue-list", limits => { limits["reads.records"] = "clossys.queue-entry/2, clossys.queue-entry/2"; })).toEqual(["sections.queue-list: reads.records names clossys.queue-entry/2 twice"]);
    expect(one("sections.candidate-preview", limits => { delete limits["reads.scope"]; })).toEqual(['sections.candidate-preview: reads.scope is null, not one of "workspace", "agent", "agent, slot"']);
    expect(one("sections.question-packet", limits => { limits["reads.write"] = "queue"; })).toEqual(["sections.question-packet: declares reads.write, outside the data-bound section contract"]);
    expect(one("sections.hero", limits => { limits["reads.records"] = "clossys.ia/1"; })).toEqual(["sections.hero: declares reads.records but is no data-bound record section (no required records slot)"]);
    // A records section that pairs a Writer passage (filled from the page's own data and copy) is not data-bound either.
    expect(one("sections.data-table", limits => { limits["binding"] = "host-injected"; })).toEqual(["sections.data-table: declares binding but is no data-bound record section (it pairs the Writer passage passages.data-table)"]);
  });

  it("mutation: a data-bound section that declares copy fields is a finding", () => {
    expect(dataBindingFindings({ "reads.access": "read-only", "reads.port": "slots", "reads.records": "clossys.ia/1", "reads.scope": "agent", binding: "host-injected" },
      { slots: [{ name: "slots", type: "records", required: true }], copy: { fields: [{ key: "heading" }] } }))
      .toEqual(["declares copy fields: a data-bound record section renders record values and binds no Writer copy"]);
  });
});
