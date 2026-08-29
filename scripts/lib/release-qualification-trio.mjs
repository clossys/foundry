export const TRIO = Object.freeze(["advisor", "starter", "controller"]);
export const TRIO_RELEASE = Object.freeze({ target: "clossys-npmjs", scope: "@clossys", registry: "https://registry.npmjs.org", access: "public" });
export const TRIO_COHORT_PATH = "governance/release-qualification-cohorts/clossys-npmjs-trio.json";
export const TRIO_QUARANTINE_PATH = "governance/release-qualification-quarantines/clossys-npmjs-trio.json";

export function isTrioCandidate(candidate) {
  return TRIO.some((key) => candidate?.name === `@clossys/${key}`);
}
