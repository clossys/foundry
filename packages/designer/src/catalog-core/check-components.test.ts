import { describe, expect, it } from "vitest";
import { checkComponentProfile, DEFAULT_COHERENCE_GROUPS, componentDescriptorDigest, componentRacInstanceMatches, componentRacRangeIncludes, componentSourceHash, componentTokensHash, isObservationPending, OBSERVATIONS_UNAVAILABLE } from "./check-components.js";
import type { ComponentCheckInput, ComponentCheckCode, ComponentCompatibilityCode } from "./check-components.js";
import { componentProfile, composedProfile } from "./__fixtures__/components/profile.js";
import { sha256 } from "./digest.js";

type Mutable<T> = { -readonly [P in keyof T]: T[P] extends readonly (infer U)[] ? Mutable<U>[] : T[P] extends object ? Mutable<T[P]> : T[P] };
function fixture(composed = false): Mutable<ComponentCheckInput> { return structuredClone(composed ? composedProfile() : componentProfile()) as Mutable<ComponentCheckInput>; }
function code(profile: ComponentCheckInput, expected: ComponentCheckCode, compatibility?: ComponentCompatibilityCode): void {
  expect(checkComponentProfile(profile).findings.some(finding => finding.code === expected && (!compatibility || finding.compatibility === compatibility))).toBe(true);
}
function source(profile: Mutable<ComponentCheckInput>, text: string): void {
  const observation = profile.observations["components.button"]!;
  observation.files[0]!.content = text; observation.sourceHash = componentSourceHash(observation.files);
}
function exactReads(profile: Mutable<ComponentCheckInput>, index = 0): void {
  profile.fills[index]!.reads.tokens = profile.fills[index]!.reads.tokens.flatMap(leaf => Object.keys(profile.tokens).filter(member => member.startsWith(`${leaf}.`)));
}
function refreshTokens(profile: Mutable<ComponentCheckInput>): void {
  for (const observation of Object.values(profile.observations)) if (observation) observation.tokensHash = componentTokensHash(profile.tokens);
}

describe("component consumer checks K1-K12", () => {
  it("passes the synthetic matrix without claiming shipped component evidence", () => {
    expect(checkComponentProfile(componentProfile())).toEqual({ ok: true, findings: [] });
    expect(checkComponentProfile(composedProfile())).toEqual({ ok: true, findings: [] });
  });
  it("K1 rejects uncovered/unknown members, missing props, partial ops and duplicate implementations", () => {
    const profile = fixture(); profile.fills[0]!.members.push("unknown"); profile.fills[0]!.props = []; delete profile.fills[0]!.propMap["size.md"];
    profile.operations = [{ op: "adopt", slot: "components.button", members: [] }]; profile.fills.push(structuredClone(profile.fills[0]!));
    code(profile, "K1"); expect(checkComponentProfile(profile).findings.filter(item => item.code === "K1")).toHaveLength(5);
  });
  it("K1 admits a subset only when required consumer members are covered", () => {
    const profile = fixture(); profile.fills[0]!.members = ["variant.primary"]; profile.fills[0]!.propMap = { "variant.primary": "variant=primary" };
    profile.requiredMembers = { "components.button": ["variant.primary"] }; expect(checkComponentProfile(profile).ok).toBe(true);
    profile.requiredMembers["components.button"]!.push("size.md"); code(profile, "K1");
  });
  it("K2 rejects radix and other engines even beside a correct RAC import", () => {
    for (const module of ["@radix-ui/react-dialog", "@base-ui/react", "sonner", "react-resizable-panels", "embla-carousel-react", "input-otp", "recharts", "@tanstack/react-table"]) {
      const profile = fixture(); source(profile, profile.observations["components.button"]!.files[0]!.content + ` import X from "${module}";`); code(profile, "K2");
    }
  });
  it("K2 requires the exact RAC import, not a comment or a native replacement", () => {
    const profile = fixture(); source(profile, '// import {Button} from "react-aria-components";\nexport const X = () => <button>Continue</button>;'); code(profile, "K2");
  });
  it("K3 rejects missing, undeclared and upward leaf reads", () => {
    const profile = fixture(); profile.fills[0]!.reads.tokens.push("sections.hero"); profile.fills[0]!.reads.assets.push("assets.icon-missing"); profile.fills[0]!.composes.push("components.missing"); code(profile, "K3");
  });
  it("K3 resolves leaves and exact registered members only", () => {
    const valid = fixture(); exactReads(valid);
    expect(checkComponentProfile(valid).findings.filter(f => f.code === "K3")).toEqual([]);
    for (const read of ["tokens", "tokens.", "tokens..primary", "tokens.text-color.", "tokens.text-color.unknown", "tokens.text-color.primary.extra", "assets.text-color.primary", "tokens.text-color.ancestor"]) {
      const profile = fixture();
      profile.tokens["tokens.text-color.ancestor.child"] = { property: "--impostor", light: "#000000" };
      profile.fills[0]!.reads.tokens = [read]; refreshTokens(profile);
      expect(checkComponentProfile(profile).findings, read).toContainEqual(expect.objectContaining({ code: "K3", message: `Token read ${read} does not resolve` }));
    }
    const emptyLeaf = fixture(); emptyLeaf.tokens = { "tokens.empty.extra.child": { property: "--impostor", light: "#000000" } }; emptyLeaf.fills[0]!.reads.tokens = ["tokens.empty"];
    expect(checkComponentProfile(emptyLeaf).findings).toContainEqual(expect.objectContaining({ code: "K3", message: "Token read tokens.empty does not resolve" }));
  });
  it("K3 checks the exact owning leaf", () => {
    const valid = fixture(); exactReads(valid);
    expect(checkComponentProfile(valid).findings.filter(f => f.code === "K3")).toEqual([]);
    for (const permission of ["tokens.focus", "tokens.focus-outline", "tokens.focus-color-extra", "tokens.focus-color.default"]) {
      const profile = fixture(); exactReads(profile);
      profile.slots[0]!.contract.allowedReads.tokens = profile.slots[0]!.contract.allowedReads.tokens.filter(leaf => leaf !== "tokens.focus-color").concat(permission);
      expect(checkComponentProfile(profile).findings, permission).toContainEqual(expect.objectContaining({ code: "K3", message: "Read tokens.focus-color.default is outside the contract" }));
    }
    const spacing = fixture(); spacing.tokens["tokens.spacing.sm"] = { property: "--space", light: "8px" }; spacing.fills[0]!.reads.tokens.push("tokens.spacing.sm");
    spacing.slots[0]!.contract.allowedReads.tokens.push("tokens.spacing-extra");
    expect(checkComponentProfile(spacing).findings).toContainEqual(expect.objectContaining({ code: "K3", message: "Read tokens.spacing.sm is outside the contract" }));
    const asset = fixture(); asset.slots[0]!.contract.allowedReads.assets = ["assets.icon"]; code(asset, "K3");
    const missing = fixture(); missing.fills[0]!.reads.components = ["components.missing"]; code(missing, "K3");
  });
  it("K4 accepts exact declared member without granting siblings", () => {
    for (const declaration of ["tokens.spacing", "tokens.spacing.sm"]) {
      const profile = fixture();
      Object.assign(profile.tokens, { "tokens.spacing.sm": { property: "--space-sm", light: "8px" }, "tokens.spacing.md": { property: "--space-md", light: "8px" } });
      profile.slots[0]!.contract.allowedReads.tokens.push("tokens.spacing");
      profile.fills[0]!.reads.tokens.push(declaration); refreshTokens(profile);
      const original = profile.observations["components.button"]!.files[0]!.content;
      profile.classBindings = { "p-sm": "tokens.spacing.sm", "p-md": "tokens.spacing.md" };
      source(profile, original + ' const cls = "p-sm"; const space = "var(--space-sm)";');
      expect(checkComponentProfile(profile).ok, declaration).toBe(true);
      for (const usage of [' const cls = "p-md";', ' const space = "var(--space-md)";']) {
        source(profile, original + usage);
        expect(checkComponentProfile(profile).findings.some(f => f.code === "K4"), declaration + usage).toBe(declaration !== "tokens.spacing");
      }
      source(profile, original + ' const cls = "p-sm";'); profile.classBindings = { "p-sm": "tokens.spacing.unknown" }; code(profile, "K4");
      delete profile.classBindings; code(profile, "K4");
    }
  });
  it("member reads bind focus and contrast without sibling authority", () => {
    const valid = fixture(); exactReads(valid); expect(checkComponentProfile(valid).ok).toBe(true);
    for (const role of ["focus", "foreground", "background"] as const) {
      const profile = fixture(); exactReads(profile);
      const original = role === "focus" ? "tokens.focus-color.default" : role === "foreground" ? "tokens.text-color.primary" : "tokens.surface-color.base";
      const sibling = original.slice(0, original.lastIndexOf(".")) + ".sibling";
      profile.tokens[sibling] = { ...profile.tokens[original]!, property: `--${role}-sibling` }; refreshTokens(profile);
      for (const measurement of profile.observations["components.button"]!.measurements) {
        if (role === "focus") measurement.focusTokens = [sibling]; else measurement.contrast[0]![role] = sibling;
      }
      code(profile, role === "focus" ? "K5" : "K6");
    }
  });
  it("mixed controls normalize declaration leaves but retain geometry and type distinctions", () => {
    const mixed = () => {
      const profile = fixture(true); profile.fills[1]!.source = "second-kit";
      profile.coherenceGroups = [{ id: "fixture-controls", slots: profile.fills.map(fill => fill.slot), kind: "controls" }];
      exactReads(profile, 1); return profile;
    };
    expect(checkComponentProfile(mixed()).findings.filter(f => f.code === "K11")).toEqual([]);
    const negatives = [
      (p: Mutable<ComponentCheckInput>) => { p.fills[1]!.reads.tokens = p.fills[1]!.reads.tokens.filter(r => !r.startsWith("tokens.control-size.")); },
      (p: Mutable<ComponentCheckInput>) => { p.fills[1]!.reads.tokens = p.fills[1]!.reads.tokens.filter(r => !r.startsWith("tokens.focus-")); },
      (p: Mutable<ComponentCheckInput>) => { p.tokens["tokens.font-size.default"] = { property: "--font", light: "16px" }; p.fills[1]!.reads.tokens = p.fills[1]!.reads.tokens.map(r => r === "tokens.body-size.default" ? "tokens.font-size.default" : r); },
      (p: Mutable<ComponentCheckInput>) => { delete p.observations["components.select"]!.geometry; },
      (p: Mutable<ComponentCheckInput>) => { p.observations["components.select"]!.geometry = { "size.md": "tokens.control-size.unknown" }; },
      (p: Mutable<ComponentCheckInput>) => { p.observations["components.select"]!.measurements = []; },
      (p: Mutable<ComponentCheckInput>) => { const o = p.observations["components.select"]!; o.files[0]!.content += 'const bad = "var(--foreign)";'; o.sourceHash = componentSourceHash(o.files); },
    ];
    for (const mutate of negatives) {
      const profile = mixed(); mutate(profile); code(profile, "K11");
      // Supplied observations that fail parity, and static read gaps, stay errors.
      expect(checkComponentProfile(profile).findings.filter(f => f.code === "K11").every(f => f.severity === "error" && !isObservationPending(f))).toBe(true);
    }
    // An unobserved member whose static reads hold is runtime-pending, not refused.
    const unobserved = mixed(); delete unobserved.observations["components.select"];
    const pendingK11 = checkComponentProfile(unobserved).findings.filter(f => f.code === "K11");
    expect(pendingK11).toEqual([{ code: "K11", rule: "K11", subject: "components.select", severity: "notice", message: `Mixed controls geometry parity: ${OBSERVATIONS_UNAVAILABLE}` }]);
    expect(pendingK11.every(isObservationPending)).toBe(true);
    // Static gaps on an unobserved member still refuse: control-size, focus and label type are read from the descriptor.
    for (const mutate of negatives.slice(0, 3)) {
      const profile = mixed(); delete profile.observations["components.select"]; mutate(profile);
      expect(checkComponentProfile(profile).findings.some(f => f.code === "K11" && f.severity === "error")).toBe(true);
    }
    const deduplicated = mixed(); deduplicated.fills[1]!.reads.tokens.push("tokens.body-size", "tokens.body-size.default");
    expect(checkComponentProfile(deduplicated).findings.filter(f => f.code === "K11")).toEqual([]);
  });
  it("K4 rejects hardcoded colours, lengths, fallback literals and unbound utilities", () => {
    for (const value of ['"#ff0000"', '"13px"', '"var(--text, 12px)"', '"h-8"', '"var(--foreign)"']) {
      const profile = fixture(); source(profile, profile.observations["components.button"]!.files[0]!.content + ` const bad = ${value};`); code(profile, "K4");
    }
  });
  it("K4 accepts a utility only with a resolved, declared token binding", () => {
    const profile = fixture(); source(profile, profile.observations["components.button"]!.files[0]!.content + ' const cls = "h-md";');
    profile.classBindings = { "h-md": "tokens.control-size.md" }; expect(checkComponentProfile(profile).ok).toBe(true);
  });
  it("K5 rejects axe, keyboard, roles, focus, forced colors and small targets independently", () => {
    const mutations = [
      (p: ReturnType<typeof fixture>) => { p.observations["components.button"]!.measurements[0]!.axeViolations = ["button-name"]; },
      (p: ReturnType<typeof fixture>) => { p.observations["components.button"]!.measurements[0]!.keyboard = []; },
      (p: ReturnType<typeof fixture>) => { p.observations["components.button"]!.measurements[0]!.roles = []; },
      (p: ReturnType<typeof fixture>) => { p.observations["components.button"]!.measurements[0]!.focusTokens = []; },
      (p: ReturnType<typeof fixture>) => { p.observations["components.button"]!.measurements[0]!.forcedColors.foreground = "transparent"; },
      (p: ReturnType<typeof fixture>) => { p.observations["components.button"]!.measurements[0]!.target.width = 12; },
    ];
    for (const mutate of mutations) { const profile = fixture(); mutate(profile); code(profile, "K5"); }
  });
  it("K5/K6 bind evidence to source and resolved consumer tokens", () => {
    for (const stale of ["source", "tokens"]) {
      const profile = fixture(); if (stale === "source") profile.observations["components.button"]!.files[0]!.content += " "; else profile.tokens["tokens.text-color.primary"]!.light = "#111111";
      code(profile, "K5"); code(profile, "K6");
    }
  });
  it("K6 recomputes contrast from consumer tokens rather than accepting a claimed ratio", () => {
    const profile = fixture(); profile.tokens["tokens.text-color.primary"]!.dark = "#222222"; profile.observations["components.button"]!.tokensHash = componentTokensHash(profile.tokens); code(profile, "K6");
  });
  it("K7 rejects text glyphs, icon SVG, foreign imports and undeclared asset glyphs", () => {
    for (const suffix of ['const icon = "✓";', 'const icon = <svg><path /></svg>;', 'import Icon from "lucide-react";', 'const icon = "assets.icon-search";']) {
      const profile = fixture(); source(profile, profile.observations["components.button"]!.files[0]!.content + suffix); code(profile, "K7");
    }
  });
  it("K7 permits declared asset ids", () => {
    const profile = fixture(); source(profile, profile.observations["components.button"]!.files[0]!.content + 'const icon = "assets.icon-close";'); expect(checkComponentProfile(profile).ok).toBe(true);
  });
  it("K7 admits classified data geometry only for one of the nine chart leaves", () => {
    const profile = fixture(); const old = profile.fills[0]!; const slot = profile.slots[0]!; const observation = profile.observations[old.slot]!;
    const text = 'export const Chart = () => <svg><path /></svg>'; const start = text.indexOf("<svg");
    profile.fills[0] = { ...old, slot: "components.chart-bar", root: "engine:none" }; profile.slots[0] = { ...slot, id: "components.chart-bar", contract: { ...slot.contract, root: "engine:none" } };
    profile.observations = { "components.chart-bar": { ...observation, root: "engine:none", files: [{ path: "chart.tsx", content: text, geometry: [{ start, end: text.length, kind: "chart-data" }] }], sourceHash: componentSourceHash([{ path: "chart.tsx", content: text }]) } };
    expect(checkComponentProfile(profile).ok).toBe(true);
    profile.fills[0]!.slot = "components.resize-handle"; profile.slots[0]!.id = "components.resize-handle"; profile.observations["components.resize-handle"] = profile.observations["components.chart-bar"]; code(profile, "K7");
  });
  it("K8 verifies source pins, notices and every dependency licence", () => {
    const profile = fixture(); const fill = profile.fills[0]!; const file = profile.observations[fill.slot]!.files[0]!;
    fill.impl = { kind: "source", entry: file.path, export: "Example" }; fill.pin = { url: "https://example.org/registry", commit: "a".repeat(40), files: [{ path: file.path, sha256: sha256(file.content) }] }; fill.notice = "MIT notice";
    profile.observations[fill.slot]!.rac.dependency = "source"; expect(checkComponentProfile(profile).ok).toBe(true);
    fill.pin.files![0]!.sha256 = "b".repeat(64); fill.deps = [{ name: "dependency", version: "1.0.0", license: "Proprietary" }]; code(profile, "K8");
    fill.notice = ""; code(profile, "K8");
  });
  it("K8 verifies upstream and rewritten output hashes independently", () => {
    const profile = fixture(); const fill = profile.fills[0]!; const observed = profile.observations[fill.slot]!;
    const original = { path: "registry/button.tsx", content: "upstream source bytes" };
    fill.impl = { kind: "source", entry: "button.tsx", export: "Example" };
    fill.pin = { url: "https://example.org/registry", commit: "a".repeat(40), files: [{ path: original.path, sha256: sha256(original.content) }] }; fill.notice = "MIT notice";
    observed.rac.dependency = "source"; observed.upstreamFiles = [original]; observed.outputSha256 = observed.files.map(file => ({ path: file.path, sha256: sha256(file.content) }));
    expect(checkComponentProfile(profile).ok).toBe(true);
    observed.outputSha256[0]!.sha256 = "b".repeat(64); code(profile, "K8");
  });
  it("K9 requires registry dependencies to be materialized or rebound", () => {
    const profile = fixture(); profile.fills[0]!.deps.push({ name: "input-group", version: "1.0.0", license: "MIT", registryItem: "input-group" }); code(profile, "K9");
    profile.fills[0]!.parts = [{ item: "input-group" }]; code(profile, "K9");
    profile.observations["components.button"]!.files.push({ path: "_parts/input-group/index.tsx", content: "export const Group = () => null;" });
    profile.observations["components.button"]!.sourceHash = componentSourceHash(profile.observations["components.button"]!.files); expect(checkComponentProfile(profile).ok).toBe(true);
  });
  it("K9 on a declared part of an unobserved fill is runtime-pending; an undeclared or unrebound dependency stays an error", () => {
    const k9 = (profile: ComponentCheckInput) => checkComponentProfile(profile).findings.filter(finding => finding.code === "K9");
    const pending = fixture(); pending.observations = {};
    pending.fills[0]!.deps.push({ name: "input-group", version: "1.0.0", license: "MIT", registryItem: "input-group" });
    pending.fills[0]!.parts = [{ item: "input-group" }];
    expect(k9(pending)).toEqual([{ code: "K9", rule: "K9", subject: "components.button", severity: "notice", message: `Registry dependency input-group: ${OBSERVATIONS_UNAVAILABLE}` }]);
    expect(k9(pending).every(isObservationPending)).toBe(true);
    expect(checkComponentProfile(pending).ok).toBe(true);
    // No declared part: no observation could ever materialize it, so it refuses unobserved too.
    const undeclared = structuredClone(pending); undeclared.fills[0]!.parts = [];
    expect(k9(undeclared)).toEqual([expect.objectContaining({ severity: "error", message: "Registry dependency input-group is neither materialized nor rebound" })]);
    // A leaf dependency that is not composed is not rebound, observed or not.
    const unbound = fixture(); unbound.observations = {};
    unbound.fills[0]!.deps.push({ name: "dialog", version: "1.0.0", license: "MIT", registryItem: "dialog", slot: "components.dialog" });
    expect(k9(unbound)).toEqual([expect.objectContaining({ severity: "error", message: "Registry dependency dialog is neither materialized nor rebound" })]);
    expect(checkComponentProfile(unbound).ok).toBe(false);
  });
  it("K9 with supplied observations that omit the declared part stays an error, never pending", () => {
    const profile = fixture(); profile.fills[0]!.deps.push({ name: "input-group", version: "1.0.0", license: "MIT", registryItem: "input-group" });
    profile.fills[0]!.parts = [{ item: "input-group" }];
    const findings = checkComponentProfile(profile).findings.filter(finding => finding.code === "K9");
    expect(findings).toEqual([expect.objectContaining({ severity: "error", message: "Registry dependency input-group is neither materialized nor rebound" })]);
    expect(findings.some(isObservationPending)).toBe(false);
  });
  it("K10 requires every declared mode, ground and state exactly once", () => {
    const profile = fixture(); profile.observations["components.button"]!.measurements.pop(); code(profile, "K10"); code(profile, "K5"); code(profile, "K6");
  });
  it("K11 requires mixed controls to share geometry, focus and label type", () => {
    const profile = fixture(true); profile.fills[1]!.source = "second-kit"; profile.coherenceGroups = [{ id: "fixture-controls", slots: profile.fills.map(fill => fill.slot), kind: "controls" }]; expect(checkComponentProfile(profile).ok).toBe(true);
    profile.fills[1]!.reads.tokens = profile.fills[1]!.reads.tokens.filter(read => read !== "tokens.control-size"); code(profile, "K11");
  });
  it("K11 prohibits mixed chart sources", () => {
    const profile = fixture(true); profile.fills[1]!.source = "second-kit"; profile.coherenceGroups = [{ id: "fixture-charts", slots: profile.fills.map(fill => fill.slot), kind: "charts" }]; code(profile, "K11");
  });
  it("missing observations are runtime-pending notices: never clearance, never an adoption refusal", () => {
    const profile = fixture(); profile.observations = {};
    const result = checkComponentProfile(profile);
    expect(result.ok).toBe(true);
    for (const expected of ["K2", "K4", "K5", "K6", "K7", "K10", "K12"] as const) {
      code(profile, expected);
      expect(result.findings).toContainEqual(expect.objectContaining({ code: expected, severity: "notice", message: OBSERVATIONS_UNAVAILABLE }));
    }
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every(isObservationPending)).toBe(true);
    // A real error beside pending notices still refuses.
    const mixed = fixture(); mixed.observations = {}; mixed.fills[0]!.license = "unknown";
    expect(checkComponentProfile(mixed).ok).toBe(false);
  });
  it("supplied observations that fail stay errors, never pending", () => {
    const profile = fixture(); profile.observations["components.button"]!.sourceHash = `sha256:${"0".repeat(64)}`;
    const result = checkComponentProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "K5", severity: "error", message: "Accessibility evidence is stale for source or consumer tokens" }));
    expect(result.findings.some(isObservationPending)).toBe(false);
    expect(isObservationPending({ code: "K5", severity: "error", message: OBSERVATIONS_UNAVAILABLE })).toBe(false);
    expect(isObservationPending({ code: "K8", severity: "notice", message: OBSERVATIONS_UNAVAILABLE })).toBe(false);
    expect(isObservationPending({ code: "K6", severity: "notice", message: `selection.range: ${OBSERVATIONS_UNAVAILABLE}` })).toBe(true);
  });
  it("produces stable findings regardless of fill order without mutating inputs", () => {
    const profile = fixture(true); profile.fills[0]!.license = "unknown"; const before = JSON.stringify(profile); const first = checkComponentProfile(profile);
    expect(JSON.stringify(profile)).toBe(before); profile.fills.reverse(); expect(checkComponentProfile(profile)).toEqual(first);
  });
});

describe("same-layer compatibility K12 CC1-CC5", () => {
  it("CC1 checks dependent prop/member coverage and observes reverse dependents on replacement", () => {
    const profile = fixture(true); profile.fills[0]!.props = []; code(profile, "K12", "CC1");
    profile.fills[0]!.props = ["children"]; profile.fills[0]!.members = profile.fills[0]!.members.filter(member => member !== "variant.primary"); code(profile, "K12", "CC1");
  });
  it("CC1 scans actual literal JSX members instead of trusting an incomplete call report", () => {
    const profile = fixture(true); const observed = profile.observations["components.select"]!;
    observed.files[0]!.content = observed.files[0]!.content.replace("<Button>", '<Button variant="quiet">'); observed.sourceHash = componentSourceHash(observed.files);
    code(profile, "K12", "CC1");
  });
  it("CC2 rejects a changed context root or lost ref or render-prop forwarding", () => {
    for (const field of ["root", "forwardsRef", "forwardsRenderProps"] as const) {
      const profile = fixture(true); const observed = profile.observations["components.button"]!;
      if (field === "root") observed.root = "presentational"; else observed[field] = false; code(profile, "K12", "CC2");
    }
  });
  it("CC3 rejects a disjoint range, bundled RAC and a second install", () => {
    for (const issue of ["range", "instance", "peer", "bundled"] as const) {
      const profile = fixture(true); if (issue === "range") profile.fills[0]!.rac!.range = "^2.0.0"; else if (issue === "instance") profile.observations["components.button"]!.rac.instance = "private-rac"; else if (issue === "peer") profile.fills[0]!.rac!.peer = false; else profile.observations["components.button"]!.rac.dependency = "bundled";
      code(profile, "K12", "CC3");
    }
  });
  it("CC3 binds a package-named descriptor only to that package's own resolved install", () => {
    const installed = "/consumer/app/node_modules/react-aria-components";
    expect(componentRacInstanceMatches("react-aria-components", installed)).toBe(true);
    expect(componentRacInstanceMatches("react-aria-components", "node_modules/react-aria-components")).toBe(true);
    expect(componentRacInstanceMatches(installed, installed)).toBe(true);
    for (const [declared, actual] of [["react-aria-components", "/consumer/app/node_modules/react-aria-components-fork"], ["react-aria-components", "/consumer/app/node_modules/kit/react-aria-components"],
      ["react-aria-components", "/consumer/app/vendor/react-aria-components"], ["react-aria-components", ""], ["", installed], ["consumer-rac", installed], ["/other/node_modules/react-aria-components", installed]]) expect(componentRacInstanceMatches(declared!, actual!), `${declared} -> ${actual}`).toBe(false);
    const profile = fixture(true);
    for (const observation of Object.values(profile.observations)) observation!.rac.instance = installed;
    profile.installedRac.instance = installed;
    for (const fill of profile.fills) fill.rac!.instance = "react-aria-components";
    expect(checkComponentProfile(profile).findings.filter(finding => finding.compatibility === "CC3")).toEqual([]);
    profile.fills[0]!.rac!.instance = "react-aria-components-fork"; code(profile, "K12", "CC3");
    const observed = fixture(true); observed.installedRac.instance = installed; for (const fill of observed.fills) fill.rac!.instance = "react-aria-components";
    code(observed, "K12", "CC3");
  });
  it("K5/K6 refuse runtime evidence measured for a different descriptor", () => {
    const profile = fixture();
    profile.observations["components.button"]!.descriptorHash = componentDescriptorDigest(profile.fills[0]!);
    expect(checkComponentProfile(profile)).toEqual({ ok: true, findings: [] });
    profile.observations["components.button"]!.descriptorHash = sha256("another descriptor");
    code(profile, "K5"); code(profile, "K6");
    const edited = fixture(); edited.observations["components.button"]!.descriptorHash = componentDescriptorDigest(edited.fills[0]!);
    edited.fills[0]!.props = [...edited.fills[0]!.props, "aria-label"]; code(edited, "K5");
    const given = fixture(); given.observations["components.button"]!.descriptorHash = componentDescriptorDigest(given.fills[0]!);
    given.descriptorHashes = { "components.button": sha256("rewritten before check") }; code(given, "K6");
  });
  it("CC4 rejects a leaf retained as a private registry part", () => {
    const profile = fixture(true); profile.fills[1]!.parts = [{ item: "button" }]; code(profile, "K12", "CC4");
  });
  it("CC5 and K3 reject composes cycles and reads-only cycles", () => {
    for (const composed of [true, false]) {
      const profile = fixture(true); profile.fills[0]!.reads.components = ["components.select"]; if (composed) profile.fills[0]!.composes = ["components.select"];
      code(profile, "K3"); code(profile, "K12", "CC5");
    }
  });
  it("CC2 infers Select context when a supplied call omits it", () => {
    const profile = fixture(true); delete profile.observations["components.select"]!.calls[0]!.contextRoot; profile.observations["components.button"]!.forwardsRef = false; code(profile, "K12", "CC2");
  });
  it("all five CC checks admit the passing graph", () => {
    const result = checkComponentProfile(composedProfile()); expect(result.findings.filter(item => item.compatibility)).toEqual([]);
  });
});

describe("RAC range boundary", () => {
  it.each([["^1.19.0", "1.21.1", true], ["^1.19.0", "2.0.0", false], ["^0.2.1", "0.3.0", false], ["^0.0.1", "0.0.2", false], [">=1.19.0 <2.0.0", "1.21.1", true], ["~1.21.0", "1.22.0", false], ["*", "1.21.1", false], ["^1.0.0", "1.21.1-beta", false]] as const)("%s includes %s = %s", (range, version, expected) => expect(componentRacRangeIncludes(range, version)).toBe(expected));
});

describe("member-specific root observations", () => {
  function members() {
    const input = fixture(); const observation = input.observations["components.button"]!;
    input.slots[0]!.contract.memberRoots = { "variant.primary": "rac:Button", "size.md": "rac:Button" };
    observation.memberObservations = Object.fromEntries(["variant.primary", "size.md"].map(member => [member, {
      root: observation.root, forwardsRef: true, forwardsRenderProps: true,
      calls: [], measurements: structuredClone(observation.measurements),
    }]));
    return input;
  }
  it("checks each mapped member while retaining the common byte/token domains", () => {
    expect(checkComponentProfile(members()).ok).toBe(true);
    const input = members(); input.observations["components.button"]!.memberObservations!["size.md"]!.root = "rac:DateRangePicker";
    code(input, "K2");
  });
  it("rejects missing/unknown members, missing member measurements and lost ref evidence", () => {
    for (const mutate of [
      (p: ReturnType<typeof members>) => { delete p.observations["components.button"]!.memberObservations!["size.md"]; },
      (p: ReturnType<typeof members>) => { p.observations["components.button"]!.memberObservations!.unknown = p.observations["components.button"]!.memberObservations!["size.md"]!; },
      (p: ReturnType<typeof members>) => { p.observations["components.button"]!.memberObservations!["size.md"]!.measurements.pop(); },
      (p: ReturnType<typeof members>) => { p.observations["components.button"]!.memberObservations!["size.md"]!.forwardsRef = false; },
    ]) { const input = members(); mutate(input); expect(checkComponentProfile(input).ok).toBe(false); }
  });
});

describe("controls coherence group membership", () => {
  it("holds neither the form container nor the field wrapper, which render no control geometry of their own", () => {
    const controls = DEFAULT_COHERENCE_GROUPS.find(group => group.id === "controls")!;
    expect(controls.slots).toContain("components.text-field");
    expect(controls.slots).not.toContain("components.form");
    // Field renders only a label, description and error around a caller-supplied control: no control height or focus of its own.
    expect(controls.slots).not.toContain("components.field");
  });
  it("still compares label type leaves across the remaining labelled controls once field leaves", () => {
    const controls = DEFAULT_COHERENCE_GROUPS.find(group => group.id === "controls")!;
    expect(controls.slots).toEqual(expect.arrayContaining(["components.text-field", "components.search-field", "components.date-field", "components.number-field", "components.select", "components.combo-box"]));
  });
});

describe("controls label type parity", () => {
  const mixed = () => {
    const profile = fixture(true); profile.fills[1]!.source = "second-kit";
    profile.coherenceGroups = [{ id: "fixture-controls", slots: profile.fills.map(fill => fill.slot), kind: "controls" }];
    exactReads(profile, 1); return profile;
  };
  const labelFinding = (profile: ComponentCheckInput) => checkComponentProfile(profile).findings.some(f => f.code === "K11" && f.subject === "fixture-controls");
  it("excludes a member that binds no label type read from the label comparison, not from size/focus parity", () => {
    const profile = mixed();
    profile.fills[1]!.reads.tokens = profile.fills[1]!.reads.tokens.filter(r => !/(?:body-size|caption-size|typeface|font-size)(?:\.|$)/.test(r));
    expect(labelFinding(profile)).toBe(false);
    profile.fills[1]!.reads.tokens = profile.fills[1]!.reads.tokens.filter(r => !r.startsWith("tokens.control-size"));
    expect(checkComponentProfile(profile).findings.some(f => f.code === "K11" && f.subject === profile.fills[1]!.slot && f.severity === "error")).toBe(true);
  });
  it("still fails two members that bind different nonempty label type sets", () => {
    const profile = mixed();
    profile.tokens["tokens.caption-size.default"] = { property: "--caption", light: "12px" };
    profile.fills[1]!.reads.tokens = profile.fills[1]!.reads.tokens.map(r => r === "tokens.body-size.default" ? "tokens.caption-size.default" : r);
    expect(labelFinding(profile)).toBe(true);
  });
});
