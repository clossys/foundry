import type { SecretKey } from "./types.js";
import type { CustodyStore } from "./custody.js";

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
    reasons: Object.freeze([...reasons]),
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => isNonEmptyString(entry));
}

function isRepositoryStore(store: string): boolean {
  const normalized = store.trim().toLowerCase();
  return REPOSITORY_STORE_LITERALS.has(normalized);
}

function hasOnlyDeclarationFields(record: Record<string, unknown>): boolean {
  const keys = Object.keys(record);
  return keys.length <= DECLARATION_FIELDS.length && keys.every((key) => (DECLARATION_FIELDS as readonly string[]).includes(key));
}

function inspectRotationPolicy(value: unknown): { readonly ok: boolean } {
  if (value === null) return { ok: true };
  if (!isPlainRecord(value)) return { ok: false };
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "maxAgeDays") return { ok: false };
  const maxAgeDays = value.maxAgeDays;
  return { ok: typeof maxAgeDays === "number" && Number.isFinite(maxAgeDays) && maxAgeDays > 0 };
}

/**
 * Judges a value-free custody declaration without reading, accepting,
 * storing, or returning a token value. Unknown fields are indeterminate, so
 * a value smuggled through an untyped caller cannot be silently accepted or
 * echoed — the same discipline `credential.ts`'s `evaluateCredential` uses.
 */
export function evaluateProviderCustody(declaration: unknown): ProviderCustodyEvaluation {
  if (!isPlainRecord(declaration)) return evaluation(null, null, null, "indeterminate", ["invalid-declaration"]);
  if (!hasOnlyDeclarationFields(declaration)) return evaluation(null, null, null, "indeterminate", ["unsupported-fields"]);

  const key = isNonEmptyString(declaration.key) ? declaration.key : null;
  const provider = PROVIDERS.includes(declaration.provider as ProviderName) ? (declaration.provider as ProviderName) : null;
  const rung = RUNGS.includes(declaration.rung as CustodyRung) ? (declaration.rung as CustodyRung) : null;

  const reasons: ProviderCustodyReason[] = [];
  if (key === null) reasons.push("missing-key");
  if (!Object.hasOwn(declaration, "provider")) reasons.push("missing-provider");
  else if (provider === null) reasons.push("unsupported-provider");
  if (!Object.hasOwn(declaration, "rung")) reasons.push("missing-rung");
  else if (rung === null) reasons.push("unsupported-rung");
  if (!isNonEmptyString(declaration.owner)) reasons.push("missing-owner");
  if (!isNonEmptyString(declaration.store)) reasons.push("missing-store");
  else if (isRepositoryStore(declaration.store)) reasons.push("store-is-repository");
  if (!isNonEmptyStringArray(declaration.scope)) reasons.push("missing-scope");
  if (!isNonEmptyString(declaration.leastPrivilegeNote)) reasons.push("missing-least-privilege-note");
  if (!isNonEmptyStringArray(declaration.usedBy)) reasons.push("missing-used-by");
  if (!Object.hasOwn(declaration, "rotationPolicy") || !inspectRotationPolicy(declaration.rotationPolicy).ok) {
    reasons.push("invalid-rotation-policy");
  }

  if (reasons.length > 0) return evaluation(key, provider, rung, "violated", reasons);
  return evaluation(key, provider, rung, "satisfied", []);
}

function reasonSummary(reasons: readonly ProviderCustodyReason[]): string {
  return reasons.join(", ");
}

/** Frozen, value-free authoring helper for callers that already have a typed declaration. Throws if it does not evaluate `satisfied`. */
export function defineProviderCustody(declaration: ProviderCustodyDeclaration): ProviderCustodyDeclaration {
  const evaluated = evaluateProviderCustody(declaration);
  if (evaluated.verdict !== "satisfied") {
    throw new RangeError(`provider custody declaration is ${evaluated.verdict}: ${reasonSummary(evaluated.reasons)}`);
  }
  return Object.freeze({
    key: declaration.key,
    provider: declaration.provider,
    rung: declaration.rung,
    owner: declaration.owner,
    store: declaration.store,
    scope: Object.freeze([...declaration.scope]),
    leastPrivilegeNote: declaration.leastPrivilegeNote,
    usedBy: Object.freeze([...declaration.usedBy]),
    rotationPolicy: declaration.rotationPolicy === null ? null : Object.freeze({ maxAgeDays: declaration.rotationPolicy.maxAgeDays }),
  });
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
