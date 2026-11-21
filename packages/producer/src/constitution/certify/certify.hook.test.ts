/**
 * HOOK-SLOT (foundry-build-0048): the element certifier reads the check a candidate is held to from its registry type,
 * in one table (registry-types.ts), and the slot, by its contract and layer, decides which types it accepts (planner
 * decision P1). A visual item is rendered with the contract fixture; a hook or lib item, in a hook or lib slot only, is
 * never rendered but held to the code check (fixture, file types, imports, a `use*` export); a registry type with no
 * row, or one the slot does not accept, fails closed before any check. Studio and the specimen preflight read the
 * same table (P2), and the specimen certifier runs the same code check (B-F2b).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NO_FOUNDRY_LEAVES, NO_HISTORY, slotDoc, writeWorkspace, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { buildContext } from "../context.js";
import type { ConstitutionContext, SlotRecord } from "../types.js";
import { recordStoreSource } from "@clossys/publisher/specimen";
import { certifyCandidate, libraryRecordStore } from "../../specimen/library-source.js";
import { certifyElement, elementCheck } from "./element.js";
import { certifyEnv, certifyFit, slotDocOf } from "./index.js";
import { CODE_ITEM_FILE_TYPES, elementCheckOf, REGISTRY_TYPE_CHECKS, REGISTRY_TYPE_SLOT_MISMATCH, REGISTRY_TYPE_UNKNOWN, RegistryTypeError, slotAcceptedTypes, slotClassOf } from "./registry-types.js";

const REFERENCE = fileURLToPath(new URL("../../../../designer/references/shadcn-aria/use-mobile@4.23.0/use-mobile.json", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../schemas/candidate.schema.json", import.meta.url));
const SLOT = "components.use-mobile";
const HOOK_FILE = "registry/aria-nova/hooks/use-mobile.ts";

/** Stock shadcn-aria/use-mobile, byte for byte, with the candidate's source record. */
function stockUseMobile(): Record<string, unknown> {
  const { $schema: _schema, ...item } = JSON.parse(readFileSync(REFERENCE, "utf8")) as Record<string, unknown>;
  return { ...item, meta: { source: { kind: "registry", ref: ["shadcn-aria/use-mobile@4.23.0"] } } };
}

/** A slot whose contract fixture names `file`'s `exported`: a hook slot for a `use*` export. */
function hookSlot(file = HOOK_FILE, exported = "useIsMobile", id = SLOT): Record<string, unknown> {
  const doc = slotDoc("designer", id);
  return { ...doc, contract: { summary: `element ${id}`, props: [], fixture: { schema: "clossys.element-preview/1", fixtures: { file, export: exported, props: {} } } } };
}
/** A contract whose fixture names `exported` (no slot). */
const fixtureNaming = (exported: string) => ({ props: [], fixture: { schema: "clossys.element-preview/1", fixtures: { file: "x.tsx", export: exported, props: {} } } });

/** A registry item of `type` shipping one file of `fileType`. */
const item = (type: string, code: string, fileType = type, path = HOOK_FILE, extra: Record<string, unknown> = {}) => ({
  name: "use-mobile", type, files: [{ path, type: fileType, content: code }], meta: { source: { kind: "original", ref: [] } }, ...extra,
});

function ctxOf(spec: WorkspaceSpec): ConstitutionContext {
  const { root, consumer } = writeWorkspace(spec);
  return buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES });
}
const slotOf = (ctx: ConstitutionContext, id = SLOT): SlotRecord => ctx.agents.find(agent => agent.agent === "designer")!.slots.get(id)!;
function fitOf(candidate: Record<string, unknown>, slot: Record<string, unknown> = hookSlot(), id = SLOT) {
  const ctx = ctxOf({ designer: { [id]: { slot, candidates: { [`${String(candidate.name ?? "use-mobile")}-v1.json`]: candidate } } } });
  const record = slotOf(ctx, id);
  return certifyFit({ slot: record, candidate: record.candidates[0]! }, certifyEnv(ctx)).map(reason => `${reason.code}: ${reason.message}`);
}

const USE_MOBILE = "import * as React from \"react\"\nexport function useIsMobile() { const [m] = React.useState(false); return m }\n";

describe("registry types: one table maps every element candidate type to its check", () => {
  it("has a row for exactly the element candidate schema's registry types", () => {
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8")) as { $defs?: Record<string, { properties?: { type?: { enum?: string[] } } }>; definitions?: Record<string, { properties?: { type?: { enum?: string[] } } }> };
    const defs = schema.$defs ?? schema.definitions ?? {};
    const types = defs.element?.properties?.type?.enum;
    expect(types).toBeDefined();
    expect(Object.keys(REGISTRY_TYPE_CHECKS).sort()).toEqual([...types!].sort());
  });

  it("derives each slot's class from its contract fixture and layer, never from a hand list", () => {
    expect(slotClassOf("components", fixtureNaming("useIsMobile"))).toBe("hook");
    expect(slotClassOf("themes", fixtureNaming("use"))).toBe("hook");
    expect(slotClassOf("components", fixtureNaming("cn"))).toBe("lib");
    expect(slotClassOf("components", fixtureNaming("useless"))).toBe("lib");
    for (const layer of ["components", "sections", "frames", "pages"]) {
      for (const contract of [fixtureNaming("Button"), fixtureNaming("default"), {}, undefined]) expect(slotClassOf(layer, contract)).toBe("visual");
    }
    for (const layer of ["themes", "assets", undefined]) expect(slotClassOf(layer, {})).toBe("layer");
    expect(CODE_ITEM_FILE_TYPES).toEqual({ hook: ["registry:hook", "registry:lib"], lib: ["registry:lib"] });
  });

  it("lets each slot accept only the registry types its class allows, derived from the table", () => {
    expect(slotAcceptedTypes("components", fixtureNaming("useIsMobile"))).toEqual(["registry:hook"]);
    expect(slotAcceptedTypes("components", fixtureNaming("cn"))).toEqual(["registry:lib"]);
    // A visual slot accepts what is rendered there: the visual rows, and the layer rows its layer renders.
    expect(slotAcceptedTypes("components", fixtureNaming("Button"))).toEqual(["registry:ui", "registry:block", "registry:component", "registry:page", "registry:style", "registry:file", "registry:base", "registry:item"]);
    expect(slotAcceptedTypes("themes", {})).toEqual(Object.keys(REGISTRY_TYPE_CHECKS).filter(type => type !== "registry:hook" && type !== "registry:lib"));
    for (const layer of ["components", "sections", "frames"]) {
      for (const type of ["registry:ui", "registry:block", "registry:component", "registry:page", "registry:item"]) expect(elementCheckOf("x", type, layer, fixtureNaming("Button"))).toBe("render");
    }
    expect(elementCheckOf("x", "registry:hook", "components", fixtureNaming("useIsMobile"))).toBe("hook");
    expect(elementCheckOf("x", "registry:lib", "components", fixtureNaming("cn"))).toBe("lib");
    expect(elementCheckOf("x", "registry:theme", "themes", {})).toBe("none");
    expect(elementCheckOf("x", "registry:file", "assets", {})).toBe("none");
    expect(elementCheckOf("x", "registry:ui", "assets", {})).toBe("render");
  });

  it("refuses a type its slot does not accept with REGISTRY-TYPE-SLOT-MISMATCH, before any check", () => {
    const refused: [string, string, Record<string, unknown> | undefined][] = [
      // A visual slot: no code item, and no theme or font (which would skip the render), whatever the candidate says.
      ["registry:lib", "components", fixtureNaming("Button")], ["registry:hook", "components", fixtureNaming("Button")],
      ["registry:theme", "components", fixtureNaming("Logo")], ["registry:font", "sections", fixtureNaming("Hero")],
      ["registry:lib", "frames", undefined],
      // A hook slot takes only a hook; a lib slot only a lib; a theme or asset slot no code item.
      ["registry:ui", "components", fixtureNaming("useIsMobile")], ["registry:lib", "components", fixtureNaming("useIsMobile")],
      ["registry:hook", "components", fixtureNaming("cn")], ["registry:ui", "components", fixtureNaming("cn")],
      ["registry:hook", "themes", {}], ["registry:lib", "assets", {}],
    ];
    for (const [type, layer, contract] of refused) {
      expect(() => elementCheckOf("components.x/x-v1.json", type, layer, contract), `${type} in ${layer}`).toThrow(RegistryTypeError);
      try { elementCheckOf("components.x/x-v1.json", type, layer, contract); }
      catch (error) {
        expect((error as RegistryTypeError).code).toBe(REGISTRY_TYPE_SLOT_MISMATCH);
        expect((error as Error).message).toMatch(new RegExp(`^${REGISTRY_TYPE_SLOT_MISMATCH} components\\.x/x-v1\\.json: the slot is a \\w+ slot .* it refuses ${type},`));
      }
    }
    expect(() => elementCheckOf("w", "registry:theme", "components", fixtureNaming("Logo"))).toThrow("REGISTRY-TYPE-SLOT-MISMATCH w: the slot is a visual slot (it is a slot of the components layer) and accepts only registry:ui, registry:block, registry:component, registry:page, registry:style, registry:file, registry:base, registry:item; it refuses registry:theme, which would get no check");
  });

  it("fails closed with a named error on a registry type with no row", () => {
    for (const type of ["registry:example", "registry:widget", "registry:"]) {
      expect(() => elementCheckOf("components.x/x-v1.json", type, "components", undefined)).toThrow(RegistryTypeError);
      expect(() => elementCheckOf("components.x/x-v1.json", type, "components", undefined)).toThrow(new RegExp(`^${REGISTRY_TYPE_UNKNOWN} components\\.x/x-v1\\.json: registry type ${type} has no row`));
      // Unknown is refused first, in any slot.
      expect(() => elementCheckOf("x", type, "components", fixtureNaming("useIsMobile"))).toThrow(new RegExp(`^${REGISTRY_TYPE_UNKNOWN} `));
    }
    // An inherited key is no row either.
    expect(() => elementCheckOf("x", "registry:constructor", "components", undefined)).toThrow(RegistryTypeError);
  });

  it("the element certifier refuses an unknown registry type as registry-type, before any render", () => {
    const ctx = ctxOf({ designer: { [SLOT]: { slot: hookSlot(), candidates: { "use-mobile-v1.json": item("registry:example", USE_MOBILE) } } } });
    const slot = slotOf(ctx);
    const reasons = certifyElement(slot, slot.candidates[0]!, slotDocOf(slot).contract, certifyEnv(ctx));
    expect(reasons).toEqual([expect.objectContaining({ code: "registry-type", message: expect.stringMatching(/^REGISTRY-TYPE-UNKNOWN .*registry:example/) })]);
    expect(elementCheck(slot, slot.candidates[0]!, slotDocOf(slot).contract)).toMatchObject({ code: "registry-type" });
  });
});

describe("certify: a hook is checked as code, not rendered (HOOK-SLOT)", () => {
  it("certifies stock shadcn-aria/use-mobile against its hook slot's contract fixture", () => {
    expect(fitOf(stockUseMobile())).toEqual([]);
  });

  it("refuses the same bytes typed registry:ui in the hook slot, and renders them in a visual slot", () => {
    const stock = stockUseMobile();
    expect(fitOf({ ...stock, type: "registry:ui" })).toEqual([expect.stringMatching(/^registry-type: REGISTRY-TYPE-SLOT-MISMATCH components\.use-mobile\/use-mobile-v1\.json: the slot is a hook slot \(its contract fixture names useIsMobile\) and accepts only registry:hook; it refuses registry:ui,/)]);
    // A visual slot whose fixture mounts the module's default export renders it, and refuses it for rendering nothing.
    const visual = hookSlot(HOOK_FILE, "default");
    expect(fitOf({ ...stock, type: "registry:ui", files: [{ path: HOOK_FILE, type: "registry:ui", content: "export default function UseMobile() { return null }\n" }] }, visual)).toEqual(["render: default renders nothing with the contract fixture"]);
  });

  it("refuses a hook that exports no function named use*", () => {
    const code = "export function isMobile() { return false }\n";
    expect(fitOf(item("registry:hook", code))).toEqual([
      `hook: ${HOOK_FILE} exports no function named use*, so it is no hook`,
      `fixture: ${HOOK_FILE} exports no function useIsMobile, which the contract fixture names`,
    ]);
    // A slot whose fixture names a non-use* export is a lib slot, which refuses a hook outright.
    expect(fitOf(item("registry:hook", code), hookSlot(HOOK_FILE, "isMobile"))).toEqual([expect.stringMatching(/^registry-type: REGISTRY-TYPE-SLOT-MISMATCH .*the slot is a lib slot \(its contract fixture names isMobile\) and accepts only registry:lib; it refuses registry:hook,/)]);
    expect(fitOf(item("registry:hook", "export const useIsMobile = 768;\n"))).toEqual([
      `hook: ${HOOK_FILE} exports no function named use*, so it is no hook`,
      `fixture: ${HOOK_FILE} exports no function useIsMobile, which the contract fixture names`,
    ]);
  });

  it("refuses a hook item that ships a visual file", () => {
    expect(fitOf(item("registry:hook", USE_MOBILE, "registry:ui"))).toEqual([
      `hook: a registry:hook item ships ${HOOK_FILE} as registry:ui; it may ship only registry:hook and registry:lib files, and is never rendered`,
      // A file not typed registry:hook carries no use* obligation, but the item is refused all the same.
    ]);
  });

  it("refuses a hook that imports a module it does not ship or a package that is not installed, static or dynamic", () => {
    const missing = `import { thing } from "left-pad-not-declared"\n${USE_MOBILE}`;
    expect(fitOf(item("registry:hook", missing))).toEqual(expect.arrayContaining([expect.stringMatching(/^import: imports left-pad-not-declared, which dependencies does not declare$/)]));
    const lazy = `${USE_MOBILE}export function useLater() { return import("not-installed-anywhere/sub") }\n`;
    expect(fitOf(item("registry:hook", lazy))).toEqual(["import: imports not-installed-anywhere, which dependencies does not declare"]);
    const declared = item("registry:hook", lazy, "registry:hook", HOOK_FILE, { dependencies: ["not-installed-anywhere@1.0.0"] });
    expect(fitOf(declared)).toEqual(["import: declares not-installed-anywhere@1.0.0 but none is installed"]);
    const relative = `import { x } from "./missing"\n${USE_MOBILE}`;
    expect(fitOf(item("registry:hook", relative))).toEqual([`import: ${HOOK_FILE} imports ./missing, which the candidate does not ship`]);
    const alias = `${USE_MOBILE}export function useOther() { return import("@/hooks/not-pinned") }\n`;
    expect(fitOf(item("registry:hook", alias))).toEqual(["import: imports @/hooks/not-pinned, which neither the candidate nor a pinned slot installs"]);
  });

  it("holds a hook to its contract fixture like any element", () => {
    const doc = hookSlot();
    const { fixture: _fixture, ...contract } = doc.contract as Record<string, unknown>;
    // With no fixture naming a use* export the slot is no hook slot: a components slot is visual, and refuses the hook.
    expect(fitOf(stockUseMobile(), { ...doc, contract })).toEqual([expect.stringMatching(/^registry-type: REGISTRY-TYPE-SLOT-MISMATCH .*the slot is a visual slot \(it is a slot of the components layer\)/)]);
    expect(fitOf(stockUseMobile(), hookSlot("hooks/other.ts"))).toEqual(["fixture: the candidate ships no hooks/other.ts, which the contract fixture mounts"]);
  });

  it("checks a lib item as code: it loads and exports a function, and needs no use* name", () => {
    const lib = (code: string) => item("registry:lib", code, "registry:lib", "lib/utils.ts");
    const slot = hookSlot("lib/utils.ts", "cn");
    expect(fitOf(lib("export function cn(...parts: string[]) { return parts.join(\" \") }\n"), slot)).toEqual([]);
    expect(fitOf(lib("export const cn = \"\";\n"), slot)).toEqual(["hook: lib/utils.ts exports no function", "fixture: lib/utils.ts exports no function cn, which the contract fixture names"]);
    expect(fitOf(item("registry:lib", "export function cn() { return \"\" }\n", "registry:hook", "lib/utils.ts"), slot)[0]).toMatch(/^hook: a registry:lib item ships lib\/utils\.ts as registry:hook/);
  });
});

describe("P1: a candidate's own type never turns a visual slot's render off (A-F1, B-F1)", () => {
  const BUTTON = "components.button", BUTTON_FILE = "registry/aria-nova/ui/button.tsx";
  const LOGO = "components.logo", LOGO_FILE = "components/logo.tsx";
  const EMPTY = (name: string) => `export function ${name}() { return null }\n`;
  const THROWS = (name: string) => `export function ${name}() { throw new Error("boom") }\n`;
  const component = (name: string, type: string, code: string, path: string, fileType = type) => ({ name: name.toLowerCase(), type, files: [{ path, type: fileType, content: code }], meta: { source: { kind: "original", ref: [] } } });
  const buttonFit = (type: string, code: string, fileType = type) => fitOf(component("Button", type, code, BUTTON_FILE, fileType), hookSlot(BUTTON_FILE, "Button", BUTTON), BUTTON);
  const logoFit = (type: string, code: string, fileType = type) => fitOf(component("Logo", type, code, LOGO_FILE, fileType), hookSlot(LOGO_FILE, "Logo", LOGO), LOGO);
  const mismatch = (slot: string, name: string, type: string) => new RegExp(`^registry-type: REGISTRY-TYPE-SLOT-MISMATCH ${slot.replace(".", "\\.")}/${name}-v1\\.json: the slot is a visual slot \\(it is a slot of the components layer\\) and accepts only registry:ui, .*; it refuses ${type},`);

  it("renders a visual Button and refuses it when it renders nothing or throws", () => {
    expect(buttonFit("registry:ui", EMPTY("Button"))).toEqual(["render: Button renders nothing with the contract fixture"]);
    expect(buttonFit("registry:ui", THROWS("Button"))).toEqual(["render: rendering Button with the contract fixture throws: boom"]);
    // A layer type the components layer renders is rendered as before (no check lost).
    expect(buttonFit("registry:item", EMPTY("Button"), "registry:ui")).toEqual(["render: Button renders nothing with the contract fixture"]);
  });

  it("refuses an empty or a throwing Button typed registry:lib in a visual slot", () => {
    expect(buttonFit("registry:lib", EMPTY("Button"))).toEqual([expect.stringMatching(mismatch(BUTTON, "button", "registry:lib"))]);
    expect(buttonFit("registry:lib", THROWS("Button"))).toEqual([expect.stringMatching(mismatch(BUTTON, "button", "registry:lib"))]);
    expect(buttonFit("registry:hook", EMPTY("Button"))).toEqual([expect.stringMatching(mismatch(BUTTON, "button", "registry:hook"))]);
  });

  it("refuses a Logo typed registry:lib, registry:theme or registry:font in a visual slot", () => {
    expect(logoFit("registry:ui", THROWS("Logo"))).toEqual(["render: rendering Logo with the contract fixture throws: boom"]);
    for (const type of ["registry:lib", "registry:theme", "registry:font"]) {
      expect(logoFit(type, EMPTY("Logo"), type === "registry:lib" ? type : "registry:ui"), type).toEqual([expect.stringMatching(mismatch(LOGO, "logo", type))]);
      expect(logoFit(type, THROWS("Logo"), type === "registry:lib" ? type : "registry:ui"), type).toEqual([expect.stringMatching(mismatch(LOGO, "logo", type))]);
    }
  });

  it("the specimen certifier refuses them the same way", () => {
    const run = (slot: string, file: string, name: string, type: string, code: string) => certifyCandidate({ root: ".", slot, name: `${name.toLowerCase()}-v1.json`, bytes: JSON.stringify(component(name, type, code, file)), contract: hookSlot(file, name, slot).contract as Record<string, unknown>, layer: "components", writerSource: () => ({}) });
    for (const [slot, file, name, type] of [[BUTTON, BUTTON_FILE, "Button", "registry:lib"], [LOGO, LOGO_FILE, "Logo", "registry:lib"], [LOGO, LOGO_FILE, "Logo", "registry:theme"]] as const) {
      const result = run(slot, file, name, type, THROWS(name));
      expect(result.certified).toBe(false);
      expect(result.mounts).toBe(false);
      expect(result.reasons).toEqual([expect.stringMatching(new RegExp(`^REGISTRY-TYPE-SLOT-MISMATCH ${slot.replace(".", "\\.")}/.*it refuses ${type},`))]);
    }
  });
});

describe("specimen certify: the same table and the same code check (library-source certifyCandidate)", () => {
  /** A consumer root holding the hook slot with `candidate` (pinned), for the specimen certifier to read its pins. */
  function consumerWith(candidate: Record<string, unknown>, slot: Record<string, unknown> = hookSlot()) {
    return writeWorkspace({ designer: { [SLOT]: { slot, pin: "auto", candidates: { "use-mobile-v1.json": candidate } } } }).consumer;
  }
  const run = (candidate: Record<string, unknown>, contract: Record<string, unknown> = hookSlot().contract as Record<string, unknown>, root = consumerWith(candidate)) =>
    certifyCandidate({ root, slot: SLOT, name: "use-mobile-v1.json", bytes: JSON.stringify(candidate), contract, layer: "components", writerSource: () => ({}) });

  it("certifies stock use-mobile in its hook slot and does not mount it", () => {
    expect(run(stockUseMobile())).toEqual({ certified: true, reasons: [], mounts: false });
  });

  it("runs the gate's full code check on a hook, not only the fixture check (B-F2b)", () => {
    expect(run(item("registry:hook", `import { thing } from "left-pad-not-declared"\n${USE_MOBILE}`)).reasons).toEqual(["imports left-pad-not-declared, which dependencies does not declare"]);
    expect(run(item("registry:hook", `${USE_MOBILE}export function useOther() { return import("@/hooks/not-pinned") }\n`)).reasons).toEqual(["imports @/hooks/not-pinned, which neither the candidate nor a pinned slot installs"]);
    expect(run(item("registry:hook", USE_MOBILE, "registry:ui")).reasons).toEqual([`a registry:hook item ships ${HOOK_FILE} as registry:ui; it may ship only registry:hook and registry:lib files, and is never rendered`]);
    expect(run(item("registry:hook", `export function useIsMobile() { return false }\nexport const helper = 1;\n`, "registry:hook", HOOK_FILE, { files: [{ path: HOOK_FILE, type: "registry:hook", content: USE_MOBILE }, { path: "registry/aria-nova/hooks/other.ts", type: "registry:hook", content: "export const x = 1;\n" }] })).reasons)
      .toEqual(["registry/aria-nova/hooks/other.ts exports no function named use*, so it is no hook"]);
  });

  it("refuses a visual type in the hook slot, and the hook in a slot with no hook fixture", () => {
    expect(run({ ...stockUseMobile(), type: "registry:ui" })).toEqual({ certified: false, mounts: false, reasons: [expect.stringMatching(/^REGISTRY-TYPE-SLOT-MISMATCH components\.use-mobile\/use-mobile-v1\.json: the slot is a hook slot .*it refuses registry:ui,/)] });
    expect(run(stockUseMobile(), {})).toEqual({ certified: false, mounts: false, reasons: [expect.stringMatching(/^REGISTRY-TYPE-SLOT-MISMATCH .*the slot is a visual slot .*it refuses registry:hook,/)] });
  });

  it("fails closed on a registry type with no row", () => {
    const result = run({ ...stockUseMobile(), type: "registry:example" });
    expect(result.certified).toBe(false);
    expect(result.reasons).toEqual([expect.stringMatching(/^REGISTRY-TYPE-UNKNOWN components\.use-mobile\/use-mobile-v1\.json: registry type registry:example/)]);
  });
});

describe("P2: Studio and the specimen preflight read the same table (library-source libraryRecordStore)", () => {
  const ELEMENT = `${SLOT}/use-mobile`;
  it("loads a pinned hook in its hook slot as a record that never mounts", async () => {
    const { consumer } = writeWorkspace({ designer: { [SLOT]: { slot: hookSlot(), pin: "auto", candidates: { "use-mobile-v1.json": stockUseMobile() } } } });
    const row = await libraryRecordStore([consumer], { writerCopy: {} }).load(ELEMENT);
    expect(row?.kind).toBe("data");
    const record = await recordStoreSource(libraryRecordStore([consumer], { writerCopy: {} })).read(ELEMENT);
    expect(record?.kind).toBe("data");
  });

  it("refuses to load a candidate whose type its slot does not accept, so it is never mounted", async () => {
    const { consumer } = writeWorkspace({ designer: { [SLOT]: { slot: hookSlot(), pin: "auto", candidates: { "use-mobile-v1.json": { ...stockUseMobile(), type: "registry:ui" } } } } });
    await expect(libraryRecordStore([consumer], { writerCopy: {} }).load(ELEMENT)).rejects.toThrow(/^REGISTRY-TYPE-SLOT-MISMATCH components\.use-mobile\/use-mobile-v1\.json: the slot is a hook slot/);
  });
});
