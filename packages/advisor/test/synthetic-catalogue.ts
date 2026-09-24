import type { CapabilityArtifactRef, CapabilityCatalogue, DeclaredCapability, DeclaredFeed, RoleCapability } from "../src/capability-catalogue.js";
import type { KitPreset } from "../src/kit-presets.js";

/**
 * A small, fixed catalogue for behaviour tests. It is deliberately NOT this
 * repository's generated catalogue: that one changes whenever a package
 * declares real `needs`/`solves`, and a behaviour test must not break
 * because correct data landed (review of PR #1403). This file sits outside
 * `src/`, so it is never compiled into `dist/` and never packed.
 *
 * Shape: `publisher` needs `writer`, `designer` and `toolchain` (which
 * solves nothing, so it is only ever pulled in); `writer` and `designer`
 * need nothing; `strategist`, `customer` and `influencer` stand alone;
 * `inspector` and `integrator` have no capability map and need each other.
 */

const need = (role: string, artifact: string): CapabilityArtifactRef => ({ artifact, role, producerRole: `@clossys/${role}`, source: "manifest" });
const feed = (role: string, artifact: string): CapabilityArtifactRef => ({ artifact, role, source: "manifest" });

function role(
  name: string,
  {
    problem,
    evidence = "designed",
    needs = [],
    feeds = [],
    declaredFeeds = [],
    capabilities = [],
  }: {
    problem?: string;
    evidence?: "designed" | "qualified" | "proven";
    needs?: CapabilityArtifactRef[];
    feeds?: CapabilityArtifactRef[];
    declaredFeeds?: DeclaredFeed[];
    capabilities?: DeclaredCapability[];
  },
): RoleCapability {
  return {
    role: name,
    scopeName: `@clossys/${name}`,
    jobQuestion: `${name} job question`,
    primaryMode: "fulfill",
    metric: { name: `${name} metric`, direction: "increase" },
    boundary: { owns: `${name} deliverable`, excludes: [] },
    solves: problem ? [{ problem, statement: `${name} problem statement`, metric: `${name} metric`, proofCase: `${name}-case`, evidence }] : [],
    fit: [],
    needs,
    feeds,
    declaredFeeds,
    capabilities,
  };
}

export const SYNTHETIC_CATALOGUE: CapabilityCatalogue = {
  schemaVersion: 1,
  roles: [
    role("customer", { problem: "customer-would-they-keep-it" }),
    role("designer", { problem: "designer-interface-quality", evidence: "qualified", feeds: [feed("publisher", "tokens")], declaredFeeds: [{ artifact: "tokens", path: "clossys/designer/brand.css" }] }),
    role("influencer", { problem: "influencer-audience-response" }),
    role("inspector", { problem: "inspector-unchecked-release", needs: [need("integrator", "integration-report")], feeds: [feed("integrator", "inspection-report")], declaredFeeds: [{ artifact: "inspection-report", path: "clossys/inspector/report.json" }] }),
    role("integrator", { needs: [need("inspector", "inspection-report")], feeds: [feed("inspector", "integration-report")], declaredFeeds: [{ artifact: "integration-report", path: "clossys/integrator/report.json" }] }),
    role("toolchain", { feeds: [feed("publisher", "pipeline")], declaredFeeds: [{ artifact: "pipeline", path: "clossys/toolchain/pipeline.json" }] }),
    role("publisher", { problem: "publisher-verified-release", needs: [need("designer", "tokens"), need("toolchain", "pipeline"), need("writer", "copy")] }),
    role("strategist", { problem: "strategist-unclear-direction" }),
    role("writer", { problem: "writer-unapproved-copy", evidence: "qualified", feeds: [feed("publisher", "copy")], declaredFeeds: [{ artifact: "copy", path: "clossys/writer/copy.json" }] }),
  ],
};

export const SYNTHETIC_PRESETS: readonly KitPreset[] = [
  { id: "launch", label: "Launch", problem: "We can't explain what we are.", roles: ["strategist", "writer", "designer", "publisher"] },
];

/** Four direct solvers: with `toolchain`, which `publisher` pulls in, their closure is exactly the `launch` preset's own closure. */
export const SYNTHETIC_LAUNCH_PROBLEMS = [
  { id: "strategist-unclear-direction", primary: true },
  { id: "designer-interface-quality" },
  { id: "writer-unapproved-copy" },
  { id: "publisher-verified-release" },
];
