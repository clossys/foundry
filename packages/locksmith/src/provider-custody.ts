import type { SecretKey } from "./types.js";
import type { CustodyStore } from "./custody.js";
import { hasField, hasOnlyFields, isNonEmptyString, readOwnDataRecord } from "./credential.js";
import type { OwnDataRecord } from "./credential.js";

/**
 * The providers this custody-ladder slice can currently judge (issue #1212).
 * Extend deliberately when a new provider is covered; arbitrary provider
 * strings are not evidence of bounded custody.
 */
export type ProviderName = "cloudflare" | "vercel" | "github";

/**
 * The custody ladder: three closed ways a provider token can be held.
 * Ordered here from least automatable to most, not from "worst" to "best" —
 * Locksmith never asserts that one rung is universally right for a given
 * token; it asserts only that a declaration is internally consistent with
 * one of these three, and requires the declarer's own least-privilege
 * reasoning ({@link ProviderCustodyDeclaration.leastPrivilegeNote}) for why
 * THIS token sits at THIS rung.
 *
 * - `operator-interactive` — the token (or session) lives only on the
 *   human's own machine, inside the provider CLI's own credential store
 *   (`wrangler login`, `vercel login`, `gh auth login`, ...). It never
 *   reaches this repository, an agent-readable file, or a CI system. An
 *   agent may run the provider CLI atop a session the human already
 *   established and approved for that action — the human holds intent and
 *   authority, the agent performs the generative/live-system work; see the
 *   plane's own governing-principle split (owner-confirmed, #1187).
 * - `scoped-environment-secret` — a CI secret bound to one named,
 *   reviewer-gated deployment environment (the same "environment" concept
 *   GitHub Actions and most CI providers already support: a named target
 *   with its own required reviewers, gating the job before it can even
 *   start), injected only into the job/step(s) named in
 *   {@link ProviderCustodyDeclaration.usedBy}. The value still exists
 *   somewhere outside the human's own machine; this rung trades that for
 *   automation, gated behind a required review.
 * - `federated-oidc` — no static secret value exists anywhere. A workflow
 *   exchanges a short-lived, provider-trusted OIDC token for provider access
 *   at request time — the same shape an npm trusted-publisher upload already
 *   uses for a different provider (this package's own repository has one;
 *   it is not shipped as part of this package and is not cited here).
 */
export type CustodyRung = "operator-interactive" | "scoped-environment-secret" | "federated-oidc";

/**
 * A value-free custody declaration for one provider token.
 *
 * - `store` names WHERE the value lives. It is free text — Locksmith cannot
 *   see a provider's console or a password manager's contents — but a small,
 *   documented set of literal values that describe committing the value TO
 *   THIS REPOSITORY (`"repository"`, `"repo"`, `".env"`, `"source"`,
 *   `"committed"`, `"git"`, case-insensitive) always fails
 *   {@link evaluateProviderCustody} with `store-is-repository`. That check is
 *   deliberately narrow: it catches the most literal violations of "never
 *   the repository" mechanically, and does not claim to catch every way a
 *   value could still end up there.
 * - `scope` is free text naming the least-privilege grant actually
 *   configured on the provider side. Locksmith cannot verify that scope
 *   against the provider — only that one was written down.
 * - `leastPrivilegeNote` is the declarer's own required justification for
 *   why this rung and this scope are the narrowest that still work. An
 *   empty or missing note is a violation, the same convention this
 *   repository already uses for a denylist term's `boundaryJustification`
 *   and a qualification deferral's `reason`: an exception without a written
 *   reason is treated as no exception at all.
 * - `usedBy` names the job(s), workflow(s), or script(s) that actually
 *   consume this token — the same "who is allowed to resolve this" question
 *   `distribution.ts`'s `DistributionManifest` already answers for ordinary
 *   secrets, asked here for a provider token specifically.
 * - `rotationPolicy` is optional and, when present, is the identical
 *   `{ maxAgeDays }` shape `rotation.ts` already judges staleness against —
 *   a provider token's age is judged by the same rule as every other key,
 *   not a second one invented here.
 */
export interface ProviderCustodyDeclaration {
  readonly key: SecretKey;
  readonly provider: ProviderName;
  readonly rung: CustodyRung;
  readonly owner: string;
  readonly store: CustodyStore;
  readonly scope: readonly string[];
  readonly leastPrivilegeNote: string;
  readonly usedBy: readonly string[];
  readonly rotationPolicy: { readonly maxAgeDays: number } | null;
}

export interface ProviderCustodyManifest {
  readonly version: 1;
  readonly entries: readonly ProviderCustodyDeclaration[];
}

export type ProviderCustodyVerdict = "satisfied" | "violated" | "indeterminate";
export type ProviderCustodyExitCode = 0 | 1 | 2;

export type ProviderCustodyReason =
  | "invalid-declaration"
  | "unsupported-fields"
  | "missing-key"
  | "missing-provider"
  | "unsupported-provider"
  | "missing-rung"
  | "unsupported-rung"
  | "missing-owner"
  | "missing-store"
  | "store-is-repository"
  | "missing-scope"
  | "missing-least-privilege-note"
  | "missing-used-by"
  | "invalid-rotation-policy";

export interface ProviderCustodyEvaluation {
  readonly key: SecretKey | null;
  readonly provider: ProviderName | null;
  readonly rung: CustodyRung | null;
  readonly verdict: ProviderCustodyVerdict;
  readonly exitCode: ProviderCustodyExitCode;
  readonly reasons: readonly ProviderCustodyReason[];
}

const EXIT_CODES: Readonly<Record<ProviderCustodyVerdict, ProviderCustodyExitCode>> = Object.freeze({
  satisfied: 0,
  violated: 1,
  indeterminate: 2,
});

const PROVIDERS: readonly ProviderName[] = ["cloudflare", "vercel", "github"];
const RUNGS: readonly CustodyRung[] = ["operator-interactive", "scoped-environment-secret", "federated-oidc"];

// Case-insensitive literal stores that describe committing the value to this
// repository's own tree. Narrow and documented on purpose — see this file's
// module-level `store` doc for what this check does and does not catch.
const REPOSITORY_STORE_LITERALS = new Set(["repository", "repo", ".env", "source", "committed", "git"]);

const DECLARATION_FIELDS = [
  "key",
  "provider",
  "rung",
  "owner",
  "store",
  "scope",
  "leastPrivilegeNote",
  "usedBy",
  "rotationPolicy",
] as const;

/**
 * Explicit indexed copy, never `[...values]` — a spread reads through
 * `values[Symbol.iterator]`, which is `Array.prototype[Symbol.iterator]`
 * for any ordinary array, so a caller (or a hostile test, or a genuinely
 * polluted dependency elsewhere in the process) that has overridden that
 * global would make a spread silently yield different elements than the
 * array actually holds. `credential.ts`'s own `evaluation`/`freezeScopeCopy`
 * use the identical indexed-loop shape for the same reason.
 */
function freezeStringArrayCopy<T extends string>(values: readonly T[]): readonly T[] {
  const copy: T[] = [];
  for (let index = 0; index < values.length; index += 1) copy[index] = values[index] as T;
  return Object.freeze(copy);
}

function evaluation(
  key: SecretKey | null,
  provider: ProviderName | null,
  rung: CustodyRung | null,
  verdict: ProviderCustodyVerdict,
  reasons: readonly ProviderCustodyReason[],
): ProviderCustodyEvaluation {
  return Object.freeze({
    key,
    provider,
    rung,
    verdict,
    exitCode: EXIT_CODES[verdict],
    reasons: freezeStringArrayCopy(reasons),
  });
}

function isRepositoryStore(store: string): boolean {
  const normalized = store.trim().toLowerCase();
  return REPOSITORY_STORE_LITERALS.has(normalized);
}

/**
 * Accessor-safe, prototype-pollution-resistant read of a dense array of
 * non-empty strings — `scope` and `usedBy` both accept free text, so unlike
 * `credential.ts`'s `inspectScope` this has no closed vocabulary or
 * canonical ordering to check, but it reuses the identical safety shape:
 * reject anything but a real `Array.prototype`-rooted array, confirm the
 * key count matches `length` exactly (no holes, no extra own keys), and
 * read every element through `Reflect.getOwnPropertyDescriptor` rather than
 * indexed access, so a hostile `Array.prototype.every`/`Symbol.iterator`
 * override or an accessor property planted at an index cannot influence the
 * result or run caller code.
 */
function readNonEmptyStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) return null;
  const length = lengthDescriptor.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1) return null;

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1) return null;
  for (const key of ownKeys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return null;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length) return null;
  }

  const values: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return null;
    const entry = descriptor.value;
    if (!isNonEmptyString(entry)) return null;
    values[index] = entry;
  }
  return values;
}

/**
 * Accessor-safe read of the optional `rotationPolicy` field: `null`, or a
 * closed-field record whose sole field is a finite, positive `maxAgeDays`.
 * Reads `record.values.maxAgeDays` from an already-`readOwnDataRecord`-safe
 * snapshot rather than the raw nested value, so a hostile nested getter
 * cannot run here either.
 */
function inspectRotationPolicy(value: unknown): { readonly ok: boolean } {
  if (value === null) return { ok: true };
  const record = readOwnDataRecord(value);
  if (record === null || !hasOnlyFields(record, ["maxAgeDays"])) return { ok: false };
  const maxAgeDays = record.values.maxAgeDays;
  return { ok: typeof maxAgeDays === "number" && Number.isFinite(maxAgeDays) && maxAgeDays > 0 };
}

/**
 * Judges a value-free custody declaration without reading, accepting,
 * storing, or returning a token value. Unknown fields are indeterminate, so
 * a value smuggled through an untyped caller cannot be silently accepted or
 * echoed — the same discipline, and the same accessor-safe/prototype-
 * pollution-resistant primitives (`readOwnDataRecord`, `hasOnlyFields`,
 * `isNonEmptyString`), that `credential.ts`'s `evaluateCredential` uses.
 * Every field is read from `record.values` (a `readOwnDataRecord` snapshot
 * of own data properties only), never from `declaration` directly, so a
 * throwing getter anywhere on the input cannot escape this function, and
 * `scope`/`usedBy` are read through `readNonEmptyStringArray`, never
 * `Array.prototype.every`/`.map`/iteration, so a polluted `Array.prototype`
 * cannot flip a violated declaration to `satisfied`.
 */
function evaluateProviderCustodyUnchecked(declaration: unknown): ProviderCustodyEvaluation {
  const record = readOwnDataRecord(declaration);
  if (record === null) return evaluation(null, null, null, "indeterminate", ["invalid-declaration"]);
  if (!hasOnlyFields(record, DECLARATION_FIELDS)) return evaluation(null, null, null, "indeterminate", ["unsupported-fields"]);

  const key = isNonEmptyString(record.values.key) ? record.values.key : null;
  const provider = PROVIDERS.includes(record.values.provider as ProviderName) ? (record.values.provider as ProviderName) : null;
  const rung = RUNGS.includes(record.values.rung as CustodyRung) ? (record.values.rung as CustodyRung) : null;
  const store = isNonEmptyString(record.values.store) ? record.values.store : null;
  const scope = readNonEmptyStringArray(record.values.scope);
  const usedBy = readNonEmptyStringArray(record.values.usedBy);

  const reasons: ProviderCustodyReason[] = [];
  if (key === null) reasons.push("missing-key");
  if (!hasField(record, "provider")) reasons.push("missing-provider");
  else if (provider === null) reasons.push("unsupported-provider");
  if (!hasField(record, "rung")) reasons.push("missing-rung");
  else if (rung === null) reasons.push("unsupported-rung");
  if (!isNonEmptyString(record.values.owner)) reasons.push("missing-owner");
  if (store === null) reasons.push("missing-store");
  else if (isRepositoryStore(store)) reasons.push("store-is-repository");
  if (scope === null) reasons.push("missing-scope");
  if (!isNonEmptyString(record.values.leastPrivilegeNote)) reasons.push("missing-least-privilege-note");
  if (usedBy === null) reasons.push("missing-used-by");
  if (!hasField(record, "rotationPolicy") || !inspectRotationPolicy(record.values.rotationPolicy).ok) {
    reasons.push("invalid-rotation-policy");
  }

  if (reasons.length > 0) return evaluation(key, provider, rung, "violated", reasons);
  return evaluation(key, provider, rung, "satisfied", []);
}

/**
 * Public entry point. A hostile proxy trap (a throwing `ownKeys`,
 * `getOwnPropertyDescriptor`, or similar) on `declaration` or on one of its
 * fields can still make the accessor-safe reads above throw, even though
 * none of them ever *reads a value through* such a trap -- `Reflect.ownKeys`
 * and `Reflect.getOwnPropertyDescriptor` faithfully invoke a proxy's own
 * traps, they just never invoke a getter. This outer boundary is the same
 * one `credential.ts`'s public `evaluateCredential` wraps
 * `evaluateCredentialUnchecked` in, for the identical reason: nothing here
 * should ever throw out to a caller, only ever report `indeterminate`.
 */
export function evaluateProviderCustody(declaration: unknown): ProviderCustodyEvaluation {
  try {
    return evaluateProviderCustodyUnchecked(declaration);
  } catch {
    return evaluation(null, null, null, "indeterminate", ["invalid-declaration"]);
  }
}

function reasonSummary(reasons: readonly ProviderCustodyReason[]): string {
  return reasons.join(", ");
}

const INVALID_DEFINITION_SNAPSHOT = Symbol("invalid provider custody definition snapshot");

function rejectDefinitionSnapshot(): never {
  throw INVALID_DEFINITION_SNAPSHOT;
}

/**
 * Frozen, value-free authoring helper for callers that already have a typed
 * declaration. Throws if it does not evaluate `satisfied`. Mirrors
 * `credential.ts`'s `defineCredentialEvidence`: it re-derives the frozen
 * snapshot from a fresh `readOwnDataRecord`/`readNonEmptyStringArray` read
 * (never from direct `declaration.field` access) and re-evaluates that exact
 * snapshot, so a value that changed underneath this call between the first
 * check and the read that builds the frozen result is refused rather than
 * silently accepted.
 */
export function defineProviderCustody(declaration: ProviderCustodyDeclaration): ProviderCustodyDeclaration {
  const evaluated = evaluateProviderCustody(declaration);
  if (evaluated.verdict !== "satisfied") {
    throw new RangeError(`provider custody declaration is ${evaluated.verdict}: ${reasonSummary(evaluated.reasons)}`);
  }
  try {
    const record = readOwnDataRecord(declaration);
    if (record === null) rejectDefinitionSnapshot();
    const scope = readNonEmptyStringArray(record.values.scope);
    const usedBy = readNonEmptyStringArray(record.values.usedBy);
    if (scope === null || usedBy === null) rejectDefinitionSnapshot();
    const rotationPolicyValue = record.values.rotationPolicy;
    let rotationPolicy: { readonly maxAgeDays: number } | null;
    if (rotationPolicyValue === null) {
      rotationPolicy = null;
    } else {
      const policyRecord = readOwnDataRecord(rotationPolicyValue);
      if (policyRecord === null || !hasOnlyFields(policyRecord, ["maxAgeDays"]) || typeof policyRecord.values.maxAgeDays !== "number") {
        rejectDefinitionSnapshot();
      }
      rotationPolicy = Object.freeze({ maxAgeDays: policyRecord.values.maxAgeDays as number });
    }
    const snapshot: ProviderCustodyDeclaration = {
      key: record.values.key as SecretKey,
      provider: record.values.provider as ProviderName,
      rung: record.values.rung as CustodyRung,
      owner: record.values.owner as string,
      store: record.values.store as CustodyStore,
      scope: freezeStringArrayCopy(scope),
      leastPrivilegeNote: record.values.leastPrivilegeNote as string,
      usedBy: freezeStringArrayCopy(usedBy),
      rotationPolicy,
    };
    const snapshotEvaluation = evaluateProviderCustody(snapshot);
    if (snapshotEvaluation.verdict !== "satisfied") rejectDefinitionSnapshot();
    return Object.freeze(snapshot);
  } catch (error) {
    if (error === INVALID_DEFINITION_SNAPSHOT) {
      throw new RangeError("provider custody declaration changed while it was being inspected");
    }
    throw new RangeError("provider custody declaration could not be inspected safely");
  }
}

/** Builds a frozen, value-free provider-custody manifest from already-satisfied declarations. Throws on the first declaration that is not `satisfied`. */
export function defineProviderCustodyManifest(entries: readonly ProviderCustodyDeclaration[]): ProviderCustodyManifest {
  return Object.freeze({
    version: 1,
    entries: Object.freeze(entries.map((entry) => defineProviderCustody(entry))),
  });
}

/** The declaration for one key, or `undefined` if the key was never declared. */
export function providerCustodyOf(manifest: ProviderCustodyManifest, key: SecretKey): ProviderCustodyDeclaration | undefined {
  return manifest.entries.find((entry) => entry.key === key);
}
