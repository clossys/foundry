import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Build-time tools from this repository, not shipped code: the same
// catalogue builder and packer `npm run build` runs.
// @ts-expect-error -- untyped repository script, imported by this test only
import * as repositoryCatalogue from "../../../scripts/lib/capability-catalogue.mjs";
// @ts-expect-error -- untyped build script, imported by this test only
import { GENERATED_MODULE_PATH, renderOfferingModule } from "../scripts/pack-capability-catalogue.mjs";
import { composeKit, judgeNeedsCycles } from "./composition.js";
import type { CapabilityCatalogue } from "./capability-catalogue.js";

/**
 * PR #1398's blocker: a package declaring `needs`/`solves` in exactly the
 * package-framework contract's shape broke this package's build. These
 * tests build this repository's real catalogue with Customer's prepared
 * contract-shaped values overlaid (scripts/fixtures/
 * customer-contract-needs-solves.json), in memory, and check that it packs,
 * typechecks, and composes the same way here as in the repository's gate.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const fixture = JSON.parse(readFileSync(join(repoRoot, "scripts/fixtures/customer-contract-needs-solves.json"), "utf8"));
const presets = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/kit-presets.json"), "utf8")).presets as { id: string; roles: string[] }[];

type Foundry = Record<string, unknown> & { capabilities?: { id: string; inputs: unknown[] }[] };
type Patch = (foundry: Foundry) => Foundry;

function catalogueWith(patches: Record<string, Patch>): CapabilityCatalogue {
  const manifests = repositoryCatalogue.collectPackageManifests(repoRoot) as Map<string, { foundry?: Foundry }>;
  for (const [directory, patch] of Object.entries(patches)) {
    const manifest = manifests.get(directory)!;
    manifests.set(directory, { ...manifest, foundry: patch(structuredClone(manifest.foundry ?? {})) });
  }
  return repositoryCatalogue.buildCapabilityCatalogue(repoRoot, { manifests }) as CapabilityCatalogue;
}

const withCustomerFixture: Patch = (foundry) => ({ ...foundry, ...structuredClone(fixture.foundry) });
const publisherSurfacesWaitOnKeep: Patch = (foundry) => {
  const surfaces = foundry.capabilities!.find((capability) => capability.id === "surface-documents")!;
  surfaces.inputs = [...surfaces.inputs, { producerRole: "@clossys/customer", artifact: "keep-verdict" }];
  return foundry;
};

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
  const program = ts.createProgram([GENERATED_MODULE_PATH, join(here, "capability-catalogue.ts")], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
}

function render(catalogue: CapabilityCatalogue): string {
  return renderOfferingModule({ catalogue, presets, clientProblems: repositoryCatalogue.loadClientProblems(repoRoot) });
}

describe("a contract-shaped catalogue packs and typechecks", () => {
  it("builds and typechecks with Customer's `qualified` solves (statement, capability) and producerRole needs", () => {
    const catalogue = catalogueWith({ customer: withCustomerFixture });
    const customer = catalogue.roles.find((role) => role.role === "customer")!;
    expect(customer.solves).toEqual(fixture.foundry.solves);
    expect(customer.solves[0]!.evidence).toBe("qualified");
    expect(customer.needs.map((need) => need.producerRole)).toEqual(["@clossys/publisher", "@clossys/strategist"]);
    expect(typecheckGeneratedModule(render(catalogue))).toEqual([]);
  }, 60_000);

  it("the typecheck is a real control: a non-contract field forced into the data fails it the way #1398's build did", () => {
    const catalogue = structuredClone(catalogueWith({ customer: withCustomerFixture })) as unknown as { roles: { role: string; solves: Record<string, unknown>[] }[] };
    catalogue.roles.find((role) => role.role === "customer")!.solves[0]!.notAContractField = "x";
    const diagnostics = typecheckGeneratedModule(render(catalogue as unknown as CapabilityCatalogue));
    expect(diagnostics.some((diagnostic) => diagnostic.startsWith("TS2353") && diagnostic.includes("notAContractField"))).toBe(true);
  }, 60_000);
});

describe("composition agrees with this repository's gate on the contract-shaped catalogue", () => {
  const variants: Record<string, Record<string, Patch>> = {
    "Customer's contract fields": { customer: withCustomerFixture },
    "plus a Publisher capability that waits on the keep (deadlock)": { customer: withCustomerFixture, publisher: publisherSurfacesWaitOnKeep },
  };

  for (const [label, patches] of Object.entries(variants)) {
    it(`matches the gate's composeKit for every preset: ${label}`, () => {
      const catalogue = catalogueWith(patches);
      for (const preset of presets) {
        const shipped = composeKit({ selectedRoles: preset.roles, catalogue });
        const gate = repositoryCatalogue.composeKit({ selectedRoles: preset.roles, catalogue });
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

  it("treats the Customer<->Publisher role-level loop as legitimate (issue #1382)", () => {
    const catalogue = catalogueWith({ customer: withCustomerFixture });
    const launch = composeKit({ selectedRoles: presets.find((preset) => preset.id === "launch")!.roles, catalogue });
    expect(launch.state).toBe("composed");
    if (launch.state !== "composed") return;
    expect(launch.unsatisfiedNeeds).toEqual([]);
    expect(launch.roleCycles).toEqual([["customer", "publisher", "customer"]]);
    expect(launch.unjudgedCycle).toBeNull();
    expect(judgeNeedsCycles({ roleNames: launch.sequence, catalogue })).toEqual({ capabilityCycle: null, unjudgedCycle: null });
  });

  it("comes back indeterminate when the capabilities themselves deadlock", () => {
    const catalogue = catalogueWith({ customer: withCustomerFixture, publisher: publisherSurfacesWaitOnKeep });
    const launch = composeKit({ selectedRoles: presets.find((preset) => preset.id === "launch")!.roles, catalogue });
    expect(launch.state).toBe("indeterminate");
    if (launch.state === "indeterminate") expect(launch.reason).toContain("customer#keep-verdict -> publisher#surface-documents -> customer#keep-verdict");
  });
});
