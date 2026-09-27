import type { SecretCatalog, SecretCatalogEntry, SecretKey } from "./types.js";
import { buildCheckOutputEnvelope } from "./generated/check-output-envelope.js";
import type { CheckFinding, CheckOutputEnvelope } from "./generated/check-output-envelope.js";
import { hasField, hasOnlyFields, isNonEmptyString, readOwnDataRecord } from "./credential.js";
import type { OwnDataRecord } from "./credential.js";

/**
 * Secret environments (issue #1528): a value-free declaration of where every
 * secret and configuration name is supposed to live, per environment, and a
 * reconciliation of that declaration against names-only inventory snapshots
 * of what each location actually holds.
 *
 * The design stance this module encodes:
 *
 * - The secret manager (Infisical) is the single source of truth for values.
 *   A declaration names exactly one `source`; its `role` is `secret-manager`
 *   (and its provider must then be `infisical`), or — only as a written,
 *   time-bounded exception — `hosting-as-source`, which requires both a
 *   `reason` and a `migration` naming how the values leave the hosting
 *   provider. An exception without a written reason is treated as no
 *   exception at all, the same convention `provider-custody.ts` applies to a
 *   `leastPrivilegeNote`.
 * - Hosting providers and CI are delivery targets, never sources. A target
 *   receives only the entries that list it in their own `deliveryTargets`, and
 *   anything else found there is an `undeclared-name` — a hand-set value that
 *   no longer traces back to the source.
 * - A provider API token is never a delivery target for a build environment.
 *   A token that lets something administer a hosting provider is declared
 *   only with the operator or CI environments that actually need it (see
 *   `provider-custody.ts` for how such a token is held), never pushed into
 *   the environment a build or a running deployment can read.
 * - A `secret` is `separate` per environment unless the declaration says
 *   otherwise with a written reason, so a preview deployment cannot quietly
 *   hold the production value. `separate-shares-identity` catches the two
 *   ways that happens in practice: one provider record spanning several
 *   environments, and two records the provider itself reports as one stored
 *   value (equal opaque `identity`).
 *
 * Security class: this module never reads, prints, logs, hashes, or
 * transmits a secret value. It handles names, environments, storage kinds,
 * and opaque provider-issued identifiers only. An `identity` is compared for
 * equality and never appears in any finding, message, path, or error. A
 * finding's `message` is always one fixed string per rule; its `path` is
 * built only from known field names, array indices, declared location ids,
 * declared environment names, and names that already matched the key-name
 * pattern — never from an unknown field's name or value, and never from the
 * text of a structural problem.
 *
 * Reading discipline mirrors `provider-custody.ts`: every object is read
 * through `readOwnDataRecord` (own data properties only, so a getter never
 * runs), every array through an accessor-safe dense-array reader (never
 * spread, `for...of`, or `Array.prototype` iteration of a caller array), and
 * every public entry point is wrapped in an outer boundary that reports
 * `indeterminate` rather than throwing out to a caller.
 */

export type DeclaredEnvironment = "development" | "preview" | "staging" | "production";
export type SecretLocationProvider = "infisical" | "vercel" | "github-actions";
export type SecretSourceRole = "secret-manager" | "hosting-as-source";
export type DeliverySync = "provider-integration" | "locksmith-push" | "manual";
export type SecretEntryClass = "secret" | "public-config" | "config";
export type EnvironmentMode = "separate" | "shared" | "absent";
export type InventoryStorage = "managed" | "sensitive" | "readable" | "plain" | "unknown";

/** Declared environment -> provider-side environment name. */
export type EnvironmentMap = Readonly<Partial<Record<DeclaredEnvironment, string>>>;

export interface SecretEnvironmentPolicy {
  readonly mode: EnvironmentMode;
  readonly reason?: string;
}

export interface SecretSource {
  readonly id: string;
  readonly provider: SecretLocationProvider;
  readonly role: SecretSourceRole;
  readonly environmentMap: EnvironmentMap;
  readonly reason?: string;
  readonly migration?: string;
}

export interface SecretDeliveryTarget {
  readonly id: string;
  readonly provider: SecretLocationProvider;
  readonly environmentMap: EnvironmentMap;
  readonly sync: DeliverySync;
}

export interface SecretDeclarationEntry {
  readonly key: SecretKey;
  readonly required: boolean;
  readonly description?: string;
  readonly group?: string;
  readonly class: SecretEntryClass;
  readonly purpose: string;
  readonly consumers: readonly string[];
  readonly environments?: Readonly<Partial<Record<DeclaredEnvironment, SecretEnvironmentPolicy>>>;
  readonly deliveryTargets: readonly string[];
}

export interface SecretDeclaration {
  readonly version: 2;
  readonly environments: readonly DeclaredEnvironment[];
  readonly source: SecretSource;
  readonly deliveryTargets: readonly SecretDeliveryTarget[];
  readonly entries: readonly SecretDeclarationEntry[];
}

export interface InventoryEntry {
  readonly name: string;
  readonly environments: readonly string[];
  readonly storage: InventoryStorage;
  /** Opaque provider-issued identifier, compared for equality only and never emitted. */
  readonly identity?: string;
}

export interface InventorySnapshot {
  readonly version: 1;
  readonly provider: SecretLocationProvider;
  readonly location: string;
  readonly observedAt: string;
  readonly environments: readonly string[];
  readonly entries: readonly InventoryEntry[];
}

export type SecretEnvironmentsRule =
  // violations
  | "separate-shares-identity"
  | "location-merges-environments"
  | "declared-environment-missing"
  | "absent-environment-present"
  | "undeclared-name"
  | "secret-stored-readable"
  | "shared-without-reason"
  | "absent-without-reason"
  | "hosting-source-without-exception"
  | "source-role-provider-mismatch"
  | "unknown-delivery-target"
  | "environment-not-declared"
  | "missing-purpose"
  | "missing-consumers"
  // indeterminate
  | "declaration-unreadable"
  | "inventory-unreadable"
  | "inventory-unmatched"
  | "inventories-empty"
  | "location-unobserved"
  | "storage-unobserved"
  // warning
  | "manual-sync";

export interface SecretEnvironmentsFinding extends CheckFinding {
  readonly rule: SecretEnvironmentsRule;
}

export type SecretEnvironmentsVerdict = "satisfied" | "violated" | "indeterminate";

export interface SecretEnvironmentsInput {
  readonly declaration: unknown;
  readonly inventories: unknown;
}

export interface SecretEnvironmentsEvaluation {
  readonly verdict: SecretEnvironmentsVerdict;
  readonly exitCode: 0 | 1 | 2;
  readonly findings: readonly SecretEnvironmentsFinding[];
}

// ---------------------------------------------------------------------------
// Vocabularies and fixed finding text
// ---------------------------------------------------------------------------

const DECLARED_ENVIRONMENTS: readonly DeclaredEnvironment[] = ["development", "preview", "staging", "production"];
const PROVIDERS: readonly SecretLocationProvider[] = ["infisical", "vercel", "github-actions"];
const SOURCE_ROLES: readonly SecretSourceRole[] = ["secret-manager", "hosting-as-source"];
const SYNCS: readonly DeliverySync[] = ["provider-integration", "locksmith-push", "manual"];
const ENTRY_CLASSES: readonly SecretEntryClass[] = ["secret", "public-config", "config"];
const MODES: readonly EnvironmentMode[] = ["separate", "shared", "absent"];
const STORAGES: readonly InventoryStorage[] = ["managed", "sensitive", "readable", "plain", "unknown"];

/** The one name shape a declared key or an inventoried name may take. */
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * A location id is operator-written and appears in finding paths
 * (`<location>/<environment>/<key>`), so it is held to a short slug shape:
 * no `/` or `+` that would make a path ambiguous, and no room for free text.
 */
const LOCATION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** ISO-8601 date-time with seconds and an explicit offset; `Date.parse` must also accept it. */
const OBSERVED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const DECLARATION_FIELDS = ["version", "environments", "source", "deliveryTargets", "entries"] as const;
const SOURCE_FIELDS = ["id", "provider", "role", "environmentMap", "reason", "migration"] as const;
const TARGET_FIELDS = ["id", "provider", "environmentMap", "sync"] as const;
const ENTRY_FIELDS = [
  "key",
  "required",
  "description",
  "group",
  "class",
  "purpose",
  "consumers",
  "environments",
  "deliveryTargets",
] as const;
const POLICY_FIELDS = ["mode", "reason"] as const;
const INPUT_FIELDS = ["declaration", "inventories"] as const;
const SNAPSHOT_FIELDS = ["version", "provider", "location", "observedAt", "environments", "entries"] as const;
const INVENTORY_ENTRY_FIELDS = ["name", "environments", "storage", "identity"] as const;

/**
 * The rules that make a result `indeterminate` rather than `violated`: each
 * says "this check could not see enough to judge", never "this is wrong".
 */
const INDETERMINATE_RULES: ReadonlySet<SecretEnvironmentsRule> = new Set<SecretEnvironmentsRule>([
  "declaration-unreadable",
  "inventory-unreadable",
  "inventory-unmatched",
  "inventories-empty",
  "location-unobserved",
  "storage-unobserved",
]);

/**
 * One fixed message per rule, kept as a single table so no call site ever
 * improvises wording — and in particular so no caller-supplied text (an
 * unknown field, an identity, an unreadable value) can ever be interpolated
 * into a message. Specifics live only in `path`.
 */
const FINDING_TEXT: Readonly<Record<SecretEnvironmentsRule, { readonly severity: "error" | "warning"; readonly message: string }>> =
  Object.freeze({
    "separate-shares-identity": {
      severity: "error",
      message: "a secret declared separate in this environment shares one stored value with another environment",
    },
    "location-merges-environments": {
      severity: "error",
      message:
        "this location maps several declared environments onto one provider environment, so a secret declared separate cannot stay separate there",
    },
    "declared-environment-missing": {
      severity: "error",
      message: "a required name the declaration places in this environment is not present at this location",
    },
    "absent-environment-present": {
      severity: "error",
      message: "a name the declaration marks absent in this environment is present at this location",
    },
    "undeclared-name": {
      severity: "error",
      message: "this location holds a name the declaration does not place there, so it does not trace back to the source",
    },
    "secret-stored-readable": {
      severity: "error",
      message: "a secret is stored in a readable or plain form at this location",
    },
    "shared-without-reason": {
      severity: "error",
      message: "a secret declared shared in this environment has no written reason",
    },
    "absent-without-reason": {
      severity: "error",
      message: "a secret declared absent from this environment has no written reason",
    },
    "hosting-source-without-exception": {
      severity: "error",
      message: "a hosting provider is declared as the source of values without both a written reason and a migration plan",
    },
    "source-role-provider-mismatch": {
      severity: "error",
      message: "the source role does not fit its provider: a secret-manager source is Infisical, and a hosting-as-source source is not",
    },
    "unknown-delivery-target": {
      severity: "error",
      message: "an entry names a delivery target the declaration does not define",
    },
    "environment-not-declared": {
      severity: "error",
      message: "this environment is used here but is not in the declaration's top-level environments list",
    },
    "missing-purpose": {
      severity: "error",
      message: "purpose is missing or is not a non-empty string",
    },
    "missing-consumers": {
      severity: "error",
      message: "consumers is missing, empty, or holds something other than non-empty strings",
    },
    "declaration-unreadable": {
      severity: "error",
      message: "the declaration is not readable as a version-2 secret declaration with the closed field set this check inspects",
    },
    "inventory-unreadable": {
      severity: "error",
      message: "an inventory is not readable as a version-1, names-only inventory snapshot",
    },
    "inventory-unmatched": {
      severity: "error",
      message: "an inventory names a location or provider the declaration does not define, so it was not used",
    },
    "inventories-empty": {
      severity: "error",
      message: "no inventory was supplied, so no location could be observed",
    },
    "location-unobserved": {
      severity: "error",
      message: "no supplied inventory observes this location in this environment",
    },
    "storage-unobserved": {
      severity: "error",
      message: "the storage form of a secret at this location was not reported, so it could not be confirmed as protected",
    },
    "manual-sync": {
      severity: "warning",
      message: "this delivery target is synced by hand, so drift from the source is caught only when this check runs",
    },
  });

/** The second fixed `storage-unobserved` message the spec distinguishes: managed storage outside a secret-manager source. */
const MANAGED_OUTSIDE_SECRET_MANAGER_MESSAGE = "managed storage is only interpretable at a secret-manager source";

function finding(rule: SecretEnvironmentsRule, path?: string, message?: string): SecretEnvironmentsFinding {
  const text = FINDING_TEXT[rule];
  const resolvedMessage = message ?? text.message;
  return path === undefined
    ? Object.freeze({ rule, severity: text.severity, message: resolvedMessage })
    : Object.freeze({ rule, severity: text.severity, message: resolvedMessage, path });
}

const EXIT_CODES: Readonly<Record<SecretEnvironmentsVerdict, 0 | 1 | 2>> = Object.freeze({
  satisfied: 0,
  violated: 1,
  indeterminate: 2,
});

function isOneOf<T extends string>(vocabulary: readonly T[], value: unknown): value is T {
  if (typeof value !== "string") return false;
  for (let index = 0; index < vocabulary.length; index += 1) {
    if (vocabulary[index] === value) return true;
  }
  return false;
}

function includesString(values: readonly string[], value: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === value) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Accessor-safe structural reading
// ---------------------------------------------------------------------------

/**
 * Thrown only inside this module's structural readers and always caught
 * before it could reach a caller. It carries a path built from known field
 * names and array indices only — never an offending key or value.
 */
class Unreadable {
  constructor(readonly path: string | undefined) {}
}

function unreadable(path: string | undefined): never {
  throw new Unreadable(path);
}

/** A closed-field, own-data record, or `Unreadable` at `path`. */
function readClosedRecord(value: unknown, fields: readonly string[], path: string | undefined): OwnDataRecord {
  const record = readOwnDataRecord(value);
  if (record === null || !hasOnlyFields(record, fields)) unreadable(path);
  return record;
}

function requireField(record: OwnDataRecord, field: string, path: string): unknown {
  if (!hasField(record, field)) unreadable(path);
  return record.values[field];
}

/**
 * Accessor-safe, prototype-pollution-resistant read of a dense array — the
 * same shape as `provider-custody.ts`'s `readNonEmptyStringArray`, without
 * the element-type check: reject anything but a real `Array.prototype`-rooted
 * array, confirm the own-key count matches `length` exactly (no holes, no
 * extra own keys), and read every element through
 * `Reflect.getOwnPropertyDescriptor`, so an accessor planted at an index is
 * refused without ever running. Returns a fresh array this module owns.
 */
function readDenseArray(value: unknown, allowEmpty: boolean): readonly unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) return null;
  const length: unknown = lengthDescriptor.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < (allowEmpty ? 0 : 1)) return null;

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1) return null;
  for (let keyIndex = 0; keyIndex < ownKeys.length; keyIndex += 1) {
    const key = ownKeys[keyIndex];
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return null;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length) return null;
  }

  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return null;
    values[index] = descriptor.value;
  }
  return values;
}

/** A dense array of non-empty strings, or `null`. `unique` also refuses a repeated element. */
function readStringArray(value: unknown, allowEmpty: boolean, unique: boolean): readonly string[] | null {
  const values = readDenseArray(value, allowEmpty);
  if (values === null) return null;
  const strings: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const element = values[index];
    if (!isNonEmptyString(element)) return null;
    if (unique && seen.has(element)) return null;
    seen.add(element);
    strings[index] = element;
  }
  return strings;
}

function requireDenseArray(value: unknown, allowEmpty: boolean, path: string): readonly unknown[] {
  const values = readDenseArray(value, allowEmpty);
  if (values === null) unreadable(path);
  return values;
}

/** An optional free-text field: absent, or a string (emptiness is a semantic question, judged elsewhere). */
function optionalString(record: OwnDataRecord, field: string, path: string): string | undefined {
  if (!hasField(record, field)) return undefined;
  const value = record.values[field];
  if (typeof value !== "string") unreadable(path);
  return value;
}

interface ReadEnvironmentMap {
  /** Own-key order, as declared. Every key is a `DeclaredEnvironment`. */
  readonly keys: readonly DeclaredEnvironment[];
  readonly values: ReadonlyMap<DeclaredEnvironment, string>;
}

function readEnvironmentMap(value: unknown, path: string): ReadEnvironmentMap {
  const record = readClosedRecord(value, DECLARED_ENVIRONMENTS, path);
  const keys: DeclaredEnvironment[] = [];
  const values = new Map<DeclaredEnvironment, string>();
  for (let index = 0; index < record.keys.length; index += 1) {
    const key = record.keys[index];
    if (!isOneOf(DECLARED_ENVIRONMENTS, key)) unreadable(path);
    const providerEnvironment = record.values[key];
    if (!isNonEmptyString(providerEnvironment)) unreadable(`${path}.${key}`);
    keys.push(key);
    values.set(key, providerEnvironment);
  }
  return { keys, values };
}

interface ReadLocation {
  readonly kind: "source" | "target";
  /** `source` or `deliveryTargets[<i>]` — where this location sits in the declaration. */
  readonly declarationPath: string;
  readonly id: string;
  readonly provider: SecretLocationProvider;
  readonly environmentMap: ReadEnvironmentMap;
  /** Source only. */
  readonly role: SecretSourceRole | null;
  readonly reason: string | undefined;
  readonly migration: string | undefined;
  /** Target only. */
  readonly sync: DeliverySync | null;
}

interface ReadPolicy {
  readonly mode: EnvironmentMode;
  readonly reason: string | undefined;
}

interface ReadEntry {
  readonly index: number;
  readonly key: SecretKey;
  readonly required: boolean;
  readonly description: string | undefined;
  readonly group: string | undefined;
  readonly entryClass: SecretEntryClass;
  /** A non-empty string, or `null` for any other value (judged semantically as `missing-purpose`). */
  readonly purpose: string | null;
  /** A non-empty array of non-empty strings, or `null` (judged semantically as `missing-consumers`). */
  readonly consumers: readonly string[] | null;
  readonly hasEnvironments: boolean;
  /** Own-key order, as declared. */
  readonly policyKeys: readonly DeclaredEnvironment[];
  readonly policies: ReadonlyMap<DeclaredEnvironment, ReadPolicy>;
  readonly deliveryTargets: readonly string[];
}

interface ReadDeclaration {
  readonly environments: readonly DeclaredEnvironment[];
  readonly source: ReadLocation;
  readonly targets: readonly ReadLocation[];
  readonly entries: readonly ReadEntry[];
}

function readProvider(record: OwnDataRecord, path: string): SecretLocationProvider {
  const provider = requireField(record, "provider", `${path}.provider`);
  if (!isOneOf(PROVIDERS, provider)) unreadable(`${path}.provider`);
  return provider;
}

function readLocationId(record: OwnDataRecord, path: string): string {
  const id = requireField(record, "id", `${path}.id`);
  if (typeof id !== "string" || !LOCATION_ID_PATTERN.test(id)) unreadable(`${path}.id`);
  return id;
}

function readSource(value: unknown): ReadLocation {
  const path = "source";
  const record = readClosedRecord(value, SOURCE_FIELDS, path);
  const id = readLocationId(record, path);
  const provider = readProvider(record, path);
  const role = requireField(record, "role", `${path}.role`);
  if (!isOneOf(SOURCE_ROLES, role)) unreadable(`${path}.role`);
  const environmentMap = readEnvironmentMap(requireField(record, "environmentMap", `${path}.environmentMap`), `${path}.environmentMap`);
  return {
    kind: "source",
    declarationPath: path,
    id,
    provider,
    environmentMap,
    role,
    reason: optionalString(record, "reason", `${path}.reason`),
    migration: optionalString(record, "migration", `${path}.migration`),
    sync: null,
  };
}

function readTarget(value: unknown, index: number): ReadLocation {
  const path = `deliveryTargets[${index}]`;
  const record = readClosedRecord(value, TARGET_FIELDS, path);
  const id = readLocationId(record, path);
  const provider = readProvider(record, path);
  const environmentMap = readEnvironmentMap(requireField(record, "environmentMap", `${path}.environmentMap`), `${path}.environmentMap`);
  const sync = requireField(record, "sync", `${path}.sync`);
  if (!isOneOf(SYNCS, sync)) unreadable(`${path}.sync`);
  return {
    kind: "target",
    declarationPath: path,
    id,
    provider,
    environmentMap,
    role: null,
    reason: undefined,
    migration: undefined,
    sync,
  };
}

function readPolicy(value: unknown, path: string): ReadPolicy {
  const record = readClosedRecord(value, POLICY_FIELDS, path);
  const mode = requireField(record, "mode", `${path}.mode`);
  if (!isOneOf(MODES, mode)) unreadable(`${path}.mode`);
  return { mode, reason: optionalString(record, "reason", `${path}.reason`) };
}

function readEntry(value: unknown, index: number): ReadEntry {
  const path = `entries[${index}]`;
  const record = readClosedRecord(value, ENTRY_FIELDS, path);

  const key = requireField(record, "key", `${path}.key`);
  if (typeof key !== "string" || !NAME_PATTERN.test(key)) unreadable(`${path}.key`);
  const required = requireField(record, "required", `${path}.required`);
  if (typeof required !== "boolean") unreadable(`${path}.required`);
  const entryClass = requireField(record, "class", `${path}.class`);
  if (!isOneOf(ENTRY_CLASSES, entryClass)) unreadable(`${path}.class`);
  const description = optionalString(record, "description", `${path}.description`);
  const group = optionalString(record, "group", `${path}.group`);

  // `purpose` and `consumers` are required, but a missing or malformed one is
  // a named semantic violation, not an unreadable declaration: the reader
  // only records whether each is usable, never its content otherwise.
  const purposeValue = record.values.purpose;
  const purpose = hasField(record, "purpose") && isNonEmptyString(purposeValue) ? purposeValue : null;
  const consumers = hasField(record, "consumers") ? readStringArray(record.values.consumers, false, false) : null;

  const hasEnvironments = hasField(record, "environments");
  const policyKeys: DeclaredEnvironment[] = [];
  const policies = new Map<DeclaredEnvironment, ReadPolicy>();
  if (hasEnvironments) {
    const environmentsPath = `${path}.environments`;
    const environments = readClosedRecord(record.values.environments, DECLARED_ENVIRONMENTS, environmentsPath);
    for (let keyIndex = 0; keyIndex < environments.keys.length; keyIndex += 1) {
      const environment = environments.keys[keyIndex];
      if (!isOneOf(DECLARED_ENVIRONMENTS, environment)) unreadable(environmentsPath);
      policyKeys.push(environment);
      policies.set(environment, readPolicy(environments.values[environment], `${environmentsPath}.${environment}`));
    }
  }

  const deliveryTargets = readStringArray(
    requireField(record, "deliveryTargets", `${path}.deliveryTargets`),
    true,
    false,
  );
  if (deliveryTargets === null) unreadable(`${path}.deliveryTargets`);

  return {
    index,
    key,
    required,
    description,
    group,
    entryClass,
    purpose,
    consumers,
    hasEnvironments,
    policyKeys,
    policies,
    deliveryTargets,
  };
}

/**
 * Reads the whole declaration structurally, or throws `Unreadable` at the
 * first structural problem. Every value it returns was copied out of an
 * own-data descriptor, so nothing downstream ever touches the caller's
 * object again.
 */
function readDeclaration(value: unknown): ReadDeclaration {
  const record = readClosedRecord(value, DECLARATION_FIELDS, undefined);
  if (requireField(record, "version", "version") !== 2) unreadable("version");

  const environments = readStringArray(requireField(record, "environments", "environments"), false, true);
  if (environments === null) unreadable("environments");
  const declaredEnvironments: DeclaredEnvironment[] = [];
  for (let index = 0; index < environments.length; index += 1) {
    const environment = environments[index];
    if (!isOneOf(DECLARED_ENVIRONMENTS, environment)) unreadable("environments");
    declaredEnvironments.push(environment);
  }
  if (!includesString(declaredEnvironments, "production")) unreadable("environments");

  const source = readSource(requireField(record, "source", "source"));

  const targetValues = requireDenseArray(requireField(record, "deliveryTargets", "deliveryTargets"), true, "deliveryTargets");
  const locationIds = new Set<string>([source.id]);
  const targets: ReadLocation[] = [];
  for (let index = 0; index < targetValues.length; index += 1) {
    const target = readTarget(targetValues[index], index);
    if (locationIds.has(target.id)) unreadable(`deliveryTargets[${index}].id`);
    locationIds.add(target.id);
    targets.push(target);
  }

  const entryValues = requireDenseArray(requireField(record, "entries", "entries"), false, "entries");
  const keys = new Set<string>();
  const entries: ReadEntry[] = [];
  for (let index = 0; index < entryValues.length; index += 1) {
    const entry = readEntry(entryValues[index], index);
    if (keys.has(entry.key)) unreadable(`entries[${index}].key`);
    keys.add(entry.key);
    entries.push(entry);
  }

  return { environments: declaredEnvironments, source, targets, entries };
}

type DeclarationRead = { readonly ok: true; readonly declaration: ReadDeclaration } | { readonly ok: false; readonly finding: SecretEnvironmentsFinding };

function tryReadDeclaration(value: unknown): DeclarationRead {
  try {
    return { ok: true, declaration: readDeclaration(value) };
  } catch (error) {
    // A structural problem carries a known-field path; anything else (a
    // hostile proxy trap) carries none. Neither carries the offending text.
    const path = error instanceof Unreadable ? error.path : undefined;
    return { ok: false, finding: finding("declaration-unreadable", path) };
  }
}

// ---------------------------------------------------------------------------
// Semantic rules over a structurally readable declaration
// ---------------------------------------------------------------------------

function mapEnvironmentsNotDeclared(
  location: ReadLocation,
  declared: readonly DeclaredEnvironment[],
  findings: SecretEnvironmentsFinding[],
): void {
  const keys = location.environmentMap.keys;
  for (let index = 0; index < keys.length; index += 1) {
    const environment = keys[index] as DeclaredEnvironment;
    if (!includesString(declared, environment)) {
      findings.push(finding("environment-not-declared", `${location.declarationPath}.environmentMap.${environment}`));
    }
  }
}

function policyModeOf(entry: ReadEntry, environment: DeclaredEnvironment): EnvironmentMode {
  const policy = entry.policies.get(environment);
  if (policy !== undefined) return policy.mode;
  return entry.entryClass === "secret" ? "separate" : "shared";
}

function entryExpectedAtLocation(location: ReadLocation, entry: ReadEntry, environment: DeclaredEnvironment): boolean {
  if (policyModeOf(entry, environment) === "absent") return false;
  return location.kind === "target" || entry.entryClass === "secret" || location.role === "hosting-as-source";
}

/** Every top-level declared environment must appear in each location's environmentMap. */
function mapDeclaredEnvironmentsMissing(declaration: ReadDeclaration, findings: SecretEnvironmentsFinding[]): void {
  const locations: ReadLocation[] = [declaration.source, ...declaration.targets];
  for (let locationIndex = 0; locationIndex < locations.length; locationIndex += 1) {
    const location = locations[locationIndex] as ReadLocation;
    for (let environmentIndex = 0; environmentIndex < declaration.environments.length; environmentIndex += 1) {
      const environment = declaration.environments[environmentIndex] as DeclaredEnvironment;
      if (location.environmentMap.values.has(environment)) continue;
      for (let entryIndex = 0; entryIndex < declaration.entries.length; entryIndex += 1) {
        const entry = declaration.entries[entryIndex] as ReadEntry;
        if (location.kind === "target" && !includesString(entry.deliveryTargets, location.id)) continue;
        if (!entry.required || !entryExpectedAtLocation(location, entry, environment)) continue;
        findings.push(finding("declared-environment-missing", `${location.id}/${environment}/${entry.key}`));
      }
    }
  }
}

function semanticFindings(declaration: ReadDeclaration): SecretEnvironmentsFinding[] {
  const findings: SecretEnvironmentsFinding[] = [];
  const { source } = declaration;

  if (
    (source.role === "secret-manager" && source.provider !== "infisical") ||
    (source.role === "hosting-as-source" && source.provider === "infisical")
  ) {
    findings.push(finding("source-role-provider-mismatch", "source.role"));
  }
  if (source.role === "hosting-as-source" && !(isNonEmptyString(source.reason) && isNonEmptyString(source.migration))) {
    findings.push(finding("hosting-source-without-exception", "source"));
  }

  mapEnvironmentsNotDeclared(source, declaration.environments, findings);
  mapDeclaredEnvironmentsMissing(declaration, findings);
  const targetIds = new Set<string>();
  for (let index = 0; index < declaration.targets.length; index += 1) {
    const target = declaration.targets[index] as ReadLocation;
    targetIds.add(target.id);
    mapEnvironmentsNotDeclared(target, declaration.environments, findings);
  }

  for (let index = 0; index < declaration.entries.length; index += 1) {
    const entry = declaration.entries[index] as ReadEntry;
    const path = `entries[${entry.index}]`;
    for (let keyIndex = 0; keyIndex < entry.policyKeys.length; keyIndex += 1) {
      const environment = entry.policyKeys[keyIndex] as DeclaredEnvironment;
      if (!includesString(declaration.environments, environment)) {
        findings.push(finding("environment-not-declared", `${path}.environments.${environment}`));
      }
    }
    for (let targetIndex = 0; targetIndex < entry.deliveryTargets.length; targetIndex += 1) {
      if (!targetIds.has(entry.deliveryTargets[targetIndex] as string)) {
        findings.push(finding("unknown-delivery-target", `${path}.deliveryTargets[${targetIndex}]`));
      }
    }
    if (entry.purpose === null) findings.push(finding("missing-purpose", `${path}.purpose`));
    if (entry.consumers === null) findings.push(finding("missing-consumers", `${path}.consumers`));
    if (entry.entryClass === "secret") {
      for (let keyIndex = 0; keyIndex < entry.policyKeys.length; keyIndex += 1) {
        const environment = entry.policyKeys[keyIndex] as DeclaredEnvironment;
        const policy = entry.policies.get(environment);
        if (policy === undefined || isNonEmptyString(policy.reason)) continue;
        if (policy.mode === "shared") findings.push(finding("shared-without-reason", `${path}.environments.${environment}`));
        if (policy.mode === "absent") findings.push(finding("absent-without-reason", `${path}.environments.${environment}`));
      }
    }
  }
  return findings;
}

function freezeFindings(findings: readonly SecretEnvironmentsFinding[]): readonly SecretEnvironmentsFinding[] {
  const copy: SecretEnvironmentsFinding[] = [];
  for (let index = 0; index < findings.length; index += 1) copy[index] = findings[index] as SecretEnvironmentsFinding;
  return Object.freeze(copy);
}

/** Every declaration problem; empty when the declaration is readable and valid. Never throws. */
export function validateSecretDeclaration(value: unknown): readonly SecretEnvironmentsFinding[] {
  try {
    const read = tryReadDeclaration(value);
    if (!read.ok) return freezeFindings([read.finding]);
    return freezeFindings(semanticFindings(read.declaration));
  } catch {
    return freezeFindings([finding("declaration-unreadable")]);
  }
}

function ruleIdList(findings: readonly SecretEnvironmentsFinding[]): string {
  const seen = new Set<string>();
  let list = "";
  for (let index = 0; index < findings.length; index += 1) {
    const rule = (findings[index] as SecretEnvironmentsFinding).rule;
    if (seen.has(rule)) continue;
    seen.add(rule);
    list += list === "" ? rule : `, ${rule}`;
  }
  return list;
}

/**
 * Validates, then re-reads the declaration from scratch. Throws a
 * `RangeError` whose message names rule ids only — never a path, key, or
 * value — so an error that ends up in a log discloses nothing the caller
 * passed in.
 */
function readValidDeclaration(declaration: unknown, verb: string): ReadDeclaration {
  const findings = validateSecretDeclaration(declaration);
  if (findings.length > 0) throw new RangeError(`secret declaration cannot be ${verb}: ${ruleIdList(findings)}`);
  const read = tryReadDeclaration(declaration);
  if (!read.ok) throw new RangeError(`secret declaration cannot be ${verb}: ${read.finding.rule}`);
  return read.declaration;
}

function environmentMapCopy(map: ReadEnvironmentMap): EnvironmentMap {
  const copy: Partial<Record<DeclaredEnvironment, string>> = {};
  for (let index = 0; index < map.keys.length; index += 1) {
    const environment = map.keys[index] as DeclaredEnvironment;
    copy[environment] = map.values.get(environment) as string;
  }
  return Object.freeze(copy);
}

function freezeStrings<T extends string>(values: readonly T[]): readonly T[] {
  const copy: T[] = [];
  for (let index = 0; index < values.length; index += 1) copy[index] = values[index] as T;
  return Object.freeze(copy);
}

function declarationCopy(read: ReadDeclaration): SecretDeclaration {
  const { source } = read;
  const sourceCopy: SecretSource = Object.freeze({
    id: source.id,
    provider: source.provider,
    role: source.role as SecretSourceRole,
    environmentMap: environmentMapCopy(source.environmentMap),
    ...(source.reason === undefined ? {} : { reason: source.reason }),
    ...(source.migration === undefined ? {} : { migration: source.migration }),
  });

  const targets: SecretDeliveryTarget[] = [];
  for (let index = 0; index < read.targets.length; index += 1) {
    const target = read.targets[index] as ReadLocation;
    targets[index] = Object.freeze({
      id: target.id,
      provider: target.provider,
      environmentMap: environmentMapCopy(target.environmentMap),
      sync: target.sync as DeliverySync,
    });
  }

  const entries: SecretDeclarationEntry[] = [];
  for (let index = 0; index < read.entries.length; index += 1) {
    const entry = read.entries[index] as ReadEntry;
    let environments: Partial<Record<DeclaredEnvironment, SecretEnvironmentPolicy>> | undefined;
    if (entry.hasEnvironments) {
      environments = {};
      for (let keyIndex = 0; keyIndex < entry.policyKeys.length; keyIndex += 1) {
        const environment = entry.policyKeys[keyIndex] as DeclaredEnvironment;
        const policy = entry.policies.get(environment) as ReadPolicy;
        environments[environment] = Object.freeze(
          policy.reason === undefined ? { mode: policy.mode } : { mode: policy.mode, reason: policy.reason },
        );
      }
      Object.freeze(environments);
    }
    entries[index] = Object.freeze({
      key: entry.key,
      required: entry.required,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.group === undefined ? {} : { group: entry.group }),
      class: entry.entryClass,
      purpose: entry.purpose as string,
      consumers: freezeStrings(entry.consumers as readonly string[]),
      ...(environments === undefined ? {} : { environments }),
      deliveryTargets: freezeStrings(entry.deliveryTargets),
    });
  }

  return Object.freeze({
    version: 2 as const,
    environments: freezeStrings(read.environments),
    source: sourceCopy,
    deliveryTargets: Object.freeze(targets),
    entries: Object.freeze(entries),
  });
}

/**
 * Returns a frozen, normalized copy; throws RangeError (naming rule ids only)
 * unless valid. The copy is built from a fresh accessor-safe read — never
 * from direct `declaration.field` access — and is re-validated before it is
 * returned, so a declaration that changed underneath this call is refused
 * rather than silently accepted. "Normalized" means rebuilt with exactly the
 * declared fields and nothing else; omitted environment policies stay
 * omitted and keep their class default (`separate` for a secret).
 */
export function defineSecretDeclaration(declaration: SecretDeclaration): SecretDeclaration {
  const read = readValidDeclaration(declaration, "defined");
  const copy = declarationCopy(read);
  const recheck = validateSecretDeclaration(copy);
  if (recheck.length > 0) throw new RangeError(`secret declaration cannot be defined: ${ruleIdList(recheck)}`);
  return copy;
}

/**
 * The version-1 catalog projection (key/required/description/group), the
 * identical shape `defineSecretCatalog` produces, so every existing
 * version-1 consumer keeps working against a version-2 declaration. Throws
 * RangeError unless valid.
 */
export function projectSecretCatalog(declaration: SecretDeclaration): SecretCatalog {
  const read = readValidDeclaration(declaration, "projected");
  const entries: SecretCatalogEntry[] = [];
  for (let index = 0; index < read.entries.length; index += 1) {
    const entry = read.entries[index] as ReadEntry;
    entries[index] = Object.freeze({
      key: entry.key,
      required: entry.required,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.group === undefined ? {} : { group: entry.group }),
    });
  }
  return Object.freeze({ version: 1 as const, entries: Object.freeze(entries) });
}

// ---------------------------------------------------------------------------
// Inventory reading
// ---------------------------------------------------------------------------

interface ReadRecord {
  /** Unique across every snapshot in one evaluation; two observations of one record always share a value. */
  readonly recordId: number;
  readonly name: string;
  readonly environments: readonly string[];
  readonly storage: InventoryStorage;
  /** Compared for equality only. Never copied into a finding. */
  readonly identity: string | undefined;
}

interface ReadSnapshot {
  readonly provider: SecretLocationProvider;
  readonly location: string;
  readonly environments: readonly string[];
  readonly entries: readonly ReadRecord[];
}

function isObservedAt(value: unknown): boolean {
  return typeof value === "string" && OBSERVED_AT_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

/** Reads one snapshot, or returns `null` for any problem at all. Never carries content out on failure. */
function readSnapshot(value: unknown, nextRecordId: () => number): ReadSnapshot | null {
  const record = readOwnDataRecord(value);
  if (record === null || !hasOnlyFields(record, SNAPSHOT_FIELDS)) return null;
  for (let index = 0; index < SNAPSHOT_FIELDS.length; index += 1) {
    if (!hasField(record, SNAPSHOT_FIELDS[index] as string)) return null;
  }
  const { version, provider, location, observedAt } = record.values;
  if (version !== 1 || !isOneOf(PROVIDERS, provider) || !isNonEmptyString(location) || !isObservedAt(observedAt)) return null;
  const environments = readStringArray(record.values.environments, false, true);
  if (environments === null) return null;
  const entryValues = readDenseArray(record.values.entries, true);
  if (entryValues === null) return null;

  const entries: ReadRecord[] = [];
  for (let index = 0; index < entryValues.length; index += 1) {
    const entry = readOwnDataRecord(entryValues[index]);
    if (entry === null || !hasOnlyFields(entry, INVENTORY_ENTRY_FIELDS)) return null;
    const { name, storage, identity } = entry.values;
    if (typeof name !== "string" || !NAME_PATTERN.test(name)) return null;
    if (!isOneOf(STORAGES, storage)) return null;
    const hasIdentity = hasField(entry, "identity");
    if (hasIdentity && !isNonEmptyString(identity)) return null;
    const entryEnvironments = readStringArray(entry.values.environments, false, true);
    if (entryEnvironments === null) return null;
    for (let environmentIndex = 0; environmentIndex < entryEnvironments.length; environmentIndex += 1) {
      if (!includesString(environments, entryEnvironments[environmentIndex] as string)) return null;
    }
    entries.push({
      recordId: nextRecordId(),
      name,
      environments: entryEnvironments,
      storage,
      identity: hasIdentity ? (identity as string) : undefined,
    });
  }
  return { provider, location, environments, entries };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

interface MappedEnvironment {
  readonly environment: DeclaredEnvironment;
  readonly providerEnvironment: string;
}

interface LocationState {
  readonly location: ReadLocation;
  /** Declared environments present in the location's map, in top-level `environments` order. */
  readonly mapped: readonly MappedEnvironment[];
  readonly mappedProviderEnvironments: ReadonlySet<string>;
  /** Entries delivered here, in declaration order: every entry at the source, listing entries at a target. */
  readonly keys: readonly ReadEntry[];
  readonly keyIndex: ReadonlyMap<string, ReadEntry>;
  /** Provider environments some matched snapshot observed. */
  readonly covered: Set<string>;
  readonly records: ReadRecord[];
}

interface Observation {
  readonly recordId: number;
  readonly state: LocationState;
  readonly provider: SecretLocationProvider;
  readonly name: string;
  readonly identity: string | undefined;
  readonly environments: readonly DeclaredEnvironment[];
}

function modeOf(entry: ReadEntry, environment: DeclaredEnvironment): EnvironmentMode {
  const policy = entry.policies.get(environment);
  if (policy !== undefined) return policy.mode;
  return entry.entryClass === "secret" ? "separate" : "shared";
}

function locationState(location: ReadLocation, declaration: ReadDeclaration): LocationState {
  const mapped: MappedEnvironment[] = [];
  const mappedProviderEnvironments = new Set<string>();
  for (let index = 0; index < declaration.environments.length; index += 1) {
    const environment = declaration.environments[index] as DeclaredEnvironment;
    const providerEnvironment = location.environmentMap.values.get(environment);
    if (providerEnvironment === undefined) continue;
    mapped.push({ environment, providerEnvironment });
    mappedProviderEnvironments.add(providerEnvironment);
  }
  const keys: ReadEntry[] = [];
  const keyIndex = new Map<string, ReadEntry>();
  for (let index = 0; index < declaration.entries.length; index += 1) {
    const entry = declaration.entries[index] as ReadEntry;
    if (location.kind === "source" || includesString(entry.deliveryTargets, location.id)) {
      keys.push(entry);
      keyIndex.set(entry.key, entry);
    }
  }
  return { location, mapped, mappedProviderEnvironments, keys, keyIndex, covered: new Set(), records: [] };
}

function observedInMapped(record: ReadRecord, state: LocationState): boolean {
  for (let index = 0; index < record.environments.length; index += 1) {
    if (state.mappedProviderEnvironments.has(record.environments[index] as string)) return true;
  }
  return false;
}

function isPresent(state: LocationState, key: string, providerEnvironment: string): boolean {
  for (let index = 0; index < state.records.length; index += 1) {
    const record = state.records[index] as ReadRecord;
    if (record.name === key && includesString(record.environments, providerEnvironment)) return true;
  }
  return false;
}

/** Rule 1: two declared environments mapped onto one provider environment, where a secret must stay separate. */
function mergedEnvironmentFindings(state: LocationState, emit: (finding: SecretEnvironmentsFinding) => void): void {
  const groups = new Map<string, DeclaredEnvironment[]>();
  for (let index = 0; index < state.mapped.length; index += 1) {
    const { environment, providerEnvironment } = state.mapped[index] as MappedEnvironment;
    const group = groups.get(providerEnvironment);
    if (group === undefined) groups.set(providerEnvironment, [environment]);
    else group.push(environment);
  }
  groups.forEach((group) => {
    if (group.length < 2) return;
    for (let keyIndex = 0; keyIndex < state.keys.length; keyIndex += 1) {
      const entry = state.keys[keyIndex] as ReadEntry;
      if (entry.entryClass !== "secret") continue;
      let separate = false;
      for (let index = 0; index < group.length; index += 1) {
        if (modeOf(entry, group[index] as DeclaredEnvironment) === "separate") separate = true;
      }
      if (separate) emit(finding("location-merges-environments", `${state.location.id}/${group.join("+")}/${entry.key}`));
    }
  });
}

/** Rules 2 and 3: per mapped environment, unobserved, or each delivered key's presence against its mode. */
function presenceFindings(state: LocationState, emit: (finding: SecretEnvironmentsFinding) => void): void {
  const { location } = state;
  for (let index = 0; index < state.mapped.length; index += 1) {
    const { environment, providerEnvironment } = state.mapped[index] as MappedEnvironment;
    if (!state.covered.has(providerEnvironment)) {
      emit(finding("location-unobserved", `${location.id}/${environment}`));
      continue;
    }
    for (let keyIndex = 0; keyIndex < state.keys.length; keyIndex += 1) {
      const entry = state.keys[keyIndex] as ReadEntry;
      const mode = modeOf(entry, environment);
      const present = isPresent(state, entry.key, providerEnvironment);
      const path = `${location.id}/${environment}/${entry.key}`;
      if (mode === "absent") {
        if (present) emit(finding("absent-environment-present", path));
        continue;
      }
      // At the source, only a secret (or anything, when a hosting provider is
      // itself the source) must be present: a secret-manager source is not
      // required to hold non-secret configuration.
      const expectedHere =
        location.kind === "target" || entry.entryClass === "secret" || location.role === "hosting-as-source";
      if (entry.required && !present && expectedHere) emit(finding("declared-environment-missing", path));
    }
  }
}

/** Rule 4: a name at this location that the declaration does not place here, including in unmapped provider environments. */
function undeclaredNameFindings(state: LocationState, emit: (finding: SecretEnvironmentsFinding) => void): void {
  for (let index = 0; index < state.records.length; index += 1) {
    const record = state.records[index] as ReadRecord;
    const inMapped = observedInMapped(record, state);
    if (state.keyIndex.has(record.name) && inMapped) continue;
    emit(finding("undeclared-name", `${state.location.id}/${record.name}`));
  }
}

/** Rule 5: how a delivered secret is stored where it was observed. */
function storageFindings(state: LocationState, emit: (finding: SecretEnvironmentsFinding) => void): void {
  const { location } = state;
  for (let index = 0; index < state.records.length; index += 1) {
    const record = state.records[index] as ReadRecord;
    const entry = state.keyIndex.get(record.name);
    if (entry === undefined || entry.entryClass !== "secret" || !observedInMapped(record, state)) continue;
    const path = `${location.id}/${record.name}`;
    if (record.storage === "readable" || record.storage === "plain") {
      emit(finding("secret-stored-readable", path));
    } else if (record.storage === "unknown") {
      emit(finding("storage-unobserved", path));
    } else if (record.storage === "managed" && !(location.kind === "source" && location.role === "secret-manager")) {
      emit(finding("storage-unobserved", path, MANAGED_OUTSIDE_SECRET_MANAGER_MESSAGE));
    }
  }
}

function observationsOf(states: readonly LocationState[]): Observation[] {
  const observations: Observation[] = [];
  for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
    const state = states[stateIndex] as LocationState;
    for (let recordIndex = 0; recordIndex < state.records.length; recordIndex += 1) {
      const record = state.records[recordIndex] as ReadRecord;
      for (let environmentIndex = 0; environmentIndex < record.environments.length; environmentIndex += 1) {
        const providerEnvironment = record.environments[environmentIndex] as string;
        const environments: DeclaredEnvironment[] = [];
        for (let mappedIndex = 0; mappedIndex < state.mapped.length; mappedIndex += 1) {
          const mapped = state.mapped[mappedIndex] as MappedEnvironment;
          if (mapped.providerEnvironment === providerEnvironment) environments.push(mapped.environment);
        }
        if (environments.length === 0) continue;
        observations.push({
          recordId: record.recordId,
          state,
          provider: state.location.provider,
          name: record.name,
          identity: record.identity,
          environments,
        });
      }
    }
  }
  return observations;
}

function sharesValue(x: Observation, y: Observation): boolean {
  if (x === y) return false;
  if (x.recordId === y.recordId) return true;
  return x.identity !== undefined && y.identity !== undefined && x.provider === y.provider && x.identity === y.identity;
}

/**
 * Rule 6: a key declared separate in E whose stored value is also what
 * another environment E' sees — one record spanning both, or two records the
 * provider reports as one stored value. The identity is compared here and
 * nowhere else; the finding carries only the location, environment, and key.
 */
function sharedIdentityFindings(
  state: LocationState,
  observations: readonly Observation[],
  emit: (finding: SecretEnvironmentsFinding) => void,
): void {
  for (let xIndex = 0; xIndex < observations.length; xIndex += 1) {
    const x = observations[xIndex] as Observation;
    if (x.state !== state) continue;
    const entry = state.keyIndex.get(x.name);
    if (entry === undefined) continue;
    for (let yIndex = 0; yIndex < observations.length; yIndex += 1) {
      const y = observations[yIndex] as Observation;
      if (!sharesValue(x, y)) continue;
      for (let eIndex = 0; eIndex < x.environments.length; eIndex += 1) {
        const environment = x.environments[eIndex] as DeclaredEnvironment;
        if (modeOf(entry, environment) !== "separate") continue;
        let crosses = false;
        for (let otherIndex = 0; otherIndex < y.environments.length; otherIndex += 1) {
          if (y.environments[otherIndex] !== environment) crosses = true;
        }
        if (crosses) emit(finding("separate-shares-identity", `${state.location.id}/${environment}/${x.name}`));
      }
    }
  }
}

function verdictOf(findings: readonly SecretEnvironmentsFinding[]): SecretEnvironmentsVerdict {
  let indeterminate = false;
  for (let index = 0; index < findings.length; index += 1) {
    const item = findings[index] as SecretEnvironmentsFinding;
    if (INDETERMINATE_RULES.has(item.rule)) indeterminate = true;
    else if (item.severity === "error") return "violated";
  }
  return indeterminate ? "indeterminate" : "satisfied";
}

function evaluationOf(findings: readonly SecretEnvironmentsFinding[]): SecretEnvironmentsEvaluation {
  const verdict = verdictOf(findings);
  return Object.freeze({ verdict, exitCode: EXIT_CODES[verdict], findings: freezeFindings(findings) });
}

function evaluateUnchecked(input: unknown): SecretEnvironmentsEvaluation {
  const inputRecord = readOwnDataRecord(input);
  if (inputRecord === null || !hasOnlyFields(inputRecord, INPUT_FIELDS)) {
    return evaluationOf([finding("declaration-unreadable")]);
  }
  const read = tryReadDeclaration(inputRecord.values.declaration);
  if (!read.ok) return evaluationOf([read.finding]);
  const declaration = read.declaration;

  const findings: SecretEnvironmentsFinding[] = [];
  const seen = new Set<string>();
  const emit = (item: SecretEnvironmentsFinding): void => {
    const identityOfFinding = `${item.rule}\u0000${item.path ?? ""}`;
    if (seen.has(identityOfFinding)) return;
    seen.add(identityOfFinding);
    findings.push(item);
  };

  const declarationFindings = semanticFindings(declaration);
  for (let index = 0; index < declarationFindings.length; index += 1) emit(declarationFindings[index] as SecretEnvironmentsFinding);

  const states: LocationState[] = [locationState(declaration.source, declaration)];
  for (let index = 0; index < declaration.targets.length; index += 1) {
    states.push(locationState(declaration.targets[index] as ReadLocation, declaration));
  }

  let recordCounter = 0;
  const nextRecordId = (): number => {
    recordCounter += 1;
    return recordCounter;
  };
  let snapshots: readonly unknown[] | null;
  try {
    snapshots = hasField(inputRecord, "inventories") ? readDenseArray(inputRecord.values.inventories, true) : null;
  } catch {
    // A hostile proxy trap on the inventories array is an unreadable
    // inventory set, not an unreadable declaration.
    snapshots = null;
  }
  if (snapshots === null) {
    emit(finding("inventory-unreadable", "inventories"));
  } else {
    for (let index = 0; index < snapshots.length; index += 1) {
      let snapshot: ReadSnapshot | null;
      try {
        snapshot = readSnapshot(snapshots[index], nextRecordId);
      } catch {
        snapshot = null;
      }
      if (snapshot === null) {
        emit(finding("inventory-unreadable", `inventories[${index}]`));
        continue;
      }
      let state: LocationState | undefined;
      for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
        const candidate = states[stateIndex] as LocationState;
        if (candidate.location.id === snapshot.location) state = candidate;
      }
      if (state === undefined || state.location.provider !== snapshot.provider) {
        emit(finding("inventory-unmatched", `inventories[${index}]`));
        continue;
      }
      for (let environmentIndex = 0; environmentIndex < snapshot.environments.length; environmentIndex += 1) {
        state.covered.add(snapshot.environments[environmentIndex] as string);
      }
      for (let recordIndex = 0; recordIndex < snapshot.entries.length; recordIndex += 1) {
        state.records.push(snapshot.entries[recordIndex] as ReadRecord);
      }
    }
    if (snapshots.length === 0) emit(finding("inventories-empty", "inventories"));
  }

  const observations = observationsOf(states);
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index] as LocationState;
    mergedEnvironmentFindings(state, emit);
    presenceFindings(state, emit);
    undeclaredNameFindings(state, emit);
    storageFindings(state, emit);
    sharedIdentityFindings(state, observations, emit);
    if (state.location.sync === "manual") emit(finding("manual-sync", state.location.id));
  }

  return evaluationOf(findings);
}

/**
 * Reconciles a declaration with names-only inventory snapshots. Never
 * throws: a hostile proxy trap anywhere on the input (which the accessor-
 * safe reads above still invoke, though they never run a getter) lands in
 * this outer boundary and reports `indeterminate`, the same boundary
 * `provider-custody.ts`'s `evaluateProviderCustody` keeps.
 */
export function evaluateSecretEnvironments(input: SecretEnvironmentsInput): SecretEnvironmentsEvaluation {
  try {
    return evaluateUnchecked(input);
  } catch {
    return evaluationOf([finding("declaration-unreadable")]);
  }
}

const SUMMARY: Readonly<Record<SecretEnvironmentsVerdict, string>> = Object.freeze({
  satisfied:
    "Every declared secret and setting is where the declaration says it should be, and no environment that must stay separate shares a value with another.",
  violated:
    "The secret declaration and what the providers actually hold disagree in at least one way that must be fixed before this check can pass.",
  indeterminate:
    "This check could not reach a verdict because the declaration or an inventory could not be read, matched, or observed for every declared location.",
});

const NEXT_ACTION: Readonly<Record<Exclude<SecretEnvironmentsVerdict, "satisfied">, string>> = Object.freeze({
  violated: "Resolve every listed violation in the secret manager, the delivery targets, or the declaration, then re-run this check.",
  indeterminate:
    "Supply a readable declaration and a readable names-only inventory for every declared location and environment, then re-run this check.",
});

/**
 * The docs/contracts/check-output-envelope.json report (a repository contract
 * that does not ship with this package), built with `buildCheckOutputEnvelope`
 * so the contract's own hard rules are enforced at construction time.
 * `packageVersion` is caller-supplied (the CLI reads it once from this
 * package's `package.json`), keeping this function pure.
 */
export function secretEnvironmentsReport(input: SecretEnvironmentsInput, packageVersion: string): CheckOutputEnvelope {
  const evaluated = evaluateSecretEnvironments(input);
  return buildCheckOutputEnvelope({
    package: "@clossys/locksmith",
    version: packageVersion,
    verdict: evaluated.verdict,
    summary: SUMMARY[evaluated.verdict],
    findings: evaluated.findings,
    ...(evaluated.verdict === "satisfied" ? {} : { nextAction: NEXT_ACTION[evaluated.verdict] }),
  });
}
