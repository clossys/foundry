import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertCustomDistinct, checkBoardColumns, checkSourceRoster, defaultPreset, presetValues, rosterOffers, rosterStarter, sourceRoster, tokenContract,
  type RosterCheckInput, type RosterCode, type SourceRoster, type TokenContract,
} from "./token-contract.js";
import { scanContractVars } from "./token-contract-scan.js";
import type { DtcgToken } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = resolve(here, "../catalog");
const upstream = resolve(here, "../importers/__fixtures__/shadcn-aria");
const read = (path: string) => readFileSync(path, "utf8");

const slotIds = readdirSync(resolve(catalog, "slots")).filter(name => name.endsWith(".json"))
  .flatMap(name => (JSON.parse(read(resolve(catalog, "slots", name))) as { id: string }[]).map(slot => slot.id));
const fills = readdirSync(resolve(catalog, "fills")).flatMap(dir => readdirSync(resolve(catalog, "fills", dir))
  .filter(name => /^(components|assets|sections|frames|tokens)\.[a-z0-9-]+\.json$/.test(name) && name !== "components.coverage.json")
  .flatMap(name => {
    const meta = (JSON.parse(read(resolve(catalog, "fills", dir, name))) as { $extensions?: { "com.clossys.fill"?: { source: string; slot: string } } }).$extensions?.["com.clossys.fill"];
    return meta ? [{ source: meta.source, slot: meta.slot }] : [];
  }));
const upstreamTexts = readdirSync(upstream).filter(name => /^[a-z-]+\.json$/.test(name) && !name.startsWith("dep-") && !["package-source.json", "provenance.json"].includes(name))
  .flatMap(name => ((JSON.parse(read(resolve(upstream, name))) as { files?: { content: string }[] }).files ?? []).map(file => file.content))
  .concat(read(resolve(upstream, "style-nova.css")));
const preset = defaultPreset(sourceRoster);
const candidates = [...Object.keys(preset.theme.vars.light), ...Object.keys(preset.theme.vars.dark), "--sidebar-width", "--sidebar-width-icon"];
const scannedVars = scanContractVars(upstreamTexts, candidates);
const input = (patch: Partial<RosterCheckInput> = {}): RosterCheckInput => ({ contract: tokenContract, roster: sourceRoster, slots: slotIds, fills, scannedVars, ...patch });
const codes = (patch: Partial<RosterCheckInput>) => new Set(checkSourceRoster(input(patch)).map(finding => finding.code));
const clone = <T,>(value: T): T => structuredClone(value) as T;
const mutateRoster = (edit: (roster: { -readonly [K in keyof SourceRoster]: any }) => void): SourceRoster => { const roster = clone(sourceRoster) as any; edit(roster); return roster; };
const mutateContract = (edit: (contract: any) => void): TokenContract => { const contract = clone(tokenContract) as any; edit(contract); return contract; };

describe("token contract (shadcn@aria)", () => {
  it("passes R1–R6 and R9 on the shipped roster and contract", () => {
    expect(checkSourceRoster(input())).toEqual([]);
  });
  it("the scan finds the live shadcn theme and component variables", () => {
    for (const name of ["--background", "--foreground", "--primary", "--ring", "--muted-foreground", "--sidebar-accent-foreground", "--sidebar-width", "--destructive"]) expect(scannedVars, name).toContain(name);
  });
  it("has one leaf for every token slot, and every member maps to a shadcn var, Tailwind key or extension", () => {
    for (const slot of slotIds.filter(id => id.startsWith("tokens."))) expect(tokenContract.leaves[slot], slot).toBeDefined();
    const targets = Object.values(tokenContract.leaves).flatMap(leaf => Object.values(leaf.members ?? {})).filter(member => member.kind !== "moved").map(member => member.target);
    for (const target of targets) expect(target).toMatch(/^--[a-z][a-z0-9-]*$/);
  });
  it("carries the U3 leaves with Tailwind v4 defaults", () => {
    const theme = read(createRequire(import.meta.url).resolve("tailwindcss/theme.css"));
    const value = (name: string) => new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(theme)?.[1]?.trim();
    const container = tokenContract.leaves["tokens.container-width"]!;
    const animation = tokenContract.leaves["tokens.animation"]!;
    expect(container.namespace).toBe("--container-*");
    expect(animation.namespace).toBe("--animate-*");
    expect(Object.keys(container.defaults!)).toHaveLength(13);
    for (const [name, css] of Object.entries(container.defaults!)) expect(css, name).toBe(value(`--container-${name}`));
    expect(Object.keys(animation.defaults!).sort()).toEqual(["bounce", "ping", "pulse", "spin"]);
    for (const [name, css] of Object.entries(animation.defaults!)) expect(css, name).toBe(value(`--animate-${name}`));
  });
  it("records a default value for every extension, style and component member", () => {
    for (const [slot, leaf] of Object.entries(tokenContract.leaves)) for (const [name, member] of Object.entries(leaf.members ?? {})) {
      if (["extension", "style", "component"].includes(member.kind)) expect(member.default?.token.$value, `${slot}.${name}`).toBeDefined();
    }
    expect(tokenContract.leaves["tokens.scrim-color"]!.members!.default!.target).toBe("--scrim");
  });
});

describe("token presets", () => {
  it("offers shadcn-neutral (default) and shadcn-zinc, each composed with the tailwind-default namespace", () => {
    expect(sourceRoster.tokens.presets.map(entry => entry.id)).toEqual(["shadcn-neutral", "shadcn-zinc"]);
    expect(preset.id).toBe("shadcn-neutral");
    for (const entry of sourceRoster.tokens.presets) {
      expect(entry.namespace.source).toBe("tailwind-default");
      expect(entry.theme.pin.commit).toBe(tokenContract.pin.commit);
    }
  });
  it("neutral is exactly the vendored theme the shadcn@aria token fills came from", () => {
    const vendored = read(resolve(here, "../importers/vendor/shadcn-aria.css"));
    const [root, dark] = vendored.split(".dark");
    const vars = (css: string) => Object.fromEntries([...css.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map(match => [match[1], match[2]!.trim()]));
    expect(preset.theme.vars.light).toEqual(vars(root!));
    expect(preset.theme.vars.dark).toEqual(vars(dark!));
  });
  it("presetValues reads theme members from the preset and the rest from the contract default", () => {
    const zinc = sourceRoster.tokens.presets[1]!;
    expect(presetValues(tokenContract, zinc, "tokens.surface-color").base).toEqual({ light: "oklch(1 0 0)", dark: "oklch(0.141 0.005 285.823)" });
    expect(presetValues(tokenContract, preset, "tokens.region-width").sidebar).toEqual({ light: "16rem" });
  });
});

describe("R7 assertCustomDistinct", () => {
  const regionWidth = presetValues(tokenContract, preset, "tokens.region-width");
  const token = (raw: string): DtcgToken => ({ $type: "dimension", $value: raw, $extensions: { "com.clossys.css": { raw } } } as DtcgToken);
  it("an authored slot equal to the preset is an error", () => {
    const custom = Object.fromEntries(Object.entries(regionWidth).map(([name, value]) => [name, token(value.light)]));
    expect(assertCustomDistinct("tokens.region-width", custom, [{ source: preset.id, values: regionWidth }]).map(finding => finding.severity)).toEqual(["error"]);
  });
  it("one matching member is a warning; a distinct slot passes", () => {
    const custom = Object.fromEntries(Object.entries(regionWidth).map(([name, value]) => [name, token(name === "sidebar" ? value.light : "99rem")]));
    expect(assertCustomDistinct("tokens.region-width", custom, [{ source: preset.id, values: regionWidth }])).toEqual([
      expect.objectContaining({ code: "R7", severity: "warning", subject: "tokens.region-width.sidebar" }),
    ]);
    expect(assertCustomDistinct("tokens.region-width", { sidebar: token("99rem") }, [{ source: preset.id, values: regionWidth }])).toEqual([]);
  });
});

describe("source roster", () => {
  it("orders shadcn@aria first, Foundry only on gaps, Custom last", () => {
    expect(rosterOffers(sourceRoster, "components.button")).toEqual(["shadcn@aria", "custom"]);
    expect(rosterOffers(sourceRoster, "components.chart-bar")).toEqual(["shadcn-charts", "custom"]);
    expect(rosterOffers(sourceRoster, "components.chart-sparkline")).toEqual(["foundry", "custom"]);
    expect(rosterOffers(sourceRoster, "assets.favicon")).toEqual(["custom"]);
    for (const row of sourceRoster.components) for (const offer of row.offers.filter(entry => entry.source === "foundry")) expect(offer.reason).toBe("no external covers");
    expect(["assets.lockup", "assets.mark", "assets.favicon", "assets.app-icon"].map(slot => rosterStarter(sourceRoster, slot))).toEqual(Array(4).fill("identity-kit"));
    expect(rosterStarter(sourceRoster, "assets.icon-home")).toBeUndefined();
    expect(rosterStarter(sourceRoster, "components.button")).toBeUndefined();
  });
  it("R8: at most three columns, all from the roster", () => {
    expect(checkBoardColumns(sourceRoster, ["components.button", "components.toolbar"], ["shadcn@aria", "foundry", "custom"])).toEqual([]);
    expect(checkBoardColumns(sourceRoster, ["components.button"], ["shadcn@aria", "heroui-v3", "custom"]).map(finding => finding.code)).toEqual(["R8"]);
  });
});

describe("mutation proofs", () => {
  const cases: readonly [string, RosterCode, () => Partial<RosterCheckInput>][] = [
    ["a 3rd preset", "R2", () => ({ roster: mutateRoster(roster => { roster.tokens.presets.push({ ...clone(sourceRoster.tokens.presets[1]!), id: "shadcn-stone" }); }) })],
    ["a 3rd external on an L2", "R2", () => ({ roster: mutateRoster(roster => { roster.components[0].offers.push({ source: "shadcn-charts", leaves: [] }, { source: "base-ui-x", leaves: [] }); }) })],
    ["drop --ring", "R9", () => ({ contract: mutateContract(contract => { delete contract.leaves["tokens.focus-color"].members.default; }) })],
    ["a dead member without a decision", "R9", () => ({ contract: mutateContract(contract => { delete contract.leaves["tokens.region-width"].members.aside.decision; }) })],
    ["shadcn@aria offered where it ships no fill", "R3", () => ({ roster: mutateRoster(roster => { roster.components.find((row: any) => row.l2 === "actions-toolbars").offers.unshift({ source: "shadcn@aria", leaves: ["components.toolbar"] }); }) })],
    ["a preset that leaves a live key empty", "R3", () => ({ roster: mutateRoster(roster => { delete roster.tokens.presets[1].theme.vars.dark["--ring"]; }) })],
    ["Custom not last", "R4", () => ({ roster: mutateRoster(roster => { roster.custom.position = "first"; }) })],
    ["a brand row offering Foundry", "R5", () => ({ roster: mutateRoster(roster => { roster.assets.find((row: any) => row.l2 === "logo-artwork").offers.push({ source: "foundry", leaves: ["assets.mark"], reason: "no external covers" }); }) })],
    ["a brand row without its Generate starter", "R5", () => ({ roster: mutateRoster(roster => { delete roster.assets.find((row: any) => row.l2 === "app-identity-browser").starter; }) })],
    ["rac-starter offered", "R6", () => ({ roster: mutateRoster(roster => { roster.components.find((row: any) => row.l2 === "inputs-choice").offers.push({ source: "rac-starter", leaves: [] }); }) })],
    ["a slot with no roster row", "R1", () => ({ slots: [...slotIds, "components.orphan"] })],
  ];
  for (const [name, code, patch] of cases) it(`${name} → ${code}`, () => expect(codes(patch())).toContain(code));
});
