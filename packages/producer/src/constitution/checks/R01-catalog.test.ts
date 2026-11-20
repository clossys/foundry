import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContext } from "../context.js";
import type { ConstitutionContext } from "../types.js";
import { SLOT_SCHEMA } from "../../records/slot.js";
import { cleanSpec, contextOf, expectCatches, NO_FOUNDRY_LEAVES, NO_HISTORY, SAMPLE_SEAT, slotDoc, writeWorkspace, type Agent, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { canonicalJson, contractDedupe, contractFixture, contractHash, foundryPlaced, iaValid, isTombstone, R01, slotContract, treeShape } from "./R01-catalog.js";

const clean = () => contextOf(cleanSpec());
const broken = (edit: (spec: WorkspaceSpec) => void) => { const spec = cleanSpec(); edit(spec); return contextOf(spec); };
/** A written workspace with one file edited after writing, read back as a context. */
function editedTree(edit: (consumer: string) => void, foundryLeaves: (agent: string) => ReadonlySet<string> = NO_FOUNDRY_LEAVES): ConstitutionContext {
  const { root, consumer } = writeWorkspace(cleanSpec());
  edit(consumer);
  return buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves });
}
const iaFile = (consumer: string, agent: Agent) => join(consumer, "agents", agent, "ia.json");
const editIa = (consumer: string, agent: Agent, change: (ia: Record<string, unknown>) => void) => {
  const ia = JSON.parse(readFileSync(iaFile(consumer, agent), "utf8")) as Record<string, unknown>;
  change(ia);
  writeFileSync(iaFile(consumer, agent), `${JSON.stringify(ia, null, 2)}\n`);
};
const reasons = (rows: readonly { agent: string; slot: string; reason: string }[]) => rows.map(row => `${row.agent}:${row.slot}: ${row.reason}`);

describe("R01 module", () => {
  it("declares R01.1-R01.16 (R01.7-R01.16 are the IA checks in rules/r01-ia.ts)", () => {
    expect(Object.keys(R01.checks)).toEqual(Array.from({ length: 16 }, (_, index) => `R01.${index + 1}`));
  });

  it("passes the clean workspace on every check, all five agents included; the warn-only fanout check only warns", () => {
    const ctx = clean();
    expect(ctx.agents.map(agent => agent.agent)).toEqual(["director", "designer", "writer", "publisher", "producer"]);
    for (const [id, check] of Object.entries(R01.checks)) if (id !== "R01.15") expect(check(ctx), id).toEqual([]);
    expect(R01.checks["R01.15"]!(ctx).every(row => row.check === "R01.15" && /has one (L1|leaf)/.test(row.reason))).toBe(true);
  });
});

describe("R01.1 ia.json is valid for all five agents", () => {
  it("flags a Producer id that is not seat.<step-id> (D5)", () => {
    const rows = expectCatches(iaValid, clean(), broken(spec => { spec.producer = { "pin.director": { slot: false, candidates: { "director-v1.json": SAMPLE_SEAT } } }; }));
    expect(reasons(rows)).toEqual([expect.stringMatching(/^producer:\*: ia\.json is invalid: .*producer slot id pin\.director must be seat\.<step-id>/)]);
  });

  it("flags a seat id in another agent's IA", () => {
    const rows = expectCatches(iaValid, clean(), broken(spec => { spec.writer!["seat.copy"] = { slot: false }; }));
    expect(reasons(rows)).toEqual([expect.stringMatching(/^writer:\*: ia\.json is invalid: .*slot id seat\.copy is in the producer seat namespace/)]);
  });

  it("flags an IA that fails ia.schema.json (no schema, no labels), a missing IA and an unparseable one", () => {
    const rows = expectCatches(iaValid, clean(), editedTree(consumer => editIa(consumer, "publisher", ia => { delete ia.schema; delete ia.source; })));
    expect(reasons(rows)).toEqual([expect.stringMatching(/^publisher:\*: ia\.json is invalid: .*schema must be clossys\.ia\/1/)]);
    const missing = editedTree(consumer => writeFileSync(iaFile(consumer, "designer"), "{ not json"));
    expect(reasons(iaValid(missing))).toEqual([expect.stringMatching(/^designer:\*: ia\.json is unreadable: not JSON/)]);
  });

  it("mutation proof: a disabled R01.1 fails the failing-first contract", () => {
    const bad = broken(spec => { spec.writer!["seat.copy"] = { slot: false }; });
    expect(() => expectCatches(() => [], clean(), bad)).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.2 every live slot has a valid slot.json and a contract valid against its kind's schema", () => {
  it("flags a live slot with no slot.json", () => {
    const rows = expectCatches(slotContract, clean(), broken(spec => { spec.designer!["ui.button"]!.slot = false; }));
    expect(reasons(rows)).toEqual(["designer:ui.button: live slot has no slot.json"]);
  });

  it("flags a kind outside AGENT_KIND[agent], an id or agent that does not match the tree, and an unknown key", () => {
    const rows = expectCatches(slotContract, clean(), broken(spec => {
      spec.designer!["ui.button"]!.slot = { ...slotDoc("designer", "ui.button"), kind: "brief" };
      spec.writer!["home.hero"]!.slot = { ...slotDoc("writer", "home.hero", { inputs: ["brand.voice"] }), id: "home.other" };
      spec.director!["brand.voice"]!.slot = { ...slotDoc("director", "brand.voice"), usedBy: [] };
    }));
    const text = reasons(rows).join("\n");
    expect(text).toMatch(/designer:ui\.button: slot\.json is invalid: .*kind brief does not belong to designer/);
    expect(text).toMatch(/writer:home\.hero: slot\.json is invalid: .*id must be home\.hero, the folder and IA id/);
    expect(text).toMatch(/director:brand\.voice: slot\.json is invalid: .*unknown key usedBy/);
  });

  it("flags a contract that fails contract-<kind>.schema.json", () => {
    const rows = expectCatches(slotContract, clean(), broken(spec => {
      const doc = slotDoc("publisher", "site.home", { inputs: ["ui.card", "home.hero"] });
      spec.publisher!["site.home"]!.slot = { ...doc, contract: { ...(doc.contract as object), fixture: { route: { path: 7 } } } };
    }));
    expect(reasons(rows)).toEqual([expect.stringMatching(/^publisher:site\.home: slot\.json is invalid: .*contract \/fixture\/route\/path must be string/)]);
  });

  it("flags a seat slot whose contract names another step, or whose kind is not seat", () => {
    const rows = expectCatches(slotContract, clean(), broken(spec => {
      spec.producer!["seat.director"]!.slot = { ...slotDoc("producer", "seat.director"), contract: { step: "writer", fixture: { step: "writer" } } };
    }));
    expect(reasons(rows)).toEqual([expect.stringMatching(/^producer:seat\.director: slot\.json is invalid: .*contract\.step must be director/)]);
    const wrongKind = broken(spec => { spec.producer!["seat.director"]!.slot = { ...slotDoc("producer", "seat.director"), kind: "element" }; });
    expect(reasons(slotContract(wrongKind)).join("\n")).toMatch(/kind element does not belong to producer/);
  });

  it("mutation proof: a disabled R01.2 fails the failing-first contract", () => {
    const bad = broken(spec => { spec.designer!["ui.button"]!.slot = false; });
    expect(() => expectCatches(() => [], clean(), bad)).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.3 every contract carries a fixture of its kind's shape", () => {
  const without = (agent: Agent, id: string, deps: { inputs?: string[]; uses?: string[] } = {}) => {
    const doc = slotDoc(agent, id, deps);
    const { fixture: _fixture, ...contract } = doc.contract as Record<string, unknown>;
    return { ...doc, contract };
  };

  it("flags a contract with no fixture, for every kind", () => {
    const rows = expectCatches(contractFixture, clean(), broken(spec => {
      spec.director!["brand.voice"]!.slot = without("director", "brand.voice");
      spec.designer!["ui.button"]!.slot = without("designer", "ui.button");
      spec.writer!["home.hero"]!.slot = without("writer", "home.hero", { inputs: ["brand.voice"] });
      spec.publisher!["site.home"]!.slot = without("publisher", "site.home", { inputs: ["ui.card", "home.hero"] });
    }));
    expect(reasons(rows)).toEqual([
      "director:brand.voice: contract.fixture is missing (brief)",
      "designer:ui.button: contract.fixture is missing (element)",
      "writer:home.hero: contract.fixture is missing (strings)",
      "publisher:site.home: contract.fixture is missing (page)",
    ]);
  });

  it("flags a fixture of the wrong shape: empty headings, missing locales, undeclared element props, a sample seat the package owns", () => {
    const rows = expectCatches(contractFixture, clean(), broken(spec => {
      spec.director!["brand.voice"]!.slot = { ...slotDoc("director", "brand.voice"), contract: { summary: "x", fixture: { headings: [] } } };
      spec.writer!["home.hero"]!.slot = { ...slotDoc("writer", "home.hero", { inputs: ["brand.voice"] }), contract: { summary: "y", fixture: { keys: ["title"] } } };
      const button = slotDoc("designer", "ui.button");
      spec.designer!["ui.button"]!.slot = { ...button, contract: { ...(button.contract as object), props: [] } };
      spec.producer!["seat.director"]!.slot = { ...slotDoc("producer", "seat.director"), contract: { step: "director", fixture: { step: "director", seat: { by: "nobody" } } } };
    }));
    const text = reasons(rows).join("\n");
    expect(text).toMatch(/director:brand\.voice: contract\.fixture headings must be a non-empty list of strings \(brief\)/);
    expect(text).toMatch(/writer:home\.hero: contract\.fixture locales must be a non-empty list of strings \(strings\)/);
    expect(text).toMatch(/designer:ui\.button: contract\.fixture props label are not declared in contract\.props \(element\)/);
    expect(text).toMatch(/producer:seat\.director: contract\.fixture seat is package data/);
  });

  it("mutation proof: a disabled R01.3 fails the failing-first contract", () => {
    const bad = broken(spec => { spec.director!["brand.voice"]!.slot = without("director", "brand.voice"); });
    expect(() => expectCatches(() => [], clean(), bad)).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.4 an agent tree holds only live slots, tombstones, ledger.json and policy.json", () => {
  it("flags a stray file in a live slot folder, and names seat.json as retired", () => {
    const rows = expectCatches(treeShape, clean(), broken(spec => {
      spec.designer!["ui.button"]!.files = { "notes.md": "scratch\n" };
      spec.producer!["seat.director"]!.files = { "seat.json": SAMPLE_SEAT };
    }));
    expect(reasons(rows)).toEqual([
      "designer:ui.button: a live slot folder holds only slot.json, pin.json, candidates/, ledger.json and retired/; found notes.md",
      "producer:seat.director: a live slot folder holds only slot.json, pin.json, candidates/, ledger.json and retired/; found seat.json (seat.json is retired)",
    ]);
  });

  it("flags a folder the IA does not place unless it is a tombstone, and the old requests/ queue", () => {
    const rows = expectCatches(treeShape, clean(), broken(spec => {
      spec.writer!["home.old"] = { live: false, slot: slotDoc("writer", "home.old"), candidates: { "old-v1.md": "Old.\n" } };
      spec.writer!["home.gone"] = { live: false, slot: false, ledger: { events: [{ op: "submit" }, { op: "retire-slot" }] } };
      spec.writer!.requests = { live: false, slot: false, files: { "r1.json": { id: "r1" } } };
    }));
    expect(reasons(rows)).toEqual([
      "writer:home.old: a folder ia.json does not place must be a tombstone (only ledger.json, last event retire-slot)",
      "writer:requests: the old requests/ queue is retired (handoff requests, R19)",
    ]);
  });

  it("flags a stray file at the agent root and accepts ia.json, ledger.json and policy.json", () => {
    const ctx = editedTree(consumer => {
      for (const name of ["ledger.json", "policy.json"]) writeFileSync(join(consumer, "agents", "writer", name), "{}\n");
      writeFileSync(join(consumer, "agents", "writer", "declarations.json"), "{}\n");
    });
    expect(reasons(treeShape(ctx))).toEqual(["writer:*: declarations.json is not ia.json, ledger.json, policy.json or a slot folder"]);
  });

  it("knows a tombstone: only ledger.json, last event retire-slot (array or {events})", () => {
    const tomb = (ledger: unknown, entries = ["ledger.json"]) => isTombstone({ agent: "writer", id: "x.y", dir: "x", live: false, entries, candidates: [], retired: [], ledger: { path: "x", text: "", value: ledger } });
    expect(tomb([{ op: "retire-slot" }])).toBe(true);
    expect(tomb({ events: [{ op: "retire-slot" }] })).toBe(true);
    expect(tomb([{ op: "retire-slot" }, { op: "submit" }])).toBe(false);
    expect(tomb([{ op: "retire-slot" }], ["ledger.json", "slot.json"])).toBe(false);
  });

  it("mutation proof: a disabled R01.4 fails the failing-first contract", () => {
    const bad = broken(spec => { spec.designer!["ui.button"]!.files = { "notes.md": "scratch\n" }; });
    expect(() => expectCatches(() => [], clean(), bad)).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.5 Designer, Director and Writer live slots are Foundry leaves or listed extensions", () => {
  const unlisted = (consumer: string) => editIa(consumer, "director", ia => { ia.extensions = []; });

  it("flags a live slot that is neither a Foundry leaf nor an extension, and passes it once it is a leaf", () => {
    const rows = expectCatches(foundryPlaced, clean(), editedTree(unlisted));
    expect(reasons(rows)).toEqual(["director:brand.voice: live slot is neither a Foundry-placed leaf nor listed in ia.json extensions; this store is not recut to the current trees: run clossys migrate recut first"]);
    expect(foundryPlaced(editedTree(unlisted, agent => new Set(agent === "director" ? ["brand.voice"] : [])))).toEqual([]);
  });

  it("points a store still on the old trees at clossys migrate recut, and drops the hint once the store is recut", () => {
    const recut = (consumer: string) => {
      unlisted(consumer);
      const file = join(consumer, "agents", "director", "brand.voice", "slot.json");
      writeFileSync(file, `${JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), schema: SLOT_SCHEMA }, null, 2)}\n`);
    };
    expect(reasons(foundryPlaced(editedTree(recut)))).toEqual(["director:brand.voice: live slot is neither a Foundry-placed leaf nor listed in ia.json extensions"]);
  });

  it("reports an unreadable Foundry IA as one agent row, and never reads it when every live slot is an extension", () => {
    const boom = () => { throw new Error("no catalog"); };
    expect(reasons(foundryPlaced(editedTree(unlisted, boom)))).toEqual(["director:*: the Foundry director IA is unreadable: no catalog"]);
    expect(foundryPlaced(editedTree(() => undefined, boom))).toEqual([]);
  });

  it("holds no Publisher or Producer slot to the Foundry leaves", () => {
    const ctx = editedTree(consumer => { editIa(consumer, "publisher", ia => { ia.extensions = []; }); });
    expect(foundryPlaced(ctx)).toEqual([]);
  });

  it("mutation proof: a disabled R01.5 fails the failing-first contract", () => {
    expect(() => expectCatches(() => [], clean(), editedTree(unlisted))).toThrow(/silent on the broken workspace/);
  });
});

describe("R01.6 inside one agent, no two live slots have the same contract", () => {
  it("flags the second slot of a duplicate pair, the fixture left out of the hash", () => {
    const rows = expectCatches(contractDedupe, clean(), broken(spec => {
      const button = slotDoc("designer", "ui.button").contract as Record<string, unknown>;
      const card = slotDoc("designer", "ui.card", { uses: ["ui.button"] });
      spec.designer!["ui.card"]!.slot = { ...card, contract: { ...button, fixture: (card.contract as Record<string, unknown>).fixture } };
    }));
    expect(reasons(rows)).toEqual(["designer:ui.card: contract equals ui.button's (fixture left out): two live slots, one contract"]);
  });

  it("dedupes inside one agent only, and hashes canonical JSON (key order does not matter)", () => {
    const ctx = broken(spec => {
      spec.writer!["home.hero"]!.slot = { ...slotDoc("writer", "home.hero", { inputs: ["brand.voice"] }), contract: { summary: "brief brand.voice", fixture: { keys: ["a"], locales: ["en"] } } };
    });
    expect(contractDedupe(ctx)).toEqual([]);
    expect(canonicalJson({ b: [1, { d: 2, c: 3 }], a: null })).toBe("{\"a\":null,\"b\":[1,{\"c\":3,\"d\":2}]}");
    expect(contractHash({ a: 1, b: 2, fixture: { x: 1 } })).toBe(contractHash({ b: 2, a: 1 }));
    expect(contractHash({ a: 1 })).not.toBe(contractHash({ a: 2 }));
  });

  it("mutation proof: a disabled R01.6 fails the failing-first contract", () => {
    const bad = broken(spec => {
      const button = slotDoc("designer", "ui.button").contract as Record<string, unknown>;
      spec.designer!["ui.card"]!.slot = { ...slotDoc("designer", "ui.card", { uses: ["ui.button"] }), contract: button };
    });
    expect(() => expectCatches(() => [], clean(), bad)).toThrow(/silent on the broken workspace/);
  });
});

describe("R01 fixture files", () => {
  it("writes the Producer seat as a seat slot with its slot.json", () => {
    const { consumer } = writeWorkspace(cleanSpec());
    const doc = JSON.parse(readFileSync(join(consumer, "agents", "producer", "seat.director", "slot.json"), "utf8")) as Record<string, unknown>;
    expect(doc).toMatchObject({ id: "seat.director", agent: "producer", kind: "seat", contract: { step: "director", fixture: { step: "director" } } });
  });
});
