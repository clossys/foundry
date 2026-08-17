import type { Finding } from "./types.js";

export interface RunnerLabel {
  readonly label: string;
  readonly capacity: "standard" | "high";
  readonly intendedWorkload: string;
}

export interface RunnerVocabulary {
  readonly labels: readonly RunnerLabel[];
  readonly defaultLabel: string;
  readonly highCapacityJustifiedJobs: readonly string[];
}

export interface RunnerConventions {
  readonly vocabulary: RunnerVocabulary;
  readonly publicRepos: readonly string[];
}

export interface JobDefinition {
  readonly workflow: string;
  readonly job: string;
  readonly label: string;
  readonly repoVisibility: "public" | "private";
}

export type RunnerCheckState = "satisfied" | "violated" | "indeterminate";

export interface RunnerCheckResult {
  readonly job: JobDefinition;
  readonly state: RunnerCheckState;
  readonly rule: string;
  readonly message: string;
}

function labelInVocabulary(label: string, vocabulary: RunnerVocabulary): RunnerLabel | undefined {
  return vocabulary.labels.find((l) => l.label === label);
}

function isHighCapacity(label: string, vocabulary: RunnerVocabulary): boolean {
  const found = labelInVocabulary(label, vocabulary);
  return found?.capacity === "high";
}

function isPublicRepoExempt(repo: string, conventions: RunnerConventions): boolean {
  return conventions.publicRepos.includes(repo);
}

export function validateRunnerLabel(
  job: JobDefinition,
  conventions: RunnerConventions,
): RunnerCheckResult[] {
  const results: RunnerCheckResult[] = [];

  if (!conventions.vocabulary || conventions.vocabulary.labels.length === 0) {
    results.push({
      job,
      state: "indeterminate",
      rule: "runner/missing-vocabulary",
      message: "No runner vocabulary declared.",
    });
    return results;
  }

  const labelEntry = labelInVocabulary(job.label, conventions.vocabulary);

  if (!labelEntry) {
    const knownLabels = conventions.vocabulary.labels.map((l) => l.label).join(", ");
    results.push({
      job,
      state: "violated",
      rule: "runner/unknown-label",
      message: `Label "${job.label}" is not in the declared vocabulary (known: ${knownLabels}).`,
    });
    return results;
  }

  if (job.repoVisibility === "public" && !isPublicRepoExempt(job.workflow, conventions)) {
    results.push({
      job,
      state: "violated",
      rule: "runner/visibility-mismatch",
      message: `Public repository uses paid-provider label "${job.label}" — public repos should use GitHub-hosted runners (free). Add to publicRepos exemption if intentional.`,
    });
    return results;
  }

  if (labelEntry.capacity === "high" && !conventions.vocabulary.highCapacityJustifiedJobs.includes(job.job)) {
    results.push({
      job,
      state: "violated",
      rule: "runner/unjustified-capacity",
      message: `Job "${job.job}" uses high capacity (${labelEntry.label}) but is not in the justified-jobs list. Add to highCapacityJustifiedJobs if intentional.`,
    });
    return results;
  }

  results.push({
    job,
    state: "satisfied",
    rule: "runner/ok",
    message: `Label "${job.label}" is valid for job "${job.job}".`,
  });

  return results;
}

export function validateRunnerSet(
  jobs: readonly JobDefinition[],
  conventions: RunnerConventions,
): RunnerCheckResult[] {
  const results: RunnerCheckResult[] = [];

  for (const job of jobs) {
    results.push(...validateRunnerLabel(job, conventions));
  }

  return results;
}

export function summarizeRunnerResults(results: readonly RunnerCheckResult[]): {
  readonly satisfied: number;
  readonly violated: number;
  readonly indeterminate: number;
  readonly overall: RunnerCheckState;
} {
  let satisfied = 0;
  let violated = 0;
  let indeterminate = 0;

  for (const r of results) {
    if (r.state === "satisfied") satisfied++;
    else if (r.state === "violated") violated++;
    else indeterminate++;
  }

  let overall: RunnerCheckState = "satisfied";
  if (violated > 0) overall = "violated";
  else if (indeterminate > 0 && satisfied === 0) overall = "indeterminate";

  return { satisfied, violated, indeterminate, overall };
}