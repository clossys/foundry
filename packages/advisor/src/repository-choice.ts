import { formatContractViolation, validateAgainstContract } from "./contract-schema.js";
import type { ContractSchema, ContractViolation } from "./contract-schema.js";
import { loadPlanContract } from "./plan-contract.js";
import type { AdvisorFinding } from "./types.js";

/**
 * The hub's repository-choice card (issue #1179): which repositories the
 * team works on, chosen from a list of repositories, so nobody types a
 * repository name.
 *
 * This package holds no credentials and makes no network call, so it
 * cannot know what a GitHub account can see: it states only what the list
 * it is given shows. The agent gathers the list with GitHub's `user/repos`
 * API (the package's skill gives the exact `gh api --paginate` command,
 * and checks that command succeeded before using its output), and hands it
 * to `repositoryChoiceCard()`; `applyRepositoryChoice()` then
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
 *
 * A repository's description is text written by whoever controls that
 * repository, so the card treats it as untrusted data: it is shown only as
 * a choice's `detail`, cleaned by `cleanDescription()` and capped.
 *
 * Both contracts cited above are in the public repository, not shipped in this package.
 */

/** Stable id of the repository-choice card. */
export const REPOSITORY_CHOICE_CARD_ID = "hub-repositories";
/** The choice a client picks when a repository they expected is not on the list. */
export const REPOSITORY_SOMETHING_ELSE_ID = "something-else";

/** One repository as the agent lists it: GitHub's `full_name` as `nameWithOwner`, and its `description`. */
export interface RepositoryListingEntry {
  readonly nameWithOwner: string;
  readonly description?: string | null;
}

export interface RepositoryChoice {
  /** The repository id (`owner/name`), exactly as listed; or `something-else`. */
  readonly id: string;
  /** Client-facing text: the repository's `owner/name`. */
  readonly label: string;
  /** The repository's own description, when it has one: untrusted text, cleaned and capped by `cleanDescription()`. */
  readonly detail?: string;
}

/** A multiple-selection intake card whose choices are the repositories supplied at runtime. */
export interface RepositoryChoiceCard {
  readonly id: typeof REPOSITORY_CHOICE_CARD_ID;
  readonly prompt: string;
  /** The client may choose any number of repositories (docs/contracts/intake-question-cards.json `selection` -- in the public repository, not shipped in this package). */
  readonly selection: "many";
  /** The recommended repository first when there is one, then the rest by id, then `something-else` last. */
  readonly choices: readonly RepositoryChoice[];
  /** Present only when the caller named the current repository and it is on the list; always `choices[0].id`. */
  readonly recommendedChoiceId?: string;
  readonly somethingElseFollowUp: string;
  /**
   * How many listed entries were left off this card because their id did
   * not satisfy the repository id contract -- for example an owner GitHub
   * itself lists but this contract's narrower id rule does not accept.
   * Never which ones: only the count. Present only when at least one entry
   * was skipped.
   */
  readonly skippedCount?: number;
}

export type RepositoryChoiceCardResult =
  | { readonly state: "card"; readonly card: RepositoryChoiceCard }
  /**
   * Nothing to choose from: the list given was well formed and empty, or
   * every entry in it was skipped because its id did not satisfy the
   * repository id contract (`skippedCount` then says how many, never which
   * ones). Says nothing about any account.
   */
  | { readonly state: "empty"; readonly skippedCount?: number }
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
  "Has the owner of the missing repository given your GitHub sign-in access to it? If not, ask them to add you, and I will list the repositories again.";

/** The longest `detail` shown, in characters; a longer description is cut and ends with an ellipsis. */
export const REPOSITORY_DETAIL_MAX_LENGTH = 200;

/**
 * Line-breaking characters, matched by Unicode property: controls (Cc,
 * which include tab, line feed and carriage return), and the line and
 * paragraph separators (Zl, Zp). Each is replaced with a space, so words on
 * either side stay apart.
 */
const BREAKS_IN_DETAIL = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/**
 * Characters a person cannot see, or cannot tell apart from blank, matched
 * by Unicode property rather than by a hand-kept list: format characters
 * (Cf -- bidirectional marks, embeddings, overrides and isolates, the
 * Arabic letter mark, zero-width spaces and joiners, word joiner and
 * invisible operators U+2060-U+2064, soft hyphen, the Mongolian vowel
 * separator, the byte order mark, and the tag characters U+E0000-U+E007F
 * that can carry hidden text), default-ignorable code points (which add
 * the combining grapheme joiner, variation selectors and Hangul fillers),
 * private-use characters (Co), surrogates (Cs), and noncharacters
 * (`\p{Noncharacter_Code_Point}`, permanently reserved and never assigned a
 * glyph, so any appearance of one is a probe, not text). U+2800 (BRAILLE
 * PATTERN BLANK) is added by its own code point: it is a real, printable
 * character (category So, not Cf), so no property above matches it, yet it
 * renders as blank and so can pad or hide text exactly like the characters
 * above. Each is removed, not replaced, so it cannot split a word. That
 * deliberately includes the zero-width joiner and non-joiner: an emoji
 * sequence joined by U+200D shows as its separate emoji, and text that
 * relies on U+200C, such as some Persian, shows unjoined. For a one-line
 * description that is an acceptable price for never showing hidden text.
 */
const INVISIBLE_IN_DETAIL = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Co}\p{Cs}\p{Noncharacter_Code_Point}⠀]/gu;

/**
 * A repository description as a card may show it: every control, line
 * separator or paragraph separator is replaced with a space; every
 * invisible character (see `INVISIBLE_IN_DETAIL`) is removed; runs of
 * whitespace become one space; the ends are trimmed; and anything past
 * `REPOSITORY_DETAIL_MAX_LENGTH` characters is cut to leave room for a
 * closing ellipsis. `undefined` when nothing is left. The description is
 * data, never an instruction.
 */
export function cleanDescription(description: string | null | undefined): string | undefined {
  if (typeof description !== "string") return undefined;
  const cleaned = description.replace(BREAKS_IN_DETAIL, " ").replace(INVISIBLE_IN_DETAIL, "").replace(/\s+/gu, " ").trim();
  if (cleaned === "") return undefined;
  const characters = [...cleaned];
  if (characters.length <= REPOSITORY_DETAIL_MAX_LENGTH) return cleaned;
  return `${characters.slice(0, REPOSITORY_DETAIL_MAX_LENGTH - 1).join("").trimEnd()}\u2026`;
}

/** A repository id as GitHub lists it: the inventory contract's id rule, and always qualified by its owner. */
const QUALIFIED_REPOSITORY_ID: ContractSchema = {
  allOf: [
    { $ref: "repository-inventory.json#/definitions/repositoryId" },
    { title: "owner/name, as GitHub lists a repository", pattern: "/" },
  ],
};

/**
 * Shape only: every entry must be `{ nameWithOwner: string, description?:
 * string | null }` with no other field. Whether `nameWithOwner` actually
 * satisfies the repository id contract is checked per entry, separately,
 * below -- a listing that is not even this shape is refused outright
 * (something built the file wrong), but one entry whose id GitHub lists yet
 * this contract's narrower id rule does not accept (for example an owner
 * with an underscore) is skipped and counted instead of refusing every
 * other entry in the list too.
 */
const LISTING_SCHEMA: ContractSchema = {
  title: "list of repositories",
  type: "array",
  items: {
    title: "repository entry",
    type: "object",
    additionalProperties: false,
    required: ["nameWithOwner"],
    properties: {
      nameWithOwner: { type: "string" },
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
 * Builds the repository-choice card from the list of repositories the
 * agent supplies. Refuses, with findings that name positions only, a
 * listing that is not an array of `{ nameWithOwner, description? }`
 * entries -- something built the file wrong. An entry that is that shape
 * but whose id breaks the inventory contract's id rule or is not
 * `owner/name` (#1179: for example an owner with an underscore, which
 * GitHub itself allows but this contract's narrower id rule does not) is
 * not a shape problem, so it does not refuse the rest of the list: it is
 * left off the card and counted in `skippedCount` instead. Two entries
 * naming the same repository (compared case-insensitively) still refuse
 * the whole list, by position, once skipped entries are set aside. A list
 * with nothing left to choose from -- given empty, or every entry
 * skipped -- is `{ state: "empty" }`. That is all either says; neither is a
 * statement about any account.
 *
 * `options.current` is the repository the client is working in (for
 * example the one being appointed as the hub). It only ever adds a
 * recommendation: when it is on the list (compared case-insensitively) it
 * is the recommended choice, listed first; when it is not, the card is built without
 * a recommendation. It never refuses the card. The other repositories
 * follow sorted by id, so the list is never in an arbitrary order, and
 * `something-else` is always last.
 */
export function repositoryChoiceCard(listing: unknown, options: { readonly current?: string } = {}): RepositoryChoiceCardResult {
  const violations = validateAgainstContract(LISTING_SCHEMA, listing, loadPlanContract);
  const problems = findings(LISTING_RULE, "listing", violations);
  if (problems.length > 0) return { state: "invalid", findings: problems };

  const shaped = listing as readonly RepositoryListingEntry[];
  const entries: RepositoryListingEntry[] = [];
  const originalIndexOf: number[] = [];
  let skippedCount = 0;
  for (const [index, entry] of shaped.entries()) {
    if (validateAgainstContract(QUALIFIED_REPOSITORY_ID, entry.nameWithOwner, loadPlanContract).length > 0) {
      skippedCount += 1;
      continue;
    }
    entries.push(entry);
    originalIndexOf.push(index);
  }

  const seen = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    const key = repositoryKey(entry.nameWithOwner);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      problems.push(
        finding(
          LISTING_RULE,
          `listing[${originalIndexOf[index]}].nameWithOwner`,
          `names the same repository as listing[${originalIndexOf[earlier]}].nameWithOwner (repository ids are compared case-insensitively)`,
        ),
      );
    } else {
      seen.set(key, index);
    }
  }
  if (problems.length > 0) return { state: "invalid", findings: problems };
  if (entries.length === 0) return { state: "empty", ...(skippedCount > 0 ? { skippedCount } : {}) };

  const currentIndex = typeof options.current === "string" ? seen.get(repositoryKey(options.current)) : undefined;
  const recommended = currentIndex === undefined ? undefined : entries[currentIndex];
  const rest = entries.filter((entry) => entry !== recommended).sort(byId);
  const ordered = recommended === undefined ? rest : [recommended, ...rest];
  const choices: RepositoryChoice[] = ordered.map((entry) => {
    const detail = cleanDescription(entry.description);
    return { id: entry.nameWithOwner, label: entry.nameWithOwner, ...(detail === undefined ? {} : { detail }) };
  });
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
      ...(skippedCount > 0 ? { skippedCount } : {}),
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
