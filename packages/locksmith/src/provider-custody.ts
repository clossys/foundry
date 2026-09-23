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

/**
 * The verdict vocabulary, machine for machine, docs/contracts/check-output-
 * envelope.json's own `verdicts` (issue #1174/#1190) — a repository contract
 * that does not ship with this package. This package does not declare a
 * second, independently-invented ternary here — see this package's own
 * `check-output-envelope.test.ts` (also not shipped; a dev-only test), whose
 * contract-sync test reads that file directly and fails if this union and
 * its own `verdicts` array ever diverge.
 */
export type ProviderCustodyVerdict = "satisfied" | "violated" | "indeterminate";
export type ProviderCustodyExitCode = 0 | 1 | 2;

/**
 * The stable rule id for one way a declaration can fail. Carried as
 * `ProviderCustodyFinding.rule` — the `findingShape.rule` field the
 * repository contract docs/contracts/check-output-envelope.json declares
 * (does not ship with this package) — rather than as a bare string in a
 * package-local reason union, so a caller reading this package's output
 * alongside any other role's check output sees one shape, not a second one
 * invented here.
 */
export type ProviderCustodyReasonRule =
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

/**
 * One reportable problem with a declaration, in exactly the shape the
 * repository contract docs/contracts/check-output-envelope.json's
 * `findingShape` declares (that contract does not ship with this package):
 * `rule` (stable machine id), `severity`, `message` (human-readable), and an
 * optional `path` naming the declaration field the finding is about. Every
 * finding this package produces is `severity: "error"` — a provider-custody
 * declaration is judged, not merely advised, so nothing here is a
 * non-blocking warning.
 */
export interface ProviderCustodyFinding {
  readonly rule: ProviderCustodyReasonRule;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export interface ProviderCustodyEvaluation {
  readonly key: SecretKey | null;
  readonly provider: ProviderName | null;
  readonly rung: CustodyRung | null;
  readonly verdict: ProviderCustodyVerdict;
  readonly exitCode: ProviderCustodyExitCode;
  readonly findings: readonly ProviderCustodyFinding[];
}

/**
 * The full shape the repository contract docs/contracts/check-output-
 * envelope.json declares (it does not ship with this package) for one
 * evaluation run: `{ package, version, verdict, summary, findings,
 * nextAction? }`. `providerCustodyReport` is what builds this from a raw
 * declaration; the CLI (`provider-custody-cli.ts`) is what emits it as this
 * package's own "check command['s] JSON report" the contract describes.
 */
export interface ProviderCustodyReport {
  readonly package: "@clossys/locksmith";
  readonly version: string;
  readonly verdict: ProviderCustodyVerdict;
  readonly summary: string;
  readonly findings: readonly ProviderCustodyFinding[];
  readonly nextAction?: string;
}

const EXIT_CODES: Readonly<Record<ProviderCustodyVerdict, ProviderCustodyExitCode>> = Object.freeze({
  satisfied: 0,
  violated: 1,
  indeterminate: 2,
});

const PROVIDERS: readonly ProviderName[] = ["cloudflare", "vercel", "github"];
const RUNGS: readonly CustodyRung[] = ["operator-interactive", "scoped-environment-secret", "federated-oidc"];

/**
 * One fixed message (and, where a single field is at fault, its `path`) per
 * `ProviderCustodyReasonRule` — kept as one table so `findingFor` never
 * improvises wording per call site, and so this package's own dev-only
 * `check-output-envelope.test.ts` (not shipped with this package) can
 * assert every rule this module can emit has a corresponding table entry.
 */
const FINDING_TEXT: Readonly<Record<ProviderCustodyReasonRule, { readonly message: string; readonly path?: string }>> = Object.freeze({
  "invalid-declaration": { message: "the declaration is not a plain, own-data object this package can safely inspect" },
  "unsupported-fields": { message: "the declaration carries a field outside the closed provider-custody declaration shape" },
  "missing-key": { message: "key is missing or is not a non-empty string", path: "key" },
  "missing-provider": { message: "provider is missing", path: "provider" },
  "unsupported-provider": { message: `provider must be one of: ${PROVIDERS.join(", ")}`, path: "provider" },
  "missing-rung": { message: "rung is missing", path: "rung" },
  "unsupported-rung": { message: `rung must be one of the closed custody ladder: ${RUNGS.join(", ")}`, path: "rung" },
  "missing-owner": { message: "owner is missing or is not a non-empty string", path: "owner" },
  "missing-store": { message: "store is missing or is not a non-empty string", path: "store" },
  "store-is-repository": { message: "store names this repository itself, which never satisfies custody", path: "store" },
  "missing-scope": { message: "scope is missing or is not a dense array of non-empty strings", path: "scope" },
  "missing-least-privilege-note": { message: "leastPrivilegeNote is missing or is not a non-empty string", path: "leastPrivilegeNote" },
  "missing-used-by": { message: "usedBy is missing or is not a dense array of non-empty strings", path: "usedBy" },
  "invalid-rotation-policy": { message: "rotationPolicy must be null or { maxAgeDays: <finite positive number> }", path: "rotationPolicy" },
});

function findingFor(rule: ProviderCustodyReasonRule): ProviderCustodyFinding {
  const text = FINDING_TEXT[rule];
  return text.path === undefined
    ? Object.freeze({ rule, severity: "error" as const, message: text.message })
    : Object.freeze({ rule, severity: "error" as const, message: text.message, path: text.path });
}

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

/** Same indexed-copy discipline as `freezeStringArrayCopy`, for `ProviderCustodyFinding[]`. */
function freezeFindingsCopy(findings: readonly ProviderCustodyFinding[]): readonly ProviderCustodyFinding[] {
  const copy: ProviderCustodyFinding[] = [];
  for (let index = 0; index < findings.length; index += 1) copy[index] = findings[index] as ProviderCustodyFinding;
  return Object.freeze(copy);
}

function evaluation(
  key: SecretKey | null,
  provider: ProviderName | null,
  rung: CustodyRung | null,
  verdict: ProviderCustodyVerdict,
  findings: readonly ProviderCustodyFinding[],
): ProviderCustodyEvaluation {
  return Object.freeze({
    key,
    provider,
    rung,
    verdict,
    exitCode: EXIT_CODES[verdict],
    findings: freezeFindingsCopy(findings),
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
  if (record === null) return evaluation(null, null, null, "indeterminate", [findingFor("invalid-declaration")]);
  if (!hasOnlyFields(record, DECLARATION_FIELDS)) return evaluation(null, null, null, "indeterminate", [findingFor("unsupported-fields")]);

  const key = isNonEmptyString(record.values.key) ? record.values.key : null;
  const provider = PROVIDERS.includes(record.values.provider as ProviderName) ? (record.values.provider as ProviderName) : null;
  const rung = RUNGS.includes(record.values.rung as CustodyRung) ? (record.values.rung as CustodyRung) : null;
  const store = isNonEmptyString(record.values.store) ? record.values.store : null;
  const scope = readNonEmptyStringArray(record.values.scope);
  const usedBy = readNonEmptyStringArray(record.values.usedBy);

  const findings: ProviderCustodyFinding[] = [];
  if (key === null) findings.push(findingFor("missing-key"));
  if (!hasField(record, "provider")) findings.push(findingFor("missing-provider"));
  else if (provider === null) findings.push(findingFor("unsupported-provider"));
  if (!hasField(record, "rung")) findings.push(findingFor("missing-rung"));
  else if (rung === null) findings.push(findingFor("unsupported-rung"));
  if (!isNonEmptyString(record.values.owner)) findings.push(findingFor("missing-owner"));
  if (store === null) findings.push(findingFor("missing-store"));
  else if (isRepositoryStore(store)) findings.push(findingFor("store-is-repository"));
  if (scope === null) findings.push(findingFor("missing-scope"));
  if (!isNonEmptyString(record.values.leastPrivilegeNote)) findings.push(findingFor("missing-least-privilege-note"));
  if (usedBy === null) findings.push(findingFor("missing-used-by"));
  if (!hasField(record, "rotationPolicy") || !inspectRotationPolicy(record.values.rotationPolicy).ok) {
    findings.push(findingFor("invalid-rotation-policy"));
  }

  if (findings.length > 0) return evaluation(key, provider, rung, "violated", findings);
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
    return evaluation(null, null, null, "indeterminate", [findingFor("invalid-declaration")]);
  }
}

function findingSummary(findings: readonly ProviderCustodyFinding[]): string {
  return findings.map((finding) => finding.rule).join(", ");
}

/**
 * One plain-language sentence for the repository contract docs/contracts/
 * check-output-envelope.json's required `summary` field (that contract does
 * not ship with this package) — the ONLY field a non-technical reader may be
 * shown without translation, per that contract's own `rule`.
 */
function summaryFor(evaluated: ProviderCustodyEvaluation): string {
  if (evaluated.verdict === "satisfied") {
    return `The provider-custody declaration for ${evaluated.key ?? "this key"} satisfies the closed custody ladder.`;
  }
  if (evaluated.verdict === "indeterminate") {
    return "The provider-custody declaration could not be read as one of the closed custody shapes this command judges.";
  }
  return `The provider-custody declaration for ${evaluated.key ?? "this key"} does not satisfy the closed custody ladder (${evaluated.findings.length} finding(s)).`;
}

/**
 * Builds the full report shape the repository contract docs/contracts/
 * check-output-envelope.json declares (does not ship with this package) for
 * one declaration: `{ package, version, verdict, summary, findings,
 * nextAction? }`. `packageVersion` is caller-supplied (this package's own
 * `package.json` `version`, read once by the CLI) rather than read from disk
 * here, so this function stays the same pure, dependency-free shape as
 * `evaluateProviderCustody` itself.
 */
export function providerCustodyReport(declaration: unknown, packageVersion: string): ProviderCustodyReport {
  const evaluated = evaluateProviderCustody(declaration);
  const report: ProviderCustodyReport = {
    package: "@clossys/locksmith",
    version: packageVersion,
    verdict: evaluated.verdict,
    summary: summaryFor(evaluated),
    findings: evaluated.findings,
  };
  if (evaluated.verdict !== "satisfied") {
    return Object.freeze({
      ...report,
      nextAction:
        evaluated.verdict === "indeterminate"
          ? "Fix the declaration's shape so it can be read as a provider-custody declaration, then re-run this check."
          : "Resolve every listed finding in the declaration, then re-run this check.",
    });
  }
  return Object.freeze(report);
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
    throw new RangeError(`provider custody declaration is ${evaluated.verdict}: ${findingSummary(evaluated.findings)}`);
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
