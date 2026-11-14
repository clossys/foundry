import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LABEL } from "../certify/certify.world.js";
import { certify, certifyEnv } from "../certify/index.js";
import { expectCatches, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import type { Check, ConstitutionContext } from "../types.js";
import { importSpecifiers, R03, R03_CHECKS, r03_1, r03_2, r03_3, r03_4, r03_5, RAW_HEADLESS, RUNG_READS, sourceKindOf } from "./r03.js";
import { adoptedItem, createVerdict, createdItem, r03Spec, r03World, SEED_HASH, SEED_REF, submit } from "./r03.world.js";
import { put } from "./r15.world.js";
import { sha256Hex } from "../../records/hash.js";

type Change = (spec: WorkspaceSpec) => void;
const broken = (change: Change, edit?: Parameters<typeof r03World>[1]) => { const spec = r03Spec(); change(spec); return r03World(spec, edit); };
const button = (spec: WorkspaceSpec) => spec.designer!["ui.button"]!;
const dial = (spec: WorkspaceSpec) => spec.designer!["assets.dial"]!;
const hero = (spec: WorkspaceSpec) => spec.writer!["home.hero"]!;

function catches(check: Check, ctx: ConstitutionContext, reason: RegExp) {
  const rows = expectCatches(check, r03World(), ctx);
  expect(rows.map(row => row.reason).join("\n")).toMatch(reason);
  for (const row of rows) expect(row.rule).toBe("R03");
  return rows;
}

describe("R03 module", () => {
  it("declares R03.1-R03.5", () => {
    expect(R03.rule).toBe("R03");
    expect(Object.keys(R03_CHECKS)).toEqual(["R03.1", "R03.2", "R03.3", "R03.4", "R03.5"]);
  });

  it("the R03 world is clean under every R03 check", () => {
    const ctx = r03World();
    for (const [id, check] of Object.entries(R03_CHECKS)) expect(check(ctx), id).toEqual([]);
  });
});

describe("R03.1 every candidate's submit names a rung", () => {
  it("catches a candidate with no submit event", () => {
    catches(r03_1, broken(spec => { hero(spec).ledger = { events: [createVerdict(), submit("hero-v1.md", "create", { reason: "first copy" })] }; }), /no ledger submit event/);
  });

  it("catches an unknown rung, and a Designer generic rung name (its rungs are L1-L4)", () => {
    catches(r03_1, broken(spec => { hero(spec).ledger = { events: [createVerdict(), submit("hero-v1.md", "select", { seed: "x" }), submit("hero-v2.md", "adopt", { seed: "home.hero/hero-v1.md" })] }; }), /rung must be one of adopt, adapt, create, got "select"/);
    catches(r03_1, broken(spec => { button(spec).ledger = { events: [submit("button-v1.json", "adopt", { seed: SEED_REF })] }; }), /rung must be one of L1, L2, L3, L4/);
  });

  it("catches an adopt or adapt with no seed", () => {
    catches(r03_1, broken(spec => { button(spec).ledger = { events: [submit("button-v1.json", "L2")] }; }), /names the seed it adopted/);
  });

  it("catches a create that follows no create verdict", () => {
    catches(r03_1, broken(spec => { hero(spec).ledger = { events: [submit("hero-v1.md", "create", { reason: "first copy" }), submit("hero-v2.md", "adopt", { seed: "home.hero/hero-v1.md" })] }; }), /create follows no verdict/);
    catches(r03_1, broken(spec => { hero(spec).ledger = { events: [{ op: "verdict", pick: "x" }, submit("hero-v1.md", "create", { reason: "first copy" }), submit("hero-v2.md", "adopt", { seed: "home.hero/hero-v1.md" })] }; }), /verdict that is not create/);
  });
});

describe("R03.2 adopt is verbatim, for every candidate", () => {
  it("catches a Designer lineage hash that differs from the manifest (check-provenance logic)", () => {
    catches(r03_2, broken(spec => { button(spec).candidates = { "button-v1.json": adoptedItem(LABEL, { kind: "registry", ref: [SEED_REF], hash: "sha256:other" }) }; }), /hash sha256:other != manifest sha256:seed/);
  });

  it("catches an untrusted registry and an original outside a consumer-asset slot", () => {
    catches(r03_2, broken(spec => { button(spec).candidates = { "button-v1.json": adoptedItem(LABEL, { kind: "registry", ref: ["evil/button@1.0.0"], hash: SEED_HASH }) }; }), /not a trusted registry/);
    catches(r03_2, broken(spec => { button(spec).candidates = { "button-v1.json": createdItem() }; button(spec).ledger = { events: [createVerdict(), submit("button-v1.json", "L4", { reason: "r" })] }; }), /original item in ui\.button, which is not a consumer-asset slot/);
  });

  it("checks unpinned candidates too, not only pins", () => {
    const rows = catches(r03_2, broken(spec => {
      button(spec).candidates = { "button-v1.json": adoptedItem(), "button-v2.json": adoptedItem(LABEL, { kind: "registry", ref: [SEED_REF], hash: "sha256:other" }) };
    }), /button-v2\.json/);
    expect(rows.map(row => row.candidate)).toEqual(["button-v2.json"]);
  });

  it("catches a Designer adopt rung whose source is not a registry item", () => {
    catches(r03_2, broken(spec => { dial(spec).ledger = { events: [submit("dial-v1.json", "L1", { seed: SEED_REF })] }; }), /rung L1 \(adopt\) but meta\.source\.kind is not registry/);
  });

  it("catches another agent's adopt whose bytes differ from its seed, or whose seed names no candidate", () => {
    catches(r03_2, broken(spec => { hero(spec).candidates = { "hero-v1.md": "---\nlocales: [\"en\"]\n---\none\n", "hero-v2.md": "---\nlocales: [\"en\"]\n---\ntwo\n" }; }), /adopts seed home\.hero\/hero-v1\.md but its bytes differ/);
    catches(r03_2, broken(spec => { hero(spec).ledger = { events: [createVerdict(), submit("hero-v1.md", "create", { reason: "first copy" }), submit("hero-v2.md", "adopt", { seed: "home.hero/hero-v9.md" })] }; }), /names no candidate/);
  });

  it("resolves a reissue seed <slot>/<old>@<sha> through the retire-candidate event once the old file is retired", () => {
    // slot-constitution.md section 5 (Reissue): rung adopt, seed <slot>/<old>@<sha>, the old file retired.
    const reissued = (bytes: string, events: (sha: string) => Record<string, unknown>[]) => broken(spec => {
      const copy = hero(spec).candidates!["hero-v1.md"] as string;
      const sha = sha256Hex(copy);
      hero(spec).candidates = { "hero-v2.md": bytes };
      hero(spec).ledger = { events: [createVerdict(), submit("hero-v1.md", "create", { reason: "first copy" }), ...events(sha)] };
    });
    const copy = r03Spec().writer!["home.hero"]!.candidates!["hero-v1.md"] as string;
    const verbatim = reissued(copy, sha => [submit("hero-v2.md", "adopt", { seed: `home.hero/hero-v1.md@${sha}` }), { op: "retire-candidate", name: "hero-v1.md", sha256: sha, code: "superseded" }]);
    expect(r03_2(verbatim)).toEqual([]);
    catches(r03_2, reissued(`${copy}edited\n`, sha => [submit("hero-v2.md", "adopt", { seed: `home.hero/hero-v1.md@${sha}` }), { op: "retire-candidate", name: "hero-v1.md", sha256: sha, code: "superseded" }]), /adopts seed home\.hero\/hero-v1\.md@[0-9a-f]{64} but its bytes differ/);
    catches(r03_2, reissued(copy, sha => [submit("hero-v2.md", "adopt", { seed: `home.hero/hero-v1.md@${sha}` })]), /names no candidate/);
    catches(r03_2, reissued(copy, sha => [submit("hero-v2.md", "adopt", { seed: `home.hero/hero-v1.md@${sha}` }), { op: "retire-candidate", name: "hero-v1.md", sha256: "0".repeat(64), code: "superseded" }]), /names no candidate/);
  });
});

describe("R03.3 one certifier", () => {
  it("catches a certifier source that reads a rung, a seed or a source kind", () => {
    const rel = "packages/producer/src/constitution/certify/rungs.ts";
    catches(r03_3, broken(() => {}, root => put(join(root, rel), "export const f = (submit) => submit.rung === \"adopt\";\n")), /reads \.rung/);
    catches(r03_3, broken(() => {}, root => put(join(root, rel), "export const f = (item) => item.meta.source?.kind;\n")), /reads source\?\.kind/);
  });

  it("ignores comments, tests and the R03 adopt helper (source.ts)", () => {
    const ctx = broken(() => {}, root => {
      put(join(root, "packages/producer/src/constitution/certify/a.ts"), "// never reads source.kind or .rung\nexport const a = 1;\n");
      put(join(root, "packages/producer/src/constitution/certify/a.test.ts"), "x.rung;\n");
      put(join(root, "packages/producer/src/constitution/certify/source.ts"), "export const k = (s) => s.source.kind;\n");
    });
    expect(r03_3(ctx)).toEqual([]);
    expect(RUNG_READS.test("meta.refVerbatim")).toBe(true);
  });

  it("the shipped certifier passes, and certifies identically whatever the source kind (output identity)", () => {
    const ctx = r03World();
    const slot = ctx.agents.find(agent => agent.agent === "designer")!.slots.get("ui.button")!;
    const candidate = slot.candidates[0]!;
    expect(sourceKindOf(candidate)).toBe("registry");
    const flipped = r03World(((spec: WorkspaceSpec) => { button(spec).candidates = { "button-v1.json": adoptedItem(LABEL, { kind: "original", ref: [] }) }; return spec; })(r03Spec()));
    const other = flipped.agents.find(agent => agent.agent === "designer")!.slots.get("ui.button")!;
    expect(certify({ slot: other, candidate: other.candidates[0]! }, certifyEnv(flipped))).toEqual(certify({ slot, candidate }, certifyEnv(ctx)));
  });
});

describe("R03.4 adopt-first keeps seed files byte-exact", () => {
  it("catches an edited vendored copy under an adopt-first standard", () => {
    catches(r03_4, broken(spec => { button(spec).candidates = { "button-v1.json": adoptedItem(`${LABEL}// edited\n`) }; }), /component is adopt-first: .*ui\/ui\.button\.tsx is not byte-exact to shadcn\/button@1\.0\.0/);
  });

  it("allows an adapt that only adds files, and catches one that maps no seed file", () => {
    const added = { ...adoptedItem(), files: [...(adoptedItem().files as object[]), { path: "ui/ui.button-variant.tsx", type: "registry:ui", content: "export {};\n" }] };
    const ctx = broken(spec => { button(spec).candidates = { "button-v1.json": added }; button(spec).ledger = { events: [submit("button-v1.json", "L3", { seed: SEED_REF })] }; });
    expect(r03_4(ctx)).toEqual([]);
    catches(r03_4, broken(spec => { const item = adoptedItem(); item.meta = { source: (item.meta as { source: unknown }).source }; button(spec).candidates = { "button-v1.json": item }; }), /maps no file to it/);
  });

  it("is silent on a craft standard or no standard", () => {
    expect(r03_4(broken(spec => { button(spec).candidates = { "button-v1.json": adoptedItem(`${LABEL}// edited\n`) }; button(spec).slot = { ...(button(spec).slot as object), standard: undefined }; }))).toEqual([]);
  });
});

describe("R03.5 adopt-first create needs a create verdict with a createGaps gap, and no raw headless import", () => {
  it("catches a create verdict whose gap class is not in createGaps", () => {
    catches(r03_5, broken(spec => { dial(spec).ledger = { events: [createVerdict("prettier"), submit("dial-v1.json", "L4", { reason: "r" })] }; }), /names no gap of class missing-behavior/);
  });

  it("catches a create with no create verdict", () => {
    catches(r03_5, broken(spec => { dial(spec).ledger = { events: [submit("dial-v1.json", "L4", { reason: "r" })] }; }), /create needs the P1 create verdict/);
  });

  it("catches a raw headless import", () => {
    const code = `import { useButton } from "react-aria";\nimport * as Dialog from "@radix-ui/react-dialog";\n${LABEL}`;
    catches(r03_5, broken(spec => { dial(spec).candidates = { "dial-v1.json": createdItem(code) }; }), /imports raw headless @radix-ui\/react-dialog, react-aria/);
  });

  it("reads import specifiers and tells raw headless from shadcn composition", () => {
    const ctx = r03World();
    const candidate = ctx.agents.find(agent => agent.agent === "designer")!.slots.get("assets.dial")!.candidates[0]!;
    expect(importSpecifiers({ ...candidate, json: { files: [{ path: "a.tsx", content: "import { x } from \"@/components/ui/button\";\nexport * from 'react-aria-components';\nconst y = await import(\"@react-aria/focus\");\n" }] } })).toEqual(["@/components/ui/button", "@react-aria/focus", "react-aria-components"]);
    for (const spec of ["react-aria", "react-aria-components", "@react-aria/focus", "@react-stately/list", "@radix-ui/react-slot", "@base-ui-components/react"]) expect(RAW_HEADLESS.test(spec), spec).toBe(true);
    for (const spec of ["@/components/ui/button", "react", "lucide-react", "react-aria-extra"]) expect(RAW_HEADLESS.test(spec), spec).toBe(false);
  });
});
