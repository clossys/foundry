/**
 * HOOK-SLOT (foundry-build-0048): the element certifier reads the check a candidate is held to from its registry type,
 * in one table (registry-types.ts). A visual item is rendered with the contract fixture; a hook or lib item is never
 * rendered but held to the code check (fixture, file types, imports, a `use*` export); a registry type with no row
 * fails closed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NO_FOUNDRY_LEAVES, NO_HISTORY, slotDoc, writeWorkspace, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { buildContext } from "../context.js";
import type { ConstitutionContext, SlotRecord } from "../types.js";
import { certifyCandidate } from "../../specimen/library-source.js";
import { certifyElement, elementCheck, mountsComponent } from "./element.js";
import { certifyEnv, certifyFit, slotDocOf } from "./index.js";
import { CODE_ITEM_FILE_TYPES, elementCheckOf, REGISTRY_TYPE_CHECKS, REGISTRY_TYPE_UNKNOWN, RegistryTypeError } from "./registry-types.js";

const REFERENCE = fileURLToPath(new URL("../../../../designer/references/shadcn-aria/use-mobile@4.23.0/use-mobile.json", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../schemas/candidate.schema.json", import.meta.url));
const SLOT = "components.use-mobile";
const HOOK_FILE = "registry/aria-nova/hooks/use-mobile.ts";

/** Stock shadcn-aria/use-mobile, byte for byte, with the candidate's source record. */
function stockUseMobile(): Record<string, unknown> {
  const { $schema: _schema, ...item } = JSON.parse(readFileSync(REFERENCE, "utf8")) as Record<string, unknown>;
  return { ...item, meta: { source: { kind: "registry", ref: ["shadcn-aria/use-mobile@4.23.0"] } } };
}

/** A hook slot whose contract fixture names `file`'s `exported`. */
function hookSlot(file = HOOK_FILE, exported = "useIsMobile"): Record<string, unknown> {
  const doc = slotDoc("designer", SLOT);
  return { ...doc, contract: { summary: `element ${SLOT}`, props: [], fixture: { schema: "clossys.element-preview/1", fixtures: { file, export: exported, props: {} } } } };
}

/** A registry item of `type` shipping one file of `fileType`. */
const item = (type: string, code: string, fileType = type, path = HOOK_FILE, extra: Record<string, unknown> = {}) => ({
  name: "use-mobile", type, files: [{ path, type: fileType, content: code }], meta: { source: { kind: "original", ref: [] } }, ...extra,
});

function ctxOf(spec: WorkspaceSpec): ConstitutionContext {
  const { root, consumer } = writeWorkspace(spec);
  return buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES });
}
const slotOf = (ctx: ConstitutionContext, id = SLOT): SlotRecord => ctx.agents.find(agent => agent.agent === "designer")!.slots.get(id)!;
function fitOf(candidate: Record<string, unknown>, slot: Record<string, unknown> = hookSlot()) {
  const ctx = ctxOf({ designer: { [SLOT]: { slot, candidates: { "use-mobile-v1.json": candidate } } } });
  const record = slotOf(ctx);
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

  it("renders the visual types in any layer and never renders a hook or lib", () => {
    for (const layer of ["components", "themes", "assets", "sections"]) {
      for (const type of ["registry:ui", "registry:block", "registry:component", "registry:page"]) expect(elementCheckOf("x", type, layer)).toBe("render");
      expect(elementCheckOf("x", "registry:hook", layer)).toBe("hook");
      expect(elementCheckOf("x", "registry:lib", layer)).toBe("lib");
    }
    // Items that are not code the certifier types itself keep the layer's specimen kind.
    expect(elementCheckOf("x", "registry:theme", "components")).toBe("none");
    expect(elementCheckOf("x", "registry:file", "assets")).toBe("none");
    expect(elementCheckOf("x", "registry:file", "components")).toBe("render");
    expect(CODE_ITEM_FILE_TYPES).toEqual({ hook: ["registry:hook", "registry:lib"], lib: ["registry:lib"] });
  });

  it("fails closed with a named error on a registry type with no row", () => {
    for (const type of ["registry:example", "registry:widget", "registry:"]) {
      expect(() => elementCheckOf("components.x/x-v1.json", type, "components")).toThrow(RegistryTypeError);
      expect(() => elementCheckOf("components.x/x-v1.json", type, "components")).toThrow(new RegExp(`^${REGISTRY_TYPE_UNKNOWN} components\\.x/x-v1\\.json: registry type ${type} has no row`));
    }
    // An inherited key is no row either.
    expect(() => elementCheckOf("x", "registry:constructor", "components")).toThrow(RegistryTypeError);
  });

  it("the element certifier refuses an unknown registry type as registry-type, before any render", () => {
    const ctx = ctxOf({ designer: { [SLOT]: { slot: hookSlot(), candidates: { "use-mobile-v1.json": item("registry:example", USE_MOBILE) } } } });
    const slot = slotOf(ctx);
    const reasons = certifyElement(slot, slot.candidates[0]!, slotDocOf(slot).contract, certifyEnv(ctx));
    expect(reasons).toEqual([expect.objectContaining({ code: "registry-type", message: expect.stringMatching(/^REGISTRY-TYPE-UNKNOWN .*registry:example/) })]);
    expect(elementCheck(slot, slot.candidates[0]!)).toMatchObject({ code: "registry-type" });
    expect(mountsComponent(slot, slot.candidates[0]!)).toMatchObject({ code: "registry-type" });
  });
});

describe("certify: a hook is checked as code, not rendered (HOOK-SLOT)", () => {
  it("certifies stock shadcn-aria/use-mobile against its hook slot's contract fixture", () => {
    expect(fitOf(stockUseMobile())).toEqual([]);
  });

  it("still renders the same bytes when the item says registry:ui, and refuses them for rendering nothing", () => {
    const stock = stockUseMobile();
    expect(fitOf({ ...stock, type: "registry:ui" })).toEqual([expect.stringMatching(/^render: useIsMobile renders nothing with the contract fixture$/)]);
  });

  it("refuses a hook that exports no function named use*", () => {
    const code = "export function isMobile() { return false }\n";
    expect(fitOf(item("registry:hook", code), hookSlot(HOOK_FILE, "isMobile"))).toEqual([
      `hook: ${HOOK_FILE} exports no function named use*, so it is no hook`,
      "fixture: the contract fixture names isMobile, which is no use* hook export",
    ]);
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
    expect(fitOf(stockUseMobile(), { ...doc, contract })).toEqual([`no-fixture: slot ${SLOT} declares no contract fixture (slot.json contract.fixture)`]);
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

describe("specimen certify: the same table (library-source certifyCandidate)", () => {
  const contract = hookSlot().contract as Record<string, unknown>;
  const run = (candidate: Record<string, unknown>) => certifyCandidate({ root: fileURLToPath(new URL(".", import.meta.url)), slot: SLOT, name: "use-mobile-v1.json", bytes: JSON.stringify(candidate), contract, layer: "components", writerSource: () => ({}) });

  it("holds a hook to the contract fixture but does not mount it", () => {
    expect(run(stockUseMobile())).toEqual({ certified: true, reasons: [], mounts: false });
    expect(run({ ...stockUseMobile(), type: "registry:ui" })).toEqual({ certified: true, reasons: [], mounts: true });
    expect(certifyCandidate({ root: ".", slot: SLOT, name: "use-mobile-v1.json", bytes: JSON.stringify(stockUseMobile()), contract: {}, layer: "components", writerSource: () => ({}) }))
      .toEqual({ certified: false, reasons: [`uncertified: slot ${SLOT} declares no contract fixture (slot.json contract.fixture)`], mounts: false });
  });

  it("fails closed on a registry type with no row", () => {
    const result = run({ ...stockUseMobile(), type: "registry:example" });
    expect(result.certified).toBe(false);
    expect(result.reasons).toEqual([expect.stringMatching(/^REGISTRY-TYPE-UNKNOWN components\.use-mobile\/use-mobile-v1\.json: registry type registry:example/)]);
  });
});
