import { formatContractViolation, validateAgainstContract } from "./contract-schema.js";
import type { ContractSchema, ContractViolation } from "./contract-schema.js";
import { loadPlanContract } from "./plan-contract.js";
import type { AdvisorFinding } from "./types.js";

/**
 * The hub's repository-choice card (issue #1179): which repositories the
 * team works on, chosen from the repositories the client's GitHub account
 * can see, so nobody types a repository name.
 *
 * This package holds no credentials and makes no network call. The agent
 * gathers the list (for example `gh repo list --json nameWithOwner,description`)
 * and hands it to `repositoryChoiceCard()`; `applyRepositoryChoice()` then
 * checks the client's choice against the choices the card offered.
 * `@clossys/launcher` writes the chosen ids into the hub inventory
 * (`launcher --repositories`); this package writes nothing.
 *
 * The card follows the intake card model
 * (docs/contracts/intake-question-cards.json): stable ids, the recommended
 * choice first, and a "something else" follow-up. It uses that contract's
 * `selection: "many"` extension -- the client chooses any number of the
 * repositories -- and its choices are supplied at runtime, never from a
 * static file. Each repository id is checked against the repository
 * inventory contract's `definitions/repositoryId`
 * (docs/contracts/repository-inventory.json), through the one shared
 * contract checker, so every id this card offers is one Launcher accepts.
 *
 * Findings name a position only (for example `listing[3].nameWithOwner`),
 * never a repository name: a repository list can include private names,
 * and a finding can end up in a log.
 */

/** Stable id of the repository-choice card. */
export const REPOSITORY_CHOICE_CARD_ID = "hub-repositories";
/** The choice a client picks when a repository they expected is not on the list. */
export const REPOSITORY_SOMETHING_ELSE_ID = "something-else";

/** One repository as the agent lists it: `gh repo list --json nameWithOwner,description` output, entry for entry. */
export interface RepositoryListingEntry {
  readonly nameWithOwner: string;
  readonly description?: string | null;
}

export interface RepositoryChoice {
  /** The repository id (`owner/name`), exactly as listed; or `something-else`. */
  readonly id: string;
  /** Client-facing text: the repository's `owner/name`. */
  readonly label: string;
  /** The repository's own description, when it has one. */
  readonly detail?: string;
}

/** A multiple-selection intake card whose choices are the repositories supplied at runtime. */
export interface RepositoryChoiceCard {
  readonly id: typeof REPOSITORY_CHOICE_CARD_ID;
  readonly prompt: string;
  /** The client may choose any number of repositories (docs/contracts/intake-question-cards.json `selection`). */
  readonly selection: "many";
  /** The recommended repository first when there is one, then the rest by id, then `something-else` last. */
  readonly choices: readonly RepositoryChoice[];
  /** Present only when the caller named the current repository and it is on the list; always `choices[0].id`. */
  readonly recommendedChoiceId?: string;
  readonly somethingElseFollowUp: string;
}

export type RepositoryChoiceCardResult =
  | { readonly state: "card"; readonly card: RepositoryChoiceCard }
  | { readonly state: "invalid"; readonly findings: readonly AdvisorFinding[] };

export type RepositoryChoiceApplyResult =
  /** One or more offered repositories, in the card's order. `somethingElse` is true when the client also said one is missing. */
  | { readonly kind: "chosen"; readonly repositories: readonly string[]; readonly somethingElse: boolean }
  /** Only "something else": no repository chosen yet; ask `somethingElseFollowUp`. */
  | { readonly kind: "something-else" }
  | { readonly kind: "refused"; readonly findings: readonly AdvisorFinding[] };

const LISTING_RULE = "repository-listing";
const CHOICE_RULE = "repository-choice";

const PROMPT = "Which of these repositories should the team work on? Choose every one that applies.";
const SOMETHING_ELSE_LABEL = "A repository I need is not on this list.";
const SOMETHING_ELSE_FOLLOW_UP =
  "Is the missing repository owned by an organization or account your GitHub sign-in cannot see yet? If so, ask its owner to add you, and I will list the repositories again.";

/** A repository id as GitHub lists it: the inventory contract's id rule, and always qualified by its owner. */
const QUALIFIED_REPOSITORY_ID: ContractSchema = {
  allOf: [
    { $ref: "repository-inventory.json#/definitions/repositoryId" },
    { title: "owner/name, as GitHub lists a repository", pattern: "/" },
  ],
};

const LISTING_SCHEMA: ContractSchema = {
  title: "list of repositories",
  type: "array",
  minItems: 1,
  items: {
    title: "repository entry",
    type: "object",
    additionalProperties: false,
    required: ["nameWithOwner"],
    properties: {
      nameWithOwner: QUALIFIED_REPOSITORY_ID,
      description: { title: "a string or null", oneOf: [{ type: "string" }, { type: "null" }] },
    },
  },
};

const CHOICE_SCHEMA: ContractSchema = {
  title: "list of choice ids",
  type: "array",
  minItems: 1,
  items: { type: "string" },
};

function findings(rule: string, label: string, violations: readonly ContractViolation[]): AdvisorFinding[] {
  return violations.map((violation) => ({
    rule,
    severity: "error",
    message: formatContractViolation(label, violation),
    path: violation.path === "" ? label : violation.path.startsWith("[") ? `${label}${violation.path}` : `${label}.${violation.path}`,
  }));
}

function finding(rule: string, path: string, message: string): AdvisorFinding {
  return { rule, severity: "error", message: `${path} ${message}`, path };
}

/** Case-insensitive, as GitHub compares owner and repository names (and as the inventory contract's duplicate rule does). */
function repositoryKey(id: string): string {
  return id.toLowerCase();
}

function byId(left: RepositoryListingEntry, right: RepositoryListingEntry): number {
  const a = repositoryKey(left.nameWithOwner);
  const b = repositoryKey(right.nameWithOwner);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Builds the repository-choice card from the repositories the client's
 * GitHub account can see, as the agent listed them. Refuses, with findings
 * that name positions only, a listing that is not a nonempty array of
 * `{ nameWithOwner, description? }` entries, an id that breaks the
 * inventory contract's id rule or is not `owner/name`, and two entries
 * naming the same repository (compared case-insensitively).
 *
 * `options.current` is the repository the client is working in (for
 * example the one being appointed as the hub). When given, it must be on
 * the list; it is then the recommended choice, listed first. The other
 * repositories follow sorted by id, so the list is never in an arbitrary
 * order, and `something-else` is always last.
 */
export function repositoryChoiceCard(listing: unknown, options: { readonly current?: string } = {}): RepositoryChoiceCardResult {
  const violations = validateAgainstContract(LISTING_SCHEMA, listing, loadPlanContract);
  const problems = findings(LISTING_RULE, "listing", violations);
  if (options.current !== undefined) {
    problems.push(...findings(LISTING_RULE, "current", validateAgainstContract(QUALIFIED_REPOSITORY_ID, options.current, loadPlanContract)));
  }
  if (problems.length > 0) return { state: "invalid", findings: problems };

  const entries = listing as readonly RepositoryListingEntry[];
  const seen = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    const key = repositoryKey(entry.nameWithOwner);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      problems.push(
        finding(LISTING_RULE, `listing[${index}].nameWithOwner`, `names the same repository as listing[${earlier}].nameWithOwner (repository ids are compared case-insensitively)`),
      );
    } else {
      seen.set(key, index);
    }
  }
  const currentIndex = options.current === undefined ? undefined : seen.get(repositoryKey(options.current));
  if (options.current !== undefined && currentIndex === undefined) {
    problems.push(finding(LISTING_RULE, "current", "is not one of the listed repositories"));
  }
  if (problems.length > 0) return { state: "invalid", findings: problems };

  const recommended = currentIndex === undefined ? undefined : entries[currentIndex];
  const rest = entries.filter((entry) => entry !== recommended).sort(byId);
  const ordered = recommended === undefined ? rest : [recommended, ...rest];
  const choices: RepositoryChoice[] = ordered.map((entry) => ({
    id: entry.nameWithOwner,
    label: entry.nameWithOwner,
    ...(typeof entry.description === "string" && entry.description.trim() !== "" ? { detail: entry.description.trim() } : {}),
  }));
  choices.push({ id: REPOSITORY_SOMETHING_ELSE_ID, label: SOMETHING_ELSE_LABEL });
  return {
    state: "card",
    card: {
      id: REPOSITORY_CHOICE_CARD_ID,
      prompt: PROMPT,
      selection: "many",
      choices,
      ...(recommended === undefined ? {} : { recommendedChoiceId: recommended.nameWithOwner }),
      somethingElseFollowUp: SOMETHING_ELSE_FOLLOW_UP,
    },
  };
}

/**
 * Checks the client's choice against the choices `card` offered. `chosen`
 * is the list of choice ids the client picked. Refuses, naming positions
 * only, an empty choice, an id that is not exactly one the card offered, and
 * an id chosen twice. Returns the chosen repositories in the card's order --
 * the ids to hand to `launcher --repositories` -- and whether the client
 * also said a repository is missing.
 */
export function applyRepositoryChoice(card: RepositoryChoiceCard, chosen: unknown): RepositoryChoiceApplyResult {
  const shape = findings(CHOICE_RULE, "choice", validateAgainstContract(CHOICE_SCHEMA, chosen, loadPlanContract));
  if (shape.length > 0) return { kind: "refused", findings: shape };
  const ids = chosen as readonly string[];
  const offered = new Set(card.choices.map((choice) => choice.id));
  const problems: AdvisorFinding[] = [];
  const first = new Map<string, number>();
  for (const [index, id] of ids.entries()) {
    const earlier = first.get(id);
    if (!offered.has(id)) problems.push(finding(CHOICE_RULE, `choice[${index}]`, "is not one of the choices this card offered"));
    else if (earlier !== undefined) problems.push(finding(CHOICE_RULE, `choice[${index}]`, `repeats choice[${earlier}]`));
    else first.set(id, index);
  }
  if (problems.length > 0) return { kind: "refused", findings: problems };
  const somethingElse = first.has(REPOSITORY_SOMETHING_ELSE_ID);
  const repositories = card.choices.filter((choice) => choice.id !== REPOSITORY_SOMETHING_ELSE_ID && first.has(choice.id)).map((choice) => choice.id);
  if (repositories.length === 0) return { kind: "something-else" };
  return { kind: "chosen", repositories, somethingElse };
}
