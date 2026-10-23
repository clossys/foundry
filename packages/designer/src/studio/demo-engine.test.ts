import { describe, expect, it } from "vitest";
import { EXAMPLE_FILLS, EXAMPLE_LIBRARY, EXAMPLE_RESOLVED, EXAMPLE_SELECTION } from "../catalog-core/__fixtures__/example-library.js";
import { isValidId, type ChangeSet, type Pick, type Resolved, type Selection } from "../catalog-core/index.js";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { applyChangeSet, check, emit, resolve, selectionHash } from "./demo-engine.js";

const input = (selection: Selection = DEMO_SELECTION) => ({ catalog: DEMO_CATALOG, library: DEMO_LIBRARY, selection });
const withPicks = (...picks: Pick[]): Selection => ({ ...DEMO_SELECTION, picks });
const ACTION = "tokens.accent-color";
const RAMP = "tokens.color-ramp";

describe("demo engine agrees with the hand-written S0-a fixture", () => {
  it("hashes the fixture selection to the fixture's own hash", () => {
    expect(selectionHash(EXAMPLE_SELECTION)).toBe(EXAMPLE_RESOLVED.selectionHash);
  });
  it("resolves the fixture's five members to exactly the fixture's values", () => {
    const resolved = resolve({ catalog: DEMO_CATALOG, library: EXAMPLE_LIBRARY, selection: EXAMPLE_SELECTION });
    for (const [id, member] of Object.entries(EXAMPLE_RESOLVED.members)) expect(resolved.members[id]).toEqual(member);
    expect(EXAMPLE_FILLS).toHaveLength(4);
  });
});

describe("demo data", () => {
  it("uses two-segment slot ids, member ids under them and a tier on every contract", () => {
    expect(DEMO_CATALOG.slots).toHaveLength(10);
    for (const slot of DEMO_CATALOG.slots) {
      expect(isValidId("slot", slot.id)).toBe(true);
      expect(slot.id.split(".")).toHaveLength(2);
      expect(["scale", "role"]).toContain(slot.contract.tier);
    }
    for (const id of Object.keys(resolve(input()).members)) expect(isValidId("member", id)).toBe(true);
    expect(DEMO_CATALOG.retired).toEqual([]);
  });
  it("places every slot exactly once in the placement file", () => {
    const leaves: string[] = [];
    const walk = (node: (typeof DEMO_CATALOG.placements)[number]["nodes"][number]): void => {
      if ("children" in node) node.children.forEach(walk);
      else leaves.push(...node.leaves);
    };
    for (const placement of DEMO_CATALOG.placements) placement.nodes.forEach(walk);
    expect([...leaves].sort()).toEqual(DEMO_CATALOG.slots.map((slot) => slot.id).sort());
  });
  it("leaves one draft slot without any fill", () => {
    const filled = new Set([...DEMO_CATALOG.fills, ...DEMO_LIBRARY.fills].map((doc) => doc.$extensions["com.clossys.fill"].slot));
    expect(DEMO_CATALOG.slots.filter((slot) => !filled.has(slot.id)).map((slot) => slot.id)).toEqual(["tokens.font-size"]);
  });
});

describe("resolve", () => {
  it("takes the first source of the default chain that provides a member", () => {
    const { members } = resolve(input());
    expect(members[`${ACTION}.default`]).toMatchObject({ source: "example", via: "default", css: { light: "#8250DF", dark: "#A371F7" }, emit: "--color-accent" });
    expect(members["tokens.region-width.wide"]).toMatchObject({ source: "foundry", via: "default", css: { light: "1024px" } });
  });
  it("applies member over slot, and falls back to the default chain when a pick cannot provide", () => {
    const slotPick: Pick = { scope: "slot", target: ACTION, source: "foundry" };
    const memberPick: Pick = { scope: "member", target: `${ACTION}.hover`, source: "example" };
    expect(resolve(input(withPicks(slotPick))).members[`${ACTION}.default`]).toMatchObject({ source: "foundry", via: "slot" });
    const mixed = resolve(input(withPicks(slotPick, memberPick))).members;
    expect(mixed[`${ACTION}.default`]).toMatchObject({ source: "foundry", via: "slot" });
    expect(mixed[`${ACTION}.hover`]).toMatchObject({ source: "example", via: "member" });
    const missing = resolve(input(withPicks({ scope: "slot", target: "tokens.line-height", source: "tailwind-default" }))).members;
    expect(missing["tokens.line-height.body"]).toMatchObject({ source: "foundry", via: "default" });
    const unresolved = resolve(input(withPicks({ scope: "member", target: `${ACTION}.hover`, source: "tailwind-default" }))).members;
    expect(unresolved[`${ACTION}.hover`]).toBeUndefined();
    expect(unresolved[`${ACTION}.default`]).toMatchObject({ source: "example", via: "default" });
  });
  it("never resolves from a reference fill", () => {
    const { members } = resolve(input(withPicks({ scope: "slot", target: ACTION, source: "reference-kit" })));
    expect(members[`${ACTION}.default`]?.source).toBe("example");
  });
  it("follows aliases in the same profile, so changing the ramp recolours the role", () => {
    const { members } = resolve(input(withPicks({ scope: "slot", target: RAMP, source: "tailwind-default" })));
    expect(members[`${ACTION}.default`]).toMatchObject({ css: { light: "#7F22FE", dark: "#A684FF" }, alias: { light: `${RAMP}.violet.600`, dark: `${RAMP}.violet.400` } });
  });
  it("formats css per type and gives font payloads", () => {
    const { members } = resolve(input());
    expect(members["tokens.easing.standard"]?.css.light).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(members["tokens.duration.fast"]?.css.light).toBe("100ms");
    expect(members["tokens.typeface.mono"]).toMatchObject({ css: { light: "\"JetBrains Mono\", monospace" }, font: { kind: "fontsource", weights: [400] } });
    expect(members["tokens.line-height.body"]?.css.light).toBe("1.5");
    expect(members["tokens.typeface.mono"]?.css.dark).toBeUndefined();
  });
  it("is independent of the order of fills and picks", () => {
    const picks = [{ scope: "slot", target: RAMP, source: "tailwind-default" }, { scope: "member", target: `${ACTION}.hover`, source: "foundry" }] as const satisfies readonly Pick[];
    const forward = resolve({ catalog: DEMO_CATALOG, library: DEMO_LIBRARY, selection: withPicks(...picks) });
    const reversed = resolve({
      catalog: { ...DEMO_CATALOG, slots: [...DEMO_CATALOG.slots].reverse(), fills: [...DEMO_CATALOG.fills].reverse() },
      library: { ...DEMO_LIBRARY, fills: [...DEMO_LIBRARY.fills].reverse() }, selection: withPicks(...[...picks].reverse()),
    });
    expect(Object.keys(reversed.members)).toEqual(Object.keys(forward.members));
    expect(reversed.members).toEqual(forward.members);
  });
  it("refuses an unsupported selection version", () => {
    expect(() => resolve(input({ ...DEMO_SELECTION, version: 2 as 1 }))).toThrow("selection version 2 is not supported");
  });
});

describe("check", () => {
  it("is clean for the default profile", () => {
    expect(check(input())).toEqual({ ok: true, findings: [] });
  });
  it.each([";", "{", "}", "<", ">", "\\", "/*", "*/", "@", "url(", "expression(", "!important"])("reports unsafe text %s as a C1 error on the fill", (token) => {
    const unsafe = (fill: Resolved["members"][string]) => ({ ...fill, css: { light: `1px${token}x` } });
    const resolved = resolve(input());
    const base = resolved.members["tokens.region-width.wide"] as Resolved["members"][string];
    const result = check({ ...input(), resolved: { ...resolved, members: { ...resolved.members, "tokens.region-width.wide": unsafe(base) } } });
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([{
      code: "C1", rule: "contract", severity: "error", subject: base.fill,
      message: `contract: ${base.fill} member tokens.region-width.wide has unsafe CSS text (${token})`,
    }]);
  });
  it("reports the seeded unsafe fill only when it takes part", () => {
    const picked = check(input(withPicks({ scope: "slot", target: "tokens.region-width", source: "tailwind-default" })));
    expect(picked.findings.map((finding) => finding.message)).toEqual([
      "contract: tailwind-default/tokens.region-width member tokens.region-width.narrow has unsafe CSS text (;)",
    ]);
  });
  it("rejects a pick of a reference fill with C7", () => {
    const result = check(input(withPicks({ scope: "slot", target: ACTION, source: "reference-kit" })));
    expect(result).toEqual({ ok: false, findings: [{
      code: "C7", rule: "selection", severity: "error", subject: `reference-kit/${ACTION}`,
      message: `selection: reference-kit/${ACTION} is a reference cell and cannot be selected (slot pick ${ACTION})`,
    }] });
  });
});

describe("emit", () => {
  const resolved: Resolved = {
    version: 1, consumer: "example", selectionHash: "fnv1a64:0000000000000000", notices: [],
    members: {
      "tokens.accent-color.default": {
        slot: ACTION, source: "example", fill: `example/${ACTION}`, via: "default", $type: "color",
        value: { light: "a", dark: "b" }, css: { light: "#111111", dark: "#222222" }, alias: {}, emit: "--color-accent",
      },
      "tokens.spacing.sm": {
        slot: "tokens.spacing", source: "example", fill: "example/tokens.spacing", via: "default", $type: "dimension",
        value: { light: "a" }, css: { light: "8px" }, alias: {}, emit: "--spacing-sm",
      },
      "tokens.region-width.narrow": {
        slot: "tokens.region-width", source: "example", fill: "example/tokens.region-width", via: "default", $type: "dimension",
        value: { light: "a" }, css: { light: "640px" }, alias: {},
      },
    },
  };
  const live = {
    light: ":root:root[data-brand-bound]", mediaDark: "@media (prefers-color-scheme: dark) { :root:root[data-brand-bound]:not([data-theme=\"light\"])", dark: ":root:root[data-brand-bound][data-theme=\"dark\"]",
  };
  it("writes bound members, with dark blocks only for members that differ", () => {
    expect(emit(resolved, ["css-brand"])).toEqual([{ path: "brand.css", contents: [
      "/* Generated by @clossys/designer/catalog (css-brand). Do not edit. consumer example selection fnv1a64:0000000000000000 */",
      ":root[data-brand-bound] {", "  --color-accent: #111111;", "  --spacing-sm: 8px;", "}",
      "@media (prefers-color-scheme: dark) { :root[data-brand-bound]:not([data-theme=\"light\"]) {", "  --color-accent: #222222;", "}", "}",
      ":root[data-brand-bound][data-theme=\"dark\"] {", "  --color-accent: #222222;", "}", "",
    ].join("\n") }]);
  });
  it("leaves a member whose dark value equals its light value out of the dark blocks", () => {
    const base = resolved.members[`${ACTION}.default`] as Resolved["members"][string];
    const same: Resolved = { ...resolved, members: { ...resolved.members, "tokens.border-color.base": { ...base, css: { light: "#333333", dark: "#333333" }, emit: "--color-line" } } };
    const text = emit(same, ["css-brand"], { header: false })[0]?.contents ?? "";
    expect(text.match(/--color-line: #333333;/g)).toHaveLength(1);
    expect(text.match(/--color-accent: #222222;/g)).toHaveLength(2);
  });
  it("with full, writes every bound member into all three blocks", () => {
    const text = emit(resolved, ["css-brand"], { full: true, selectors: live, header: false })[0]?.contents ?? "";
    expect(text.match(/--spacing-sm: 8px;/g)).toHaveLength(3);
    expect(text.match(/--color-accent: /g)).toHaveLength(3);
    expect(text.split("\n")[0]).toBe(":root:root[data-brand-bound] {");
    expect(text.split("{").length).toBe(text.split("}").length);
  });
  it("with extraVars, names unbound members --studio-m-<index> in id order", () => {
    const text = emit(resolved, ["css-brand"], { extraVars: true, header: false })[0]?.contents ?? "";
    expect(text).toContain("  --studio-m-0: 640px;");
    expect(emit(resolved, ["css-brand"], { header: false })[0]?.contents).not.toContain("--studio-m-");
  });
  it("writes nothing for an empty set and refuses other targets", () => {
    expect(emit({ ...resolved, members: {} }, ["css-brand"], { header: false })[0]?.contents).toBe("");
    expect(() => emit(resolved, ["css-scales"])).toThrow("only css-brand");
  });
});

describe("applyChangeSet and selectionHash", () => {
  const set = (source: string, target = ACTION): ChangeSet["changes"][number] => ({ op: "set", pick: { scope: "slot", target, source } });
  const against = (selection: Selection, ...changes: ChangeSet["changes"][number][]): ChangeSet => ({ baseHash: selectionHash(selection), changes });
  it("sets, replaces and clears picks, keeping them sorted", () => {
    const one = applyChangeSet(DEMO_SELECTION, against(DEMO_SELECTION, set("foundry", RAMP), set("foundry")));
    expect(one.picks.map((pick) => pick.target)).toEqual([ACTION, RAMP]);
    const two = applyChangeSet(one, against(one, set("example"), { op: "clear", scope: "slot", target: RAMP }));
    expect(two.picks).toEqual([{ scope: "slot", target: ACTION, source: "example" }]);
  });
  it("is deterministic and refuses a stale base", () => {
    expect(selectionHash(DEMO_SELECTION)).toBe(selectionHash({ ...DEMO_SELECTION }));
    expect(selectionHash(DEMO_SELECTION)).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(() => applyChangeSet(DEMO_SELECTION, { baseHash: "fnv1a64:0000000000000000", changes: [] })).toThrow("conflict");
  });
});
