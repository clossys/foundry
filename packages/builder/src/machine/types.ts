import type { SkillScope } from "@clossys/controller/conventions";

/**
 * Shared vocabulary for composing one machine from several account-owned
 * workspace checkouts plus a third-party-scoped skill source. See this
 * directory's `discovery.ts`, `third-party.ts`, `skills-manifest.ts`, and
 * `report.ts` headers for the pieces built on this vocabulary, and this
 * package's README ("Machine composition") for the two decisions this whole
 * module implements: builder owns the mechanism, not controller; and
 * composition is per-skill links into one composed directory, not a
 * directory symlink or a materialized copy.
 */

/**
 * The read surface discovery and the third-party skill source need, and
 * nothing more. Deliberately NOT `FileSystemPort` (`../types.js`): that
 * contract is shaped for applying and verifying a resolved plan against
 * individual destinations, and has no directory-listing operation at all.
 * Discovery's entire job is answering "what exists under this root," which
 * `FileSystemPort` cannot express without inventing one. Keeping this port
 * separate also means `../apply.ts` and `../verify.ts` stay exactly as they
 * are — untouched, per this module's charter.
 */
export interface DiscoveryPort {
  /**
   * Lists the entry names directly inside `path` (not full paths, not
   * recursive). Returns `undefined` when `path` does not exist, is not a
   * directory, or cannot be listed for any other reason — never throws, and
   * never returns an empty array to mean "unreadable." An empty array is a
   * real, readable, empty directory; `undefined` is the only way to say "I
   * could not look."
   */
  readdir(path: string): readonly string[] | undefined;
  /**
   * Reads `path` as UTF-8 text. Returns `undefined` when it does not exist,
   * is not a regular file, or cannot be read — never throws. Callers turn
   * `undefined` into an `indeterminate` finding, never into "empty" or
   * "absent by design."
   */
  readTextFile(path: string): string | undefined;
}

/** The schema version this module's two marker-file formats currently accept. */
export const MACHINE_DECLARATION_SCHEMA_VERSION = 1 as const;

/**
 * The marker file a directory places at its own root to declare itself an
 * account workspace to discovery. See `discovery.ts` for why a directory
 * WITHOUT this marker is simply not a candidate (it never declared intent to
 * be a workspace), while a directory WITH a marker that cannot be read or
 * validated becomes `indeterminate` and is never dropped.
 */
export const WORKSPACE_MARKER_FILENAME = "builder-machine-workspace.json";

export interface AccountWorkspaceDeclaration {
  readonly schemaVersion: typeof MACHINE_DECLARATION_SCHEMA_VERSION;
  /**
   * The identifier this workspace's skills should be composed under — also
   * used as the `NamedSourcePlan.source` when this workspace's skills are
   * planned. Two candidates declaring the same `account` is itself an
   * indeterminate finding; see `discovery.ts`.
   */
  readonly account: string;
  /** Path to this workspace's skill tree, relative to the workspace root. */
  readonly skillsPath: string;
}

/** Why a candidate that declared itself a workspace could not be resolved. */
export type WorkspaceIndeterminateReason =
  | "marker-unreadable"
  | "marker-malformed"
  | "marker-invalid-schema"
  | "skills-path-unreadable"
  | "duplicate-account";

/** One directory that declared itself an account workspace, resolved or not. */
export type WorkspaceCandidate =
  | {
      readonly verdict: "found";
      readonly path: string;
      readonly account: string;
      readonly skillsPath: string;
      /** Immediate entry names under `skillsPath`, sorted for a stable report. */
      readonly skillNames: readonly string[];
    }
  | {
      readonly verdict: "indeterminate";
      readonly path: string;
      readonly reason: WorkspaceIndeterminateReason;
      readonly detail: string;
      /** Present only when the marker itself was readable and valid enough to name an account. */
      readonly account?: string;
    };

/** Why discovery as a whole could not enumerate candidates at all. */
export type DiscoveryIndeterminateReason = "root-unreadable" | "root-not-declared";

/**
 * One flat shape rather than a discriminated union keyed on `verdict` alone,
 * deliberately: `verdict: "indeterminate"` covers two structurally different
 * situations — the root itself could not be resolved or read (`rootReason`
 * set, `candidates` empty), or the root was fine but one or more candidates
 * under it were indeterminate (`rootReason` absent, `candidates` populated
 * and itemized). A caller distinguishes the two with `rootReason`, not with
 * a second discriminant field, so both cases still share one `candidates`
 * array a caller can always iterate without narrowing first.
 */
export interface AccountWorkspaceDiscoveryResult {
  /**
   * `satisfied` only when a root was resolved, was readable, AND every
   * candidate that declared itself a workspace under it resolved cleanly.
   * See `discovery.ts`'s header for why a caller must never compose a
   * machine from the `found` candidates alone while ignoring the rest.
   */
  readonly verdict: "satisfied" | "indeterminate";
  readonly root: string | undefined;
  readonly rootReason?: DiscoveryIndeterminateReason;
  readonly rootDetail?: string;
  readonly candidates: readonly WorkspaceCandidate[];
}

/**
 * The source-of-truth file for skills belonging to no account. Every skill
 * this declares is tagged `scope: "third-party"` when materialized — see
 * `third-party.ts` — reusing controller's own `SkillScope` vocabulary rather
 * than inventing a second one.
 */
export const THIRD_PARTY_DECLARATION_FILENAME = "builder-machine-third-party-skills.json";

export interface ThirdPartySkillsDeclaration {
  readonly schemaVersion: typeof MACHINE_DECLARATION_SCHEMA_VERSION;
  /** Skill directory names this source of truth claims, relative to its own root. */
  readonly skills: readonly string[];
}

export type ThirdPartyIndeterminateReason =
  | "root-unreadable"
  | "root-not-declared"
  | "declaration-unreadable"
  | "declaration-malformed"
  | "declaration-invalid-schema"
  | "declared-skill-missing-on-disk";

/** One skill this source of truth vouches for, always third-party scope. */
export interface ThirdPartySkill {
  readonly name: string;
  readonly scope: SkillScope;
}

export interface ThirdPartySkillsResult {
  readonly verdict: "satisfied" | "indeterminate";
  readonly root: string | undefined;
  readonly reason?: ThirdPartyIndeterminateReason;
  readonly detail?: string;
  readonly skills: readonly ThirdPartySkill[];
}

/**
 * The machine-layer policy declaration (#410): a machine-local file, owned by
 * no repository, that maps package-owned, account-neutral content (the class
 * described in issue #393 as "already in `controller/conventions`; today an
 * account repository copies them out of its own `node_modules`") onto
 * destinations on ONE machine.
 *
 * WHY THIS LIVES HERE AND NOT IN A REPOSITORY
 * --------------------------------------------
 * #410 rules out three homes explicitly: inside `builder` itself (every
 * consumer of a general-purpose package would inherit one particular
 * machine's layout); inside one of the surviving account planes (an account
 * plane declaring another plane's — or the machine's whole — destination map
 * is exactly the "reaching into another plane" this program's design
 * forbids); and inside the repository being retired (that is the status quo
 * this issue exists to end). What is left is the machine itself: a plain
 * local file this module's caller points at by path (or by the
 * `BUILDER_MACHINE_LAYER_DECLARATION_PATH` environment variable — see
 * `machine-layer.ts`), read directly off disk by whatever process runs
 * `verifyMachine`. It carries no version of its own across machines, because
 * it is not a shared artifact -- it describes one machine's own placement
 * choices, the same way `/etc/fstab` describes one machine's own mounts
 * rather than a fleet's.
 *
 * This is deliberately the SAME shape `discovery.ts`'s workspace marker and
 * `third-party.ts`'s declaration already use, one level up: a JSON document
 * this subpath reads and validates without trusting, sharing this file's own
 * `MACHINE_DECLARATION_SCHEMA_VERSION` rather than inventing a third schema
 * counter for a third sibling format.
 *
 * WHAT IT DOES NOT DECLARE
 * -------------------------
 * The declaration says WHERE each catalog id (from
 * `@clossys/controller/conventions`'s `CONVENTION_DOCUMENTS` /
 * `CONVENTION_ADAPTERS`) is placed, and by which of this engine's three
 * install mechanisms (`link`, `copy`, `managed-block`) — never an absolute
 * path. Every `destination` is expressed RELATIVE TO `home`, because the
 * verifier already takes `home` as an explicit input and never infers it
 * (`report.ts`'s `MachineVerifyInputs.home`) — see `machine-layer.ts` for
 * where that token gets expanded. The earlier reasoning that composing class
 * 1 into a manifest would "bake absolute destination paths into a public
 * package" was the WRONG reason to keep this out of `builder` — `home` being
 * explicit already solves that. The actual reason is ownership: a general
 * engine should not ship one machine's opinion about where its own files go.
 */
export interface MachineLayerDeclarationFinding {
  readonly rule: string;
  readonly message: string;
}

/**
 * How one catalog entry gets placed. Mirrors this engine's own three
 * non-directory operation kinds (`../types.ts`'s `OperationKind`, minus
 * `private-directory`, which no catalog entry needs) — never a fourth
 * mechanism invented for this one caller.
 */
export type MachineLayerInstallKind = "link" | "copy" | "managed-block";

/**
 * One catalog entry's placement on this machine. `id` names an entry in
 * `@clossys/controller/conventions`'s `CONVENTION_DOCUMENTS` or
 * `CONVENTION_ADAPTERS` — validated against that catalog by
 * `machine-layer.ts`'s `buildClassOneManifest`, not by shape validation
 * alone, because shape validation must stay usable without importing
 * controller's catalog as ground truth for every check.
 */
export interface MachineLayerDestinationDeclaration {
  readonly id: string;
  readonly install: MachineLayerInstallKind;
  /**
   * Relative to `home` — never absolute, never containing a `..` segment.
   * Expanded against the `${HOME}` token this engine already resolves
   * (`../runtime.ts`'s `expandTokens`), the same as every other manifest
   * entry in this package.
   */
  readonly destination: string;
  /** Required, and only meaningful, when `install` is `"managed-block"`. */
  readonly startMarker?: string;
  readonly endMarker?: string;
}

export interface MachineLayerDeclaration {
  readonly schemaVersion: typeof MACHINE_DECLARATION_SCHEMA_VERSION;
  readonly destinations: readonly MachineLayerDestinationDeclaration[];
}

export type MachineLayerIndeterminateReason =
  | "path-not-declared"
  | "declaration-unreadable"
  | "declaration-malformed"
  | "declaration-invalid-schema"
  | "declaration-empty"
  | "declaration-semantically-invalid";

export interface MachineLayerResult {
  readonly verdict: "satisfied" | "indeterminate";
  readonly path: string | undefined;
  readonly reason?: MachineLayerIndeterminateReason;
  readonly detail?: string;
  /** Present only on `"satisfied"`. Ready to hand to `createRuntimeContext`. */
  readonly manifest?: import("../types.js").Manifest;
  /** Present only on `"satisfied"`. Where every catalog `source` resolves from. */
  readonly sourceRoot?: string;
}
