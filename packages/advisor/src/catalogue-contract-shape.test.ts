import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Build-time tools from this repository, not shipped code: the same
// catalogue builder, packer and offering-kits gate the repository runs.
// They are untyped .mjs files; test files are outside `tsc`'s scope and
// vitest only transpiles, so they need no type directive here.
import * as repositoryCatalogue from "../../../scripts/lib/capability-catalogue.mjs";
import { evaluateOfferingKits } from "../../../scripts/check-offering-kits.mjs";
import { GENERATED_MODULE_PATH, renderOfferingModule } from "../scripts/pack-capability-catalogue.mjs";
import { composeKit, judgeNeedsCycles } from "./composition.js";
import { recommendKit } from "./kit-verdicts.js";
import type { CapabilityCatalogue } from "./capability-catalogue.js";
import type { KitPreset } from "./kit-presets.js";

/**
 * End to end, PR #1398's blocker and its review on #1403: the five v0
 * launch roles (customer, writer, designer, publisher, strategist) declare
 * contract-shaped `needs`/`solves` in their own package.json (#1172). These
 * tests build this repository's real catalogue, in memory, and check that it
 * packs, typechecks, passes the offering-kits gate, recommends the launch
 * kit, and composes the same way here as in the repository's gate.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const LAUNCH_LANES = ["customer", "writer", "designer", "publisher", "strategist"] as const;
const realManifests = repositoryCatalogue.collectPackageManifests(repoRoot) as Map<string, { foundry?: Record<string, unknown> }>;
/** Each launch role's own declared `foundry` block, read from its real package.json. */
const lanes = Object.fromEntries(
  LAUNCH_LANES.map((role) => [role, { foundry: structuredClone(realManifests.get(role)!.foundry!) as Record<string, unknown> & { solves: { problem: string; evidence: string }[] } }]),
) as Record<(typeof LAUNCH_LANES)[number], { foundry: Record<string, unknown> & { solves: { problem: string; evidence: string }[] } }>;
const presetsContract = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/kit-presets.json"), "utf8"));
const presets = presetsContract.presets as KitPreset[];
const launch = presets.find((preset) => preset.id === "launch")!;

type Foundry = Record<string, unknown> & { capabilities?: { id: string; inputs: unknown[] }[]; needs?: unknown[] };
type Patch = (foundry: Foundry) => Foundry;

/** The real manifests, unpatched: every launch role's values are its own declaration. */
const ALL_LANES: Record<string, Patch> = {};

/**
 * Two needs #1401 prepared on Designer that Designer does not feed:
 * `components-and-blocks` reaches Publisher as a package import, and
 * `logo-and-identity-files` is `planned`. The real manifest omits both; this
 * negative control puts them back.
 */
const UNFED_PUBLISHER_NEEDS = [
  { producerRole: "@clossys/designer", artifact: "components-and-blocks" },
  { producerRole: "@clossys/designer", artifact: "logo-and-identity-files" },
];

function allLanesWith(extra: Record<string, Patch> = {}): Record<string, Patch> {
  const patches = { ...ALL_LANES };
  for (const [role, patch] of Object.entries(extra)) {
    const base = patches[role] ?? ((foundry: Foundry) => foundry);
    patches[role] = (foundry) => patch(base(foundry));
  }
  return patches;
}

function catalogueWith(patches: Record<string, Patch>): CapabilityCatalogue {
  const manifests = repositoryCatalogue.collectPackageManifests(repoRoot) as Map<string, { foundry?: Foundry }>;
  for (const [directory, patch] of Object.entries(patches)) {
    const manifest = manifests.get(directory)!;
    manifests.set(directory, { ...manifest, foundry: patch(structuredClone(manifest.foundry ?? {})) });
  }
  return repositoryCatalogue.buildCapabilityCatalogue(repoRoot, { manifests }) as CapabilityCatalogue;
}

const publisherSurfacesWaitOnKeep: Patch = (foundry) => {
  const surfaces = foundry.capabilities!.find((capability) => capability.id === "surface-documents")!;
  surfaces.inputs = [...surfaces.inputs, { producerRole: "@clossys/customer", artifact: "keep-verdict" }];
  return foundry;
};

/** #1401's full prepared `needs`, including the two Designer does not feed. */
const publisherUncorrected: Patch = (foundry) => ({ ...foundry, needs: [...(foundry.needs ?? []), ...UNFED_PUBLISHER_NEEDS] });

/** Review of #1403 (B1): Publisher declares `doc` twice; the capability behind the FIRST path waits on Customer's keep. */
const duplicateFeedDeadlock: Record<string, Patch> = {
  customer: () => ({
    needs: [{ producerRole: "@clossys/publisher", artifact: "doc" }],
    feeds: [{ artifact: "keep", path: "clossys/customer/keep.json" }],
    capabilities: [{ id: "keep", inputs: [{ producerRole: "@clossys/publisher", artifact: "doc" }], outputs: ["clossys/customer/keep.json"] }],
  }),
  publisher: () => ({
    needs: [{ producerRole: "@clossys/customer", artifact: "keep" }],
    feeds: [
      { artifact: "doc", path: "clossys/publisher/p1.json" },
      { artifact: "doc", path: "clossys/publisher/p2.json" },
    ],
    capabilities: [
      { id: "one", inputs: [{ producerRole: "@clossys/customer", artifact: "keep" }], outputs: ["clossys/publisher/p1.json"] },
      { id: "two", inputs: [], outputs: ["clossys/publisher/p2.json"] },
    ],
  }),
};

/** A summary `needs` entry naming Publisher's sealing, which no Customer capability's `inputs` covers: every Customer capability waits on it (review of #1403, F1). */
const customerNeedsSealing: Patch = (foundry) => ({ ...foundry, needs: [...(foundry.needs ?? []), { producerRole: "@clossys/publisher", artifact: "sealing-and-the-publication-record" }] });

/** An input that resolves ONLY by capability id -- no `feeds`, no top-level `needs` -- closes a deadlock (review of #1403, F1). */
const idOnlyDeadlock: Record<string, Patch> = {
  customer: () => ({ needs: [], capabilities: [{ id: "keep", inputs: [{ producerRole: "@clossys/publisher", artifact: "one" }], outputs: ["clossys/customer/keep.json"] }] }),
  publisher: () => ({ needs: [], capabilities: [{ id: "one", inputs: [{ producerRole: "@clossys/customer", artifact: "keep" }], outputs: ["clossys/publisher/one.json"] }] }),
};

/** A summary need covered only because it resolves to the same node as an input: no deadlock (review of #1403, N1). */
const coveredByResolution = allLanesWith({
  customer: (foundry) => ({
    ...foundry,
    needs: (foundry.needs as { artifact: string }[]).map((need) => (need.artifact === "surface-documents" ? { ...need, artifact: "surfaces-alias" } : need)),
  }),
  publisher: (foundry) => {
    foundry.feeds = [...(foundry.feeds as unknown[]), { artifact: "surfaces-alias", path: "clossys/publisher/surfaces/" }];
    const surfaces = foundry.capabilities!.find((capability) => capability.id === "surface-documents")!;
    surfaces.inputs = [...surfaces.inputs, { producerRole: "@clossys/customer", artifact: "lived-feedback" }];
    return foundry;
  },
});

/** A role loop closed by Influencer's fallback need on Publisher, which names no Publisher capability (review of #1403, F2). */
const fallbackClosedLoop = allLanesWith({
  publisher: (foundry) => {
    const surfaces = foundry.capabilities!.find((capability) => capability.id === "surface-documents")!;
    surfaces.inputs = [...surfaces.inputs, { producerRole: "@clossys/influencer", artifact: "reach-report" }];
    return { ...foundry, needs: [...(foundry.needs ?? []), { producerRole: "@clossys/influencer", artifact: "reach-report" }] };
  },
  influencer: (foundry) => ({ ...foundry, feeds: [{ artifact: "reach-report", path: "clossys/influencer/reach.json" }] }),
});

/** The selected roles plus every role their `needs` reach: the kit's full role set, even when composition comes back indeterminate. */
function closureOf(selectedRoles: readonly string[], catalogue: CapabilityCatalogue): string[] {
  const byRole = new Map(catalogue.roles.map((role) => [role.role, role]));
  const seen = new Set<string>();
  const queue = selectedRoles.filter((role) => byRole.has(role));
  while (queue.length > 0) {
    const role = queue.shift()!;
    if (seen.has(role)) continue;
    seen.add(role);
    for (const need of byRole.get(role)!.needs) if (need.role && byRole.has(need.role)) queue.push(need.role);
  }
  return [...seen].sort();
}

/** Typechecks a rendered generated module against this package's own types, served in memory in place of the file `npm run build` writes. */
function typecheckGeneratedModule(source: string): string[] {
  const configPath = join(here, "..", "tsconfig.json");
  const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, dirname(configPath));
  const options = { ...config.options, noEmit: true };
  const host = ts.createCompilerHost(options);
  const target = ts.sys.resolvePath(GENERATED_MODULE_PATH);
  const isTarget = (fileName: string) => ts.sys.resolvePath(fileName) === target;
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    isTarget(fileName) ? ts.createSourceFile(fileName, source, languageVersion, true) : getSourceFile(fileName, languageVersion, ...rest);
  host.fileExists = (fileName) => isTarget(fileName) || fileExists(fileName);
  host.readFile = (fileName) => (isTarget(fileName) ? source : readFile(fileName));
  const program = ts.createProgram([GENERATED_MODULE_PATH, join(here, "index.ts")], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
}

function render(catalogue: CapabilityCatalogue): string {
  return renderOfferingModule({ catalogue, presets, clientProblems: repositoryCatalogue.loadClientProblems(repoRoot) });
}

describe("the five launch roles' declared contract-shaped values, end to end", () => {
  it("pack into a module that typechecks against this package's own types", () => {
    const catalogue = catalogueWith(ALL_LANES);
    for (const [role, lane] of Object.entries(lanes)) {
      expect(catalogue.roles.find((entry) => entry.role === role)!.solves).toEqual(lane.foundry.solves);
    }
    expect(typecheckGeneratedModule(render(catalogue))).toEqual([]);
  }, 60_000);

  it("the typecheck is a real control: a non-contract field forced into the data fails it the way #1398's build did", () => {
    const catalogue = structuredClone(catalogueWith(ALL_LANES)) as unknown as { roles: { role: string; solves: Record<string, unknown>[] }[] };
    catalogue.roles.find((role) => role.role === "customer")!.solves[0]!.notAContractField = "x";
    const diagnostics = typecheckGeneratedModule(render(catalogue as unknown as CapabilityCatalogue));
    expect(diagnostics.some((diagnostic) => diagnostic.startsWith("TS2353") && diagnostic.includes("notAContractField"))).toBe(true);
  }, 60_000);

  it("pass the offering-kits gate with no finding and no warning", () => {
    const result = evaluateOfferingKits({ contract: presetsContract, catalogue: catalogueWith(ALL_LANES) });
    expect(result.findings).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("compose launch to exactly its five roles, with the Customer<->Publisher loop judged legitimate (issue #1382)", () => {
    const catalogue = catalogueWith(ALL_LANES);
    const composed = composeKit({ selectedRoles: launch.roles, catalogue });
    expect(composed.state).toBe("composed");
    if (composed.state !== "composed") return;
    expect([...composed.sequence].sort()).toEqual([...launch.roles].sort());
    expect(composed.unsatisfiedNeeds).toEqual([]);
    expect(composed.roleCycles).toEqual([["customer", "publisher", "customer"]]);
    expect(composed.unjudgedCycle).toBeNull();
    expect(judgeNeedsCycles({ roleNames: composed.sequence, catalogue })).toEqual({ capabilityCycle: null, unjudgedCycle: null });
  });

  it("recommend the launch preset from the five launch problems, citing each lane's own claim", () => {
    const catalogue = catalogueWith(ALL_LANES);
    const confirmedProblems = Object.values(lanes).map((lane, index) => ({ id: lane.foundry.solves[0]!.problem, ...(index === 0 ? { primary: true } : {}) }));
    const verdict = recommendKit({ confirmedProblems, catalogue, problem: launch.problem, presets });
    expect(verdict.state).toBe("recommended");
    expect(verdict.presetId).toBe("launch");
    expect(verdict.unjudgedCycle).toBeNull();
    expect(verdict.roleCycles).toEqual([["customer", "publisher", "customer"]]);
    for (const [role, lane] of Object.entries(lanes)) {
      const cited = verdict.roles.find((entry) => entry.role === role)!.citations;
      expect(cited.map((citation) => citation.evidence)).toEqual(lane.foundry.solves.map((entry) => entry.evidence));
    }
  });
});

describe("the shipped composition agrees with this repository's gate", () => {
  const variants: Record<string, Record<string, Patch>> = {
    "all five lanes": ALL_LANES,
    "plus a Publisher capability that waits on the keep (deadlock)": allLanesWith({ publisher: publisherSurfacesWaitOnKeep }),
    "with #1401's two needs Designer does not feed (unmet)": allLanesWith({ publisher: publisherUncorrected }),
    "a producer that declares one artifact twice (review of #1403, B1)": duplicateFeedDeadlock,
    "an uncovered summary need (deadlock, review of #1403, F1)": allLanesWith({ customer: customerNeedsSealing }),
    "an input resolved only by capability id (deadlock, review of #1403, F1)": idOnlyDeadlock,
    "a summary need covered by resolving to the same node (no deadlock, review of #1403, N1)": coveredByResolution,
    "a role loop closed by a fallback need (unjudged, review of #1403, F2)": fallbackClosedLoop,
  };

  // Every variant must actually exercise its rule, or the parity check above it is vacuous.
  const expectedLaunch: Record<string, string> = {
    "all five lanes": "composed",
    "plus a Publisher capability that waits on the keep (deadlock)": "indeterminate",
    "with #1401's two needs Designer does not feed (unmet)": "composed",
    "a producer that declares one artifact twice (review of #1403, B1)": "indeterminate",
    "an uncovered summary need (deadlock, review of #1403, F1)": "indeterminate",
    "an input resolved only by capability id (deadlock, review of #1403, F1)": "indeterminate",
    "a summary need covered by resolving to the same node (no deadlock, review of #1403, N1)": "composed",
    "a role loop closed by a fallback need (unjudged, review of #1403, F2)": "composed",
  };

  for (const [label, patches] of Object.entries(variants)) {
    it(`on every preset and on each launch role alone: ${label}`, () => {
      const catalogue = catalogueWith(patches);
      const selections = [...presets.map((preset) => preset.roles), ...launch.roles.map((role) => [role])];
      const selectedLaunch = composeKit({ selectedRoles: launch.roles, catalogue });
      expect(selectedLaunch.state).toBe(expectedLaunch[label]);
      for (const selectedRoles of selections) {
        const shipped = composeKit({ selectedRoles, catalogue });
        const gate = repositoryCatalogue.composeKit({ selectedRoles, catalogue });
        // Over the kit's FULL role set: `gate.sequence` is empty whenever the gate's result is indeterminate.
        const roleNames = closureOf(selectedRoles, catalogue);
        expect(judgeNeedsCycles({ roleNames, catalogue })).toEqual(repositoryCatalogue.judgeNeedsCycles({ roleNames, catalogue }));
        if (shipped.state === "composed") {
          const { context: _context, ...gateComposed } = gate;
          expect(shipped).toEqual(gateComposed);
        } else {
          expect(gate.state).toBe("indeterminate");
          expect(shipped.reason).toBe(gate.reason);
        }
      }
    });
  }

  it("resolves a twice-declared artifact through its first declared entry: a deadlock, as the gate reports", () => {
    const composed = composeKit({ selectedRoles: ["customer"], catalogue: catalogueWith(duplicateFeedDeadlock) });
    expect(composed.state).toBe("indeterminate");
    if (composed.state === "indeterminate") expect(composed.reason).toContain("customer#keep -> publisher#one -> customer#keep");
  });

  it("rejects an uncovered summary need and an id-only input deadlock, as the gate does", () => {
    const sealing = composeKit({ selectedRoles: launch.roles, catalogue: catalogueWith(allLanesWith({ customer: customerNeedsSealing })) });
    expect(sealing.state).toBe("indeterminate");
    if (sealing.state === "indeterminate") expect(sealing.reason).toContain("publisher#sealing-and-the-publication-record -> customer#keep-verdict");
    const idOnly = composeKit({ selectedRoles: ["customer", "publisher"], catalogue: catalogueWith(idOnlyDeadlock) });
    expect(idOnly.state).toBe("indeterminate");
    if (idOnly.state === "indeterminate") expect(idOnly.reason).toContain("customer#keep -> publisher#one -> customer#keep");
  });

  it("does not invent a deadlock for a summary need that resolves to the same node as an input", () => {
    const covered = composeKit({ selectedRoles: launch.roles, catalogue: catalogueWith(coveredByResolution) });
    expect(covered.state).toBe("composed");
  });

  it("reports the grow preset's fallback-closed loop as unjudged, carried to the verdict (review of #1403, F2)", () => {
    const catalogue = catalogueWith(fallbackClosedLoop);
    const grow = composeKit({ selectedRoles: presets.find((preset) => preset.id === "grow")!.roles, catalogue });
    expect(grow.state).toBe("composed");
    if (grow.state === "composed") expect(grow.unjudgedCycle).toEqual(["influencer", "publisher", "influencer"]);
    const verdict = recommendKit({ confirmedProblems: [{ id: "influencer-audience-response", primary: true }], catalogue, problem: "Get it in front of people.", overCapReason: "grow" });
    expect(verdict.unjudgedCycle).toEqual(["influencer", "publisher", "influencer"]);
  });

  it("reports a need whose producer does not feed the artifact as unmet, as the framework gate does", () => {
    const composed = composeKit({ selectedRoles: ["publisher"], catalogue: catalogueWith(allLanesWith({ publisher: publisherUncorrected })) });
    expect(composed.state).toBe("composed");
    if (composed.state === "composed") {
      expect(composed.unsatisfiedNeeds.map((need) => need.artifact).sort()).toEqual(["components-and-blocks", "logo-and-identity-files"]);
    }
  });
});
