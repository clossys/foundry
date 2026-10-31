import { afterEach, describe, expect, it, vi } from "vitest";
import { completedCatalogLibrary } from "./__fixtures__/completed-catalog-library.js";
import { check, generateSelection, loadCatalog, resolve, stableStringify } from "./index.js";
import { derivationInputsHash } from "./library.js";
import { flatten, metaOf } from "./model.js";
import * as resolution from "./resolve.js";
import { checkAssetProfile } from "../catalog-assets/check.js";
import type { CatalogData, LibraryData } from "./types.js";

const catalog = loadCatalog();
const complete = completedCatalogLibrary(catalog, { id: "example-check-context", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-23");
const errors = (c: CatalogData, library: LibraryData) => check({ catalog: c, library }).findings.filter(finding => finding.severity === "error");
const tokenAt = (library: LibraryData, member: string) => flatten(library.fills.find(fill => member.startsWith(`${metaOf(fill).slot}.`))!)[member]!;
afterEach(() => vi.restoreAllMocks());

describe("fresh check invocation context", () => {
  it("resolves the actual library once while checking every saved identity derivation", () => {
    const nested = vi.spyOn(resolution, "resolve");
    const fresh = vi.spyOn(resolution, "resolveForCheck");
    const before = stableStringify(complete);
    expect(errors(catalog, complete)).toEqual([]);
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(nested).not.toHaveBeenCalled();
    expect(stableStringify(complete)).toBe(before);
  });

  it.each(["light-value", "dark-css", "extra-member"] as const)("rejects forged C5 evidence: %s", damage => {
    const supplied = structuredClone(resolve({ catalog, library: complete }));
    if (damage === "light-value") supplied.members["themes.foreground.default"]!.value.light = "#123456";
    else if (damage === "dark-css") supplied.members["themes.foreground.default"]!.css.dark = "#123456";
    else supplied.members["themes.foreground.forged"] = structuredClone(supplied.members["themes.foreground.default"]!);
    expect(check({ catalog, library: complete, resolved: supplied }).findings.some(finding => finding.code === "C5" && finding.severity === "error")).toBe(true);
  });

  it("recomputes provenance and upstream drift after the same objects are mutated", () => {
    const c = structuredClone(catalog), library = structuredClone(complete);
    expect(errors(c, library)).toEqual([]);
    const adopted = tokenAt(library, "themes.radius.default");
    const original = adopted.$value;
    adopted.$value = { value: 99, unit: "px" };
    expect(check({ catalog: c, library }).findings.some(finding => finding.code === "C10" && finding.message.includes("adopted content differs"))).toBe(true);
    adopted.$value = original;
    const origin = adopted.$extensions!["com.clossys.origin"]!;
    if (origin.kind !== "adopted") throw new Error("expected adopted radius");
    const upstream = flatten(c.fills.find(fill => metaOf(fill).id === origin.fill)!)[origin.member]!;
    upstream.$value = { value: 98, unit: "px" };
    expect(check({ catalog: c, library }).findings.some(finding => finding.code === "C10" && finding.severity === "notice" && finding.message.includes("upstream drift"))).toBe(true);
  });

  it("recomputes derived inputs and builtin output after same-object edits", () => {
    const library = structuredClone(complete);
    expect(errors(catalog, library)).toEqual([]);
    const token = tokenAt(library, "assets.favicon.vector");
    const origin = token.$extensions!["com.clossys.origin"]!;
    if (origin.kind !== "derived") throw new Error("expected derived favicon");
    origin.inputs = ["assets.mark.positive"];
    origin.inputsHash = derivationInputsHash(catalog, library, origin.inputs);
    expect(errors(catalog, library).some(finding => finding.code === "C10" && finding.message.includes("declared inputs"))).toBe(true);
    token.$value = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';
    expect(errors(catalog, library).some(finding => finding.message.includes("identity output differs"))).toBe(true);
  });

  it("keeps dark input changes stale and rechecks mutable rule registration", () => {
    const c = structuredClone(catalog), library = structuredClone(complete);
    expect(errors(c, library)).toEqual([]);
    const ink = tokenAt(library, "themes.foreground.default");
    ink.$extensions!["com.clossys.modes"]!.dark = "#eeeeee";
    library.selection = generateSelection(library);
    expect(errors(c, library).some(finding => finding.code === "C10" && finding.message.includes("stale inputsHash"))).toBe(true);
    c.rules!.find(rule => rule.id === "identity-favicon@1")!.inputs = [];
    expect(errors(c, library).some(finding => finding.code === "C10" && finding.message.includes("registry differs"))).toBe(true);
  });

  it("does not let standalone asset checks use supplied evidence to hide saved identity tampering", () => {
    const library = structuredClone(complete);
    const supplied = resolve({ catalog, library });
    tokenAt(library, "assets.favicon.vector").$value = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';
    expect(checkAssetProfile(catalog, library, { resolved: supplied }).some(finding => finding.verdict === "violated" && finding.message.includes("identity output differs"))).toBe(true);
  });
});
