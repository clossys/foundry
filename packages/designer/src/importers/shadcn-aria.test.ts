import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import shadcnSource from "../catalog/sources/shadcn@aria.json" with { type: "json" };
import { parseFill } from "../catalog-core/cell.js";
import { stableStringify } from "../catalog-core/stable.js";
import type { DtcgToken, FillDoc, Slot, Source } from "../catalog-core/types.js";
import { importShadcnAria } from "./shadcn-aria.js";

const slots = tokenSlots as unknown as readonly Slot[];
const source = shadcnSource as unknown as Source;
const here = dirname(fileURLToPath(import.meta.url));
const vendored = readFileSync(resolve(here, "vendor/shadcn-aria.css"), "utf8");
const fills = importShadcnAria({ css: vendored, source, slots });
const byId = new Map(fills.map(fill => [fill.$extensions["com.clossys.fill"].slot, fill]));

function token(slot: string, member: string): DtcgToken {
  let node: unknown = byId.get(slot)?.tokens;
  for (const segment of [slot.split(".")[1]!, ...member.split(".")]) node = (node as Record<string, unknown> | undefined)?.[segment];
  return node as DtcgToken;
}
const rootLines = (() => {
  const found: number[] = [];
  let inRoot = false;
  vendored.split("\n").forEach((text, index) => {
    if (/^:root \{/.test(text)) inRoot = true;
    else if (/^\}/.test(text)) inRoot = false;
    else if (inRoot && /^\s+--[a-z0-9-]+:/.test(text)) found.push(index + 1);
  });
  return found;
})();
function lines(node: unknown, found: number[] = []): number[] {
  if (node === null || typeof node !== "object") return found;
  const record = node as Record<string, unknown>;
  if (Object.hasOwn(record, "$value")) found.push((record.$extensions as { "com.clossys.source": { line: number } })["com.clossys.source"].line);
  else for (const child of Object.values(record)) lines(child, found);
  return found;
}
const lineOf = (name: string) => vendored.split("\n").findIndex(text => text.startsWith(`  ${name}:`)) + 1;

describe("shadcn@aria pin", () => {
  it("pins the vendored theme file by commit and bytes", () => {
    expect(createHash("sha256").update(vendored).digest("hex")).toBe(source.pin!.sha256);
    expect(vendored).toContain(source.pin!.commit!);
    expect(vendored).toContain("themes.ts sha256: 60cb5ed25f7b39d9973e2280f476dd2119a4268317f45bd7ee3cac7883db8ea0");
    expect(vendored).toContain("Permission is hereby granted, free of charge");
    expect(vendored).toContain("Copyright (c) 2023 shadcn");
    expect(source.pin).toEqual({ commit: "daaf156ee00ed91cc7e6bdd937c1b4973152d141", file: "apps/v4/registry/themes.ts", package: "shadcn", sha256: source.pin!.sha256 });
  });
});

describe("importShadcnAria", () => {
  it("matches every generated cell against its committed JSON file", async () => {
    expect(fills.map(fill => fill.$extensions["com.clossys.fill"].slot)).toEqual([
      "tokens.accent-color", "tokens.border-color", "tokens.categorical-color", "tokens.control-color", "tokens.focus-color",
      "tokens.radius", "tokens.status-color", "tokens.surface-color", "tokens.text-color",
    ]);
    for (const fill of fills) await expect(stableStringify(fill)).toMatchFileSnapshot(resolve(here, `../catalog/fills/shadcn@aria/${fill.$extensions["com.clossys.fill"].slot}.json`));
    expect(readdirSync(resolve(here, "../catalog/fills/shadcn@aria")).sort()).toEqual(fills.map(fill => fill.$extensions["com.clossys.fill"].slot + ".json"));
  });
  it("maps each theme variable to its member with typed oklch and the exact upstream text", () => {
    expect(token("tokens.surface-color", "base")).toEqual({
      $type: "color", $value: { colorSpace: "oklch", components: [1, 0, 0], alpha: 1 },
      $extensions: { "com.clossys.css": { raw: "oklch(1 0 0)" }, "com.clossys.modes": { dark: { colorSpace: "oklch", components: [0.145, 0, 0], alpha: 1 } }, "com.clossys.source": { line: lineOf("--background") } },
    });
    expect(token("tokens.text-color", "on-accent").$extensions).toMatchObject({ "com.clossys.css": { raw: "oklch(0.985 0 0)" } });
    expect(token("tokens.status-color", "danger").$value).toEqual({ colorSpace: "oklch", components: [0.577, 0.245, 27.325], alpha: 1 });
    expect(token("tokens.control-color", "tonal").$extensions).toMatchObject({ "com.clossys.css": { raw: "oklch(0.97 0 0)" } });
    expect(token("tokens.radius", "default")).toEqual({ $type: "dimension", $value: { value: 0.625, unit: "rem" }, $extensions: { "com.clossys.css": { raw: "0.625rem" }, "com.clossys.source": { line: lineOf("--radius") } } });
    expect(Object.keys((byId.get("tokens.categorical-color")!.tokens as { "categorical-color": object })["categorical-color"])).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("keeps a differing dark value as a mode, with percentage alpha as a fraction, and omits an equal one", () => {
    expect(token("tokens.border-color", "base").$extensions).toMatchObject({ "com.clossys.modes": { dark: { colorSpace: "oklch", components: [1, 0, 0], alpha: 0.1 } } });
    expect(token("tokens.border-color", "strong").$extensions).toMatchObject({ "com.clossys.modes": { dark: { alpha: 0.15 } } });
    expect(token("tokens.categorical-color", "1").$extensions).not.toHaveProperty("com.clossys.modes");
    expect(token("tokens.radius", "default").$extensions).not.toHaveProperty("com.clossys.modes");
  });
  it("records the pinned upstream on every cell", () => {
    for (const fill of fills) {
      const meta = fill.$extensions["com.clossys.fill"];
      expect(meta).toMatchObject({ source: "shadcn@aria", mode: "implementation", builtOn: [], trust: "pinned-upstream", author: "third-party", license: "MIT", status: "draft", pin: source.pin });
      expect(meta.id).toBe(`shadcn@aria/${meta.slot}`);
      expect(meta.sourceAddress.startsWith(`shadcn/${source.pin!.commit}/apps/v4/registry/themes.ts#--`)).toBe(true);
      expect(meta.conforms).toEqual(slots.find(slot => slot.id === meta.slot)!.requires);
    }
    expect(byId.get("tokens.surface-color")!.$extensions["com.clossys.fill"]).toMatchObject({ relation: "subset", sourceAddress: `shadcn/${source.pin!.commit}/apps/v4/registry/themes.ts#--background,--card,--popover,--muted,--accent` });
    expect(byId.get("tokens.radius")!.$extensions["com.clossys.fill"].relation).toBe("superset");
  });
  it("accounts for every light declaration exactly once", () => {
    const carriers = fills.filter(fill => fill.$extensions["com.clossys.fill"].unmapped !== undefined);
    expect(carriers.map(fill => fill.$extensions["com.clossys.fill"].slot)).toEqual(["tokens.accent-color"]);
    const unmapped = carriers[0]!.$extensions["com.clossys.fill"].unmapped!;
    expect(unmapped).toEqual(expect.arrayContaining(["--card-foreground", "--popover-foreground", "--secondary-foreground", "--accent-foreground", "--sidebar", "--sidebar-ring"]));
    expect(unmapped).not.toContain("--primary-foreground");
    const mapped = fills.flatMap(fill => lines(fill.tokens));
    expect([...mapped, ...unmapped.map(lineOf)].sort((a, b) => a - b)).toEqual(rootLines);
    expect(new Set([...mapped, ...unmapped.map(lineOf)]).size).toBe(rootLines.length);
  });
  it("rejects a theme missing a mapped variable and a source without a commit pin", () => {
    const missing = vendored.replace("  --ring: oklch(0.708 0 0);\n", "");
    expect(() => importShadcnAria({ css: missing, source, slots })).toThrow(new Error("importer: shadcn variable --ring is missing"));
    expect(() => importShadcnAria({ css: vendored, source: { ...source, pin: undefined }, slots })).toThrow(new Error("importer: source shadcn@aria has no package, file and commit pin"));
    expect(() => importShadcnAria({ css: vendored, source, slots: slots.filter(slot => slot.id !== "tokens.radius") })).toThrow(new Error("importer: no slot tokens.radius"));
  });
  it("parses every generated cell", () => {
    for (const fill of fills as FillDoc[]) expect(parseFill(fill).findings).toEqual([]);
  });
});
