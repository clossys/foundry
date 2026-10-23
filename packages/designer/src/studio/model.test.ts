import { describe, expect, it } from "vitest";
import type { ChangeSet, DtcgType, Pick, ResolvedMember, Selection } from "../catalog-core/index.js";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { applyChangeSet, resolve, selectionHash } from "./demo-engine.js";
import { addChange, addChanges, buildCandidates, buildSlotTree, changesFor, defaultTarget, describePreview, emptyChanges, inspectorModel, nodeOptions, pendingCount, previewRows, scopeTargets, toneOf, workingSelection, type Scope } from "./model.js";

const ACTION = "tokens.accent-color";
const CONTAINER = "tokens.region-width";
const RAMP = "tokens.color-ramp";
const SPACING = "tokens.spacing";
const base = { catalog: DEMO_CATALOG, library: DEMO_LIBRARY };
const candidatesFor = (slotId: string, scope: Scope = "slot", target = slotId, working: Selection = DEMO_SELECTION) =>
  buildCandidates({ ...base, working, slotId, scope, target });
const none: ChangeSet = { baseHash: selectionHash(DEMO_SELECTION), changes: [] };

describe("buildSlotTree", () => {
  it("shows layer, placement nodes and leaves in file order, with node labels and slot ids as labels", () => {
    const tree = buildSlotTree(DEMO_CATALOG.placements);
    expect(tree.map((node) => [node.id, node.label])).toEqual([["tokens", "tokens"]]);
    const tokens = tree[0]!;
    expect(tokens.children?.map((node) => [node.id, node.label])).toEqual([["tokens/scale", "Scale"], ["tokens/role", "Role"]]);
    const scale = tokens.children?.[0];
    expect(scale?.children?.map((node) => [node.id, node.label])).toEqual([["tokens/scale-color", "Color"], ["tokens/scale-type", "Type"], ["tokens/scale-space", "Space"], ["tokens/scale-motion", "Motion"]]);
    const leaves = (nodes: readonly { id: string; children?: readonly unknown[] }[]): string[] =>
      nodes.flatMap((node) => (node.children ? leaves(node.children as typeof nodes) : [node.id]));
    expect(leaves(tree)).toEqual([
      "tokens.color-ramp", "tokens.font-size", "tokens.line-height", "tokens.spacing", "tokens.duration", "tokens.easing",
      "tokens.surface-color", "tokens.accent-color", "tokens.typeface", "tokens.region-width",
    ]);
    expect(tokens.children?.[1]?.children?.[0]?.children?.[1]).toEqual({ id: ACTION, label: ACTION });
  });
  it("follows the placement file, not the ids: moving a leaf moves it in the tree and changes no slot", () => {
    const moved = DEMO_CATALOG.placements.map((placement) => ({
      ...placement,
      nodes: placement.nodes.map((node) => "children" in node
        ? { ...node, children: node.children.map((child) => ("leaves" in child ? { ...child, leaves: child.leaves.filter((leaf) => leaf !== RAMP) } : child)) }
        : node),
    }));
    const rehomed = moved.map((placement) => ({
      ...placement,
      nodes: placement.nodes.map((node) => node.id === "role" && "children" in node
        ? { ...node, children: node.children.map((child) => (child.id === "role-space" && "leaves" in child ? { ...child, leaves: [...child.leaves, RAMP] } : child)) }
        : node),
    }));
    const ids = (tree: ReturnType<typeof buildSlotTree>): string[] => tree.flatMap((node) => [node.id, ...(node.children ? ids(node.children as typeof tree) : [])]);
    expect(ids(buildSlotTree(rehomed))).toContain(RAMP);
    expect(nodeOptions(rehomed, RAMP).map((node) => node.id)).toEqual(["tokens/role", "tokens/role-space"]);
    expect(nodeOptions(DEMO_CATALOG.placements, RAMP).map((node) => node.id)).toEqual(["tokens/scale", "tokens/scale-color"]);
  });
  it("lists the nodes that contain a slot, outermost first, with every leaf under each", () => {
    expect(nodeOptions(DEMO_CATALOG.placements, "tokens.line-height")).toEqual([
      { id: "tokens/scale", label: "Scale", leaves: [RAMP, "tokens.font-size", "tokens.line-height", "tokens.spacing", "tokens.duration", "tokens.easing"] },
      { id: "tokens/scale-type", label: "Type", leaves: ["tokens.font-size", "tokens.line-height"] },
    ]);
    expect(nodeOptions(DEMO_CATALOG.placements, "tokens.nothing")).toEqual([]);
  });
});

describe("scopeTargets and defaultTarget", () => {
  it("lists the slot, its members, or the placement nodes that contain it", () => {
    expect(scopeTargets({ ...base, slotId: ACTION, scope: "slot" })).toEqual([ACTION]);
    expect(scopeTargets({ ...base, slotId: ACTION, scope: "member" })).toEqual([`${ACTION}.default`, `${ACTION}.hover`]);
    expect(scopeTargets({ ...base, slotId: ACTION, scope: "node" })).toEqual(["tokens/role", "tokens/role-color"]);
    expect(defaultTarget({ ...base, slotId: ACTION, scope: "node" })).toBe("tokens/role-color");
    expect(defaultTarget({ ...base, slotId: ACTION, scope: "member" })).toBe(`${ACTION}.default`);
    expect(defaultTarget({ ...base, slotId: ACTION, scope: "slot" })).toBe(ACTION);
  });
  it("derives the members of an open slot from the fills", () => {
    const open = { ...DEMO_CATALOG, slots: DEMO_CATALOG.slots.map((slot) => slot.id === RAMP ? { ...slot, contract: { ...slot.contract, members: { mode: "open" as const, pattern: "^[a-z]+\\.[0-9]+$" } } } : slot) };
    expect(scopeTargets({ catalog: open, library: DEMO_LIBRARY, slotId: RAMP, scope: "member" })).toEqual([`${RAMP}.slate.500`, `${RAMP}.violet.400`, `${RAMP}.violet.600`]);
  });
  it("has nothing to list for a draft slot with no fill, and falls back to the slot itself", () => {
    expect(scopeTargets({ ...base, slotId: "tokens.font-size", scope: "member" })).toEqual([]);
    expect(defaultTarget({ ...base, slotId: "tokens.font-size", scope: "member" })).toBe("tokens.font-size");
  });
});

describe("changesFor (a tree-node pick becomes slot picks)", () => {
  const setPick = (target: string, source: string): ChangeSet["changes"][number] => ({ op: "set", pick: { scope: "slot", target, source } });
  it("expands a node pick into one slot set per leaf the source fills, in file order", () => {
    expect(changesFor({ ...base, scope: "node", target: "tokens/scale", source: "tailwind-default" })).toEqual([setPick(RAMP, "tailwind-default"), setPick(SPACING, "tailwind-default")]);
    expect(changesFor({ ...base, scope: "node", target: "tokens/scale", source: "foundry" })).toEqual([
      setPick(RAMP, "foundry"), setPick("tokens.line-height", "foundry"), setPick(SPACING, "foundry"), setPick("tokens.duration", "foundry"), setPick("tokens.easing", "foundry"),
    ]);
    expect(changesFor({ ...base, scope: "node", target: "tokens/scale-type", source: "tailwind-default" })).toEqual([]);
  });
  it("expands a node clear into one slot clear per leaf, and never stores a node", () => {
    const clears = changesFor({ ...base, scope: "node", target: "tokens/scale-type" });
    expect(clears).toEqual([{ op: "clear", scope: "slot", target: "tokens.font-size" }, { op: "clear", scope: "slot", target: "tokens.line-height" }]);
    for (const change of [...clears, ...changesFor({ ...base, scope: "node", target: "tokens/role", source: "foundry" })]) {
      expect(change.op === "set" ? change.pick.scope : change.scope).toBe("slot");
    }
    expect(changesFor({ ...base, scope: "node", target: "tokens/nowhere", source: "foundry" })).toEqual([]);
  });
  it("leaves member and slot picks as one change each", () => {
    expect(changesFor({ ...base, scope: "slot", target: ACTION, source: "foundry" })).toEqual([setPick(ACTION, "foundry")]);
    expect(changesFor({ ...base, scope: "member", target: `${ACTION}.hover`, source: "foundry" })).toEqual([{ op: "set", pick: { scope: "member", target: `${ACTION}.hover`, source: "foundry" } }]);
    expect(changesFor({ ...base, scope: "member", target: `${ACTION}.hover` })).toEqual([{ op: "clear", scope: "member", target: `${ACTION}.hover` }]);
  });
  it("makes a change set a placement edit cannot change: only slot picks reach the selection", () => {
    const list = changesFor({ ...base, scope: "node", target: "tokens/scale", source: "tailwind-default" });
    const changes = addChanges({ base: DEMO_SELECTION, changes: none, list });
    expect(pendingCount(changes)).toBe(2);
    const working = workingSelection({ base: DEMO_SELECTION, changes });
    expect(working.picks).toEqual([setPick(RAMP, "tailwind-default"), setPick(SPACING, "tailwind-default")].map((change) => (change as { pick: Pick }).pick));
    expect(JSON.stringify(working)).not.toContain("tokens/");
  });
});

describe("buildCandidates", () => {
  it("orders cards consumer, foundry, then other sources by id", () => {
    expect(candidatesFor(ACTION).map((candidate) => candidate.source)).toEqual(["example", "foundry", "reference-kit"]);
    expect(candidatesFor(RAMP).map((candidate) => candidate.source)).toEqual(["example", "foundry", "tailwind-default"]);
    expect(candidatesFor(CONTAINER).map((candidate) => candidate.source)).toEqual(["foundry", "tailwind-default"]);
    expect(candidatesFor(CONTAINER).map((candidate) => candidate.index)).toEqual([0, 1]);
  });
  it.each(["member", "slot", "node"] as const)("each card equals resolve(applyChangeSet(...)) for the %s scope", (scope) => {
    const target = scope === "member" ? `${ACTION}.hover` : scope === "slot" ? ACTION : "tokens/role";
    for (const candidate of candidatesFor(ACTION, scope, target)) {
      if (candidate.reason === "reference") continue;
      const changes = changesFor({ ...base, scope, target, source: candidate.source });
      expect(changes.length).toBeGreaterThan(0);
      const selection = applyChangeSet(DEMO_SELECTION, { baseHash: selectionHash(DEMO_SELECTION), changes });
      const expected = Object.entries(resolve({ ...base, selection }).members).filter(([, member]) => member.slot === ACTION);
      expect(candidate.members.map(({ id, member }) => [id, member])).toEqual(expected);
      expect(Object.entries(candidate.resolved.members)).toEqual(expected);
    }
  });
  it("a node card applies the source to every leaf it fills under the node, and only stores slot picks", () => {
    const card = candidatesFor(RAMP, "node", "tokens/scale").find((candidate) => candidate.source === "tailwind-default")!;
    expect(card).toMatchObject({ usable: true, previewable: true, selected: false });
    const selection = applyChangeSet(DEMO_SELECTION, { baseHash: selectionHash(DEMO_SELECTION), changes: changesFor({ ...base, scope: "node", target: "tokens/scale", source: "tailwind-default" }) });
    expect(selection.picks.map((pick) => [pick.scope, pick.target])).toEqual([["slot", RAMP], ["slot", SPACING]]);
    const working = candidatesFor(RAMP, "node", "tokens/scale", selection).map((candidate) => [candidate.source, candidate.selected]);
    expect(working).toEqual([["example", false], ["foundry", false], ["tailwind-default", true]]);
    expect(candidatesFor(RAMP, "slot", RAMP, selection).map((candidate) => [candidate.source, candidate.selected])).toEqual([["example", false], ["foundry", false], ["tailwind-default", true]]);
    expect(candidatesFor(SPACING, "slot", SPACING, { ...DEMO_SELECTION, picks: [{ scope: "slot", target: RAMP, source: "tailwind-default" }] }).map((candidate) => candidate.selected)).toEqual([false, false]);
    expect(candidatesFor(SPACING, "node", "tokens/scale", { ...DEMO_SELECTION, picks: [{ scope: "slot", target: RAMP, source: "tailwind-default" }] }).map((candidate) => candidate.selected)).toEqual([false, false]);
  });
  it("a node card is refused when the source is unsafe on another leaf under the node", () => {
    const bad = { $type: "dimension" as const, $value: { value: 1, unit: "rem" }, $extensions: { "com.clossys.css": { raw: "1rem; }" } } };
    const catalog = { ...DEMO_CATALOG, fills: DEMO_CATALOG.fills.map((doc) => doc.$extensions["com.clossys.fill"].source === "tailwind-default" && doc.$extensions["com.clossys.fill"].slot === SPACING
      ? { ...doc, tokens: { spacing: { lg: bad, md: bad, sm: bad } } } : doc) };
    const cards = (scope: Scope, target: string) => buildCandidates({ catalog, library: DEMO_LIBRARY, working: DEMO_SELECTION, slotId: RAMP, scope, target }).find((candidate) => candidate.source === "tailwind-default")!;
    expect(cards("slot", RAMP)).toMatchObject({ usable: true, previewable: true, errors: 0 });
    expect(cards("node", "tokens/scale-color")).toMatchObject({ usable: true, previewable: true, errors: 0 });
    expect(cards("node", "tokens/scale")).toMatchObject({ usable: false, reason: "invalid", previewable: false });
    expect(cards("node", "tokens/scale").errors).toBeGreaterThan(0);
  });
  it("refuses a node pick of a reference source with the C7 reason", () => {
    const card = candidatesFor(ACTION, "node", "tokens/role-color").find((candidate) => candidate.source === "reference-kit")!;
    expect(card).toMatchObject({ usable: false, reason: "reference", previewable: true, errors: 1 });
  });
  it("shows a reference fill's own values but refuses it, with the C7 reason in its status", () => {
    const reference = candidatesFor(ACTION).find((candidate) => candidate.source === "reference-kit")!;
    expect(reference).toMatchObject({ usable: false, reason: "reference", previewable: true, errors: 1, notices: 0 });
    expect(reference.members.find(({ id }) => id === `${ACTION}.default`)?.member.css.light).toBe("#0EA5E9");
    expect(reference.findings[0]?.message).toBe(`selection: reference-kit/${ACTION} is a reference cell and cannot be selected (slot pick ${ACTION})`);
  });
  it("marks a fill with a C1 error as unusable and not previewable", () => {
    const failing = candidatesFor(CONTAINER).find((candidate) => candidate.source === "tailwind-default")!;
    expect(failing).toMatchObject({ usable: false, reason: "invalid", previewable: false, errors: 1 });
    expect(candidatesFor(CONTAINER)[0]).toMatchObject({ usable: true, previewable: true, errors: 0 });
    expect(candidatesFor(CONTAINER)[0]?.reason).toBeUndefined();
  });
  it("marks the default winner while no pick touches the slot, and the picked source after a pick", () => {
    expect(candidatesFor(ACTION).map((candidate) => [candidate.source, candidate.inUseByDefault, candidate.selected])).toEqual([
      ["example", true, false], ["foundry", false, false], ["reference-kit", false, false],
    ]);
    const working = workingSelection({ base: DEMO_SELECTION, changes: addChange({ base: DEMO_SELECTION, changes: none, change: { op: "set", pick: { scope: "slot", target: ACTION, source: "foundry" } } }) });
    expect(candidatesFor(ACTION, "slot", ACTION, working).map((candidate) => [candidate.source, candidate.inUseByDefault, candidate.selected])).toEqual([
      ["example", false, false], ["foundry", false, true], ["reference-kit", false, false],
    ]);
    expect(candidatesFor(CONTAINER).map((candidate) => candidate.inUseByDefault)).toEqual([true, false]);
  });
  it("reports notices separately from errors", () => {
    const notice = { code: "C4" as const, rule: "coverage", severity: "notice" as const, subject: ACTION, message: "coverage: slot has no fill in the default chain" };
    const engine = {
      loadCatalog: () => DEMO_CATALOG, resolve: (i: Parameters<typeof resolve>[0]) => resolve(i), emit: () => [], applyChangeSet, selectionHash,
      check: () => ({ ok: true, findings: [notice] }),
    };
    const cards = buildCandidates({ ...base, working: DEMO_SELECTION, slotId: ACTION, scope: "slot", target: ACTION, engine });
    expect(cards.map((card) => [card.errors, card.notices, card.usable])).toEqual([[0, 1, true], [0, 1, true], [0, 1, false]]);
  });
});

describe("addChange, pendingCount and workingSelection", () => {
  const set = (source: string, target = ACTION): ChangeSet["changes"][number] => ({ op: "set", pick: { scope: "slot", target, source } });
  it("counts one pending change per scope and target", () => {
    let changes = addChange({ base: DEMO_SELECTION, changes: none, change: set("foundry") });
    changes = addChange({ base: DEMO_SELECTION, changes, change: set("foundry", RAMP) });
    expect(pendingCount(changes)).toBe(2);
    changes = addChange({ base: DEMO_SELECTION, changes, change: set("example") });
    expect(changes.changes).toEqual([set("foundry", RAMP), set("example")]);
    expect(changes.baseHash).toBe(selectionHash(DEMO_SELECTION));
  });
  it("drops a change that leaves the base selection as it is", () => {
    const picked: Selection = { ...DEMO_SELECTION, picks: [{ scope: "slot", target: ACTION, source: "foundry" }] };
    const start: ChangeSet = { baseHash: selectionHash(picked), changes: [] };
    expect(pendingCount(addChange({ base: picked, changes: start, change: set("foundry") }))).toBe(0);
    expect(pendingCount(addChange({ base: picked, changes: start, change: { op: "clear", scope: "slot", target: RAMP } }))).toBe(0);
    const cleared = addChange({ base: picked, changes: start, change: { op: "clear", scope: "slot", target: ACTION } });
    expect(pendingCount(cleared)).toBe(1);
    expect(workingSelection({ base: picked, changes: cleared }).picks).toEqual([]);
    const undone = addChange({ base: picked, changes: addChange({ base: picked, changes: start, change: set("example") }), change: set("foundry") });
    expect(pendingCount(undone)).toBe(0);
  });
  it("starts from an empty change set bound to the base", () => {
    expect(emptyChanges(DEMO_SELECTION)).toEqual(none);
    expect(pendingCount(emptyChanges(DEMO_SELECTION))).toBe(0);
  });
  it("returns the base itself when nothing is pending", () => {
    expect(workingSelection({ base: DEMO_SELECTION, changes: none })).toBe(DEMO_SELECTION);
  });
});

describe("inspectorModel", () => {
  it("lists fill meta, every member with light, dark, via and alias, and the card's findings", () => {
    const card = candidatesFor(ACTION)[0]!;
    expect(inspectorModel(card)).toMatchObject({
      source: "example", fillId: `example/${ACTION}`, mode: "implementation", relation: "same-contract", license: "UNLICENSED", status: "draft", builtOn: [], findings: [],
      evidence: ["dtcg#format C1", "dtcg#alias C1", "wcag-2.2#1.4.3 C1"],
      rows: [
        { member: `${ACTION}.default`, light: "#8250DF", dark: "#A371F7", via: "slot", alias: `${RAMP}.violet.400` },
        { member: `${ACTION}.hover`, light: "#6D3FC8", dark: "#B79CF7", via: "slot" },
      ],
    });
    expect(inspectorModel(candidatesFor(RAMP)[2]!).pin).toBe("package=tailwindcss version=4.0.0");
  });
});

describe("preview renderer table (D3)", () => {
  const member = ($type: DtcgType, emit?: `--${string}`): ResolvedMember => ({
    slot: "tokens.spacing-x", source: "example", fill: "example/tokens.spacing-x", via: "default", $type,
    value: { light: 0 }, css: { light: "css-text" }, alias: {}, ...(emit ? { emit } : {}),
  });
  it.each([
    ["color", "token", "swatch"], ["fontFamily", "token", "font"], ["dimension", "token", "ruler"], ["shadow", "token", "text"], ["number", "token", "text"],
    ["fontWeight", "token", "text"], ["duration", "text", "text"], ["cubicBezier", "text", "text"],
  ] as const)("%s: bound is %s, unbound is %s", ($type, bound, unbound) => {
    expect(describePreview(member($type, "--color-accent"), 3).kind).toBe(bound);
    expect(describePreview(member($type), 3).kind).toBe(unbound);
  });
  it("names the unbound variable from the index and keeps the css text", () => {
    expect(describePreview(member("color"), 2)).toEqual({ kind: "swatch", variable: "--studio-m-2", css: "css-text" });
    expect(describePreview(member("color", "--color-accent"), 2)).toEqual({ kind: "token", property: "--color-accent" });
  });
  it("counts the index over unbound members only, in id order, as emit does", () => {
    const rows = previewRows(candidatesFor(RAMP)[0]!.members);
    expect(rows.map((row) => row.spec)).toEqual([
      { kind: "swatch", variable: "--studio-m-0", css: "#6E7781" },
      { kind: "swatch", variable: "--studio-m-1", css: "#A371F7" },
      { kind: "swatch", variable: "--studio-m-2", css: "#8250DF" },
    ]);
    const mixed = previewRows([
      { id: "a", member: member("color", "--color-accent") }, { id: "b", member: member("color") }, { id: "c", member: member("duration") },
    ]);
    expect(mixed.map((row) => row.spec.kind === "token" ? "token" : row.spec.kind === "text" ? "text" : row.spec.variable)).toEqual(["token", "--studio-m-0", "text"]);
  });
});

describe("toneOf", () => {
  it("ranks errors over notices over a clean check", () => {
    expect([toneOf(1, 2), toneOf(0, 2), toneOf(0, 0)]).toEqual(["danger", "warning", "success"]);
  });
});
