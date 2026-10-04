/** Pure private catalog and noun validation shared by the two public entry points. */
import type { CopyRegistry, CopyRegistryEntry, CopyResolution } from "./types.js";
/** All reserved front-door copy ids, in catalog order. */
export const CANONICAL_IDS = Object.freeze([
  "front-door.sign-in.title",
  "front-door.sign-in.description",
  "front-door.sign-in.label",
  "front-door.sign-in.primary",
  "front-door.password.title",
  "front-door.password.description",
  "front-door.password.label",
  "front-door.password.primary",
  "front-door.password.secondary",
  "front-door.identifier-not-found.notice",
  "front-door.forgot-password.label",
  "front-door.password.notice",
  "front-door.sign-in.alt",
  "front-door.code.title",
  "front-door.code.description",
  "front-door.code.label",
  "front-door.code.primary",
  "front-door.code.secondary",
  "front-door.code.notice",
  "front-door.unavailable.notice",
  "front-door.rate-limited.notice",
  "front-door.locked.notice",
  "front-door.expired.notice",
  "front-door.signed-out.notice",
  "front-door.error.title",
  "front-door.error.description",
  "front-door.error.primary",
  "front-door.not-found.title",
  "front-door.not-found.description",
  "front-door.not-found.primary",
  "front-door.not-authorized.title",
  "front-door.not-authorized.description",
  "front-door.not-authorized.primary",
  "front-door.not-authorized.secondary",
  "front-door.access-pending.title",
  "front-door.access-pending.description",
  "front-door.access-pending.primary",
  "front-door.service-unavailable.title",
  "front-door.service-unavailable.description",
  "front-door.service-unavailable.primary",
  "front-door.request-access.description",
  "front-door.request-access.label",
  "front-door.reset.title",
  "front-door.reset.description",
  "front-door.reset.label",
  "front-door.reset.primary",
  "front-door.reset.secondary",
  "front-door.reset.notice",
  "front-door.activation.title",
  "front-door.activation.description",
  "front-door.activation.primary",
  "front-door.activation.notice",
  "front-door.internal-note.label",
  "front-door.identifier-required.notice",
  "front-door.password-required.notice",
  "front-door.code-required.notice",
  "front-door.network.notice",
  "front-door.password-weak.notice",
  "front-door.reset-code.primary",
  "front-door.activation.label",
  "front-door.activation-first-name.label",
  "front-door.activation-last-name.label",
  "front-door.name-required.notice",
] as const);

/** A reserved front-door copy id. */
export type FrontDoorKey = (typeof CANONICAL_IDS)[number];

/** The closed set of nouns a front-door text may name as a `{token}`. */
export const CANONICAL_NOUNS = Object.freeze(["brand", "surface", "identifier", "digest", "requestAccessLabel"] as const);

/** One noun a front-door text may name. */
export type FrontDoorNoun = (typeof CANONICAL_NOUNS)[number];

/** The nouns a caller supplies; each is read only when the entry declares it. */
export type FrontDoorNouns = Partial<Record<FrontDoorNoun, string>>;

/** Why a front-door entry could not be resolved. */
export type FrontDoorCopyIssueReason = "unknown-copy-id" | "missing-noun" | "unknown-noun";

/** One reason a front-door entry could not be resolved. */
export interface FrontDoorCopyIssue {
  reason: FrontDoorCopyIssueReason;
  message: string;
  /** The id asked for, on `"unknown-copy-id"`. */
  id?: string;
  /** The noun at fault, on `"missing-noun"` and `"unknown-noun"`. */
  noun?: string;
}

/**
 * The outcome of `resolveFrontDoorCopy`. `text` and `resolution` are
 * present only when `complete` is `true`; `issues` is empty exactly then.
 */
export interface FrontDoorCopyResolution {
  complete: boolean;
  text?: string;
  resolution?: CopyResolution;
  issues: FrontDoorCopyIssue[];
}

const DEFAULTS: Readonly<Record<FrontDoorKey, { text: string; context: string }>> = {
  "front-door.sign-in.title": { text: "Sign in", context: "sign-in page: heading" },
  "front-door.sign-in.description": { text: "Continue to {surface}.", context: "sign-in page: line under the heading" },
  "front-door.sign-in.label": { text: "Email", context: "sign-in page: email field label" },
  "front-door.sign-in.primary": { text: "Continue", context: "sign-in page: main button" },
  "front-door.password.title": { text: "Enter your password", context: "password page: heading" },
  "front-door.password.description": { text: "Signing in as {identifier}.", context: "password page: line under the heading" },
  "front-door.password.label": { text: "Password", context: "password page: password field label" },
  "front-door.password.primary": { text: "Sign in", context: "password page: main button" },
  "front-door.password.secondary": { text: "Use a different email", context: "password page: link back to the email step" },
  "front-door.identifier-not-found.notice": {
    text: "We couldn’t find an account for that email. Check it and try again.",
    context: "sign-in page: notice when no account matches the email",
  },
  "front-door.forgot-password.label": { text: "Forgot password?", context: "sign-in page: link to start a password reset" },
  "front-door.password.notice": { text: "That password isn’t right. Try again.", context: "password page: notice when the password is wrong" },
  "front-door.sign-in.alt": { text: "Sign in to {brand}", context: "sign-in page: alt text for the brand mark" },
  "front-door.code.title": { text: "Verify your sign-in", context: "code page: heading" },
  "front-door.code.description": { text: "Enter your verification code to continue.", context: "code page: line under the heading" },
  "front-door.code.label": { text: "Code", context: "code page: code field label" },
  "front-door.code.primary": { text: "Verify", context: "code page: main button" },
  "front-door.code.secondary": { text: "Send a new code", context: "code page: link to request another code" },
  "front-door.code.notice": { text: "That code isn’t right or has expired. Try again.", context: "code page: notice when the code is wrong or expired" },
  "front-door.unavailable.notice": { text: "Sign-in isn’t available right now. Try again in a few minutes.", context: "sign-in page: notice when sign-in is temporarily unavailable" },
  "front-door.rate-limited.notice": { text: "Too many attempts. Wait a few minutes, then try again.", context: "sign-in page: notice when attempts are rate limited" },
  "front-door.locked.notice": { text: "This account is temporarily locked after too many attempts. Try again later.", context: "sign-in page: notice when the account is temporarily locked" },
  "front-door.expired.notice": { text: "Your session expired. Sign in again to continue.", context: "sign-in page: notice when the session has expired" },
  "front-door.signed-out.notice": { text: "You’re signed out.", context: "sign-in page: notice after signing out" },
  "front-door.error.title": { text: "This page didn’t load", context: "error page: heading" },
  "front-door.error.description": { text: "Something went wrong. Error: {digest}.", context: "error page: line under the heading, with the error digest" },
  "front-door.error.primary": { text: "Try again", context: "error page: main button" },
  "front-door.not-found.title": { text: "Page not found", context: "not-found page: heading" },
  "front-door.not-found.description": { text: "This page doesn’t exist or has moved.", context: "not-found page: line under the heading" },
  "front-door.not-found.primary": { text: "Go to {surface}", context: "not-found page: main button back to the surface" },
  "front-door.not-authorized.title": { text: "You don’t have access", context: "not-authorized page: heading" },
  "front-door.not-authorized.description": { text: "{identifier} doesn’t have access to {surface}.", context: "not-authorized page: line under the heading" },
  "front-door.not-authorized.primary": { text: "Switch account", context: "not-authorized page: main button" },
  "front-door.not-authorized.secondary": { text: "Sign out", context: "not-authorized page: link to sign out" },
  "front-door.access-pending.title": { text: "Access pending", context: "access-pending page: heading" },
  "front-door.access-pending.description": { text: "Your access to {surface} awaits approval. Check back later.", context: "access-pending page: line under the heading" },
  "front-door.access-pending.primary": { text: "Sign out", context: "access-pending page: main button" },
  "front-door.service-unavailable.title": { text: "{surface} isn’t available", context: "service-unavailable page: heading" },
  "front-door.service-unavailable.description": { text: "This is temporary. Try again soon.", context: "service-unavailable page: line under the heading" },
  "front-door.service-unavailable.primary": { text: "Try again", context: "service-unavailable page: main button" },
  "front-door.request-access.description": { text: "Don’t have an account?", context: "sign-in page: line before the request-access link" },
  "front-door.request-access.label": { text: "{requestAccessLabel}", context: "sign-in page: request-access link label" },
  "front-door.reset.title": { text: "Reset your password", context: "reset page: heading" },
  "front-door.reset.description": { text: "Enter your email and we’ll send you a code.", context: "reset page: line under the heading" },
  "front-door.reset.label": { text: "New password", context: "reset page: new password field label" },
  "front-door.reset.primary": { text: "Send code", context: "reset page: main button" },
  "front-door.reset.secondary": { text: "Back to sign in", context: "reset page: link back to sign-in" },
  "front-door.reset.notice": { text: "Password updated. Sign in with your new password.", context: "sign-in page: notice after a password reset" },
  "front-door.activation.title": { text: "Set up your account", context: "activation page: heading" },
  "front-door.activation.description": { text: "You’re invited to {surface}. Choose a password to finish.", context: "activation page: line under the heading" },
  "front-door.activation.primary": { text: "Activate account", context: "activation page: main button" },
  "front-door.activation.notice": { text: "This invitation has expired or was already used. Ask for a new invitation.", context: "activation page: notice when the invitation is no longer valid" },
  "front-door.internal-note.label": { text: "Internal", context: "label marking a note visible only inside the organization" },
  "front-door.identifier-required.notice": { text: "Enter your email.", context: "sign-in page: notice when the email is empty" },
  "front-door.password-required.notice": { text: "Enter your password.", context: "password page: notice when the password is empty" },
  "front-door.code-required.notice": { text: "Enter the code.", context: "code page: notice when the code is empty" },
  "front-door.network.notice": { text: "Couldn’t reach {surface}. Check your connection and try again.", context: "any page: notice when the request could not reach the surface" },
  "front-door.password-weak.notice": {
    text: "That password isn’t strong enough. Use a longer one you haven’t used anywhere else.",
    context: "reset and activation pages: notice when the new password is refused as too weak",
  },
  "front-door.reset-code.primary": { text: "Reset password", context: "reset page, code step: main button" },
  "front-door.activation.label": { text: "Password", context: "activation page: password field label" },
  "front-door.activation-first-name.label": { text: "First name", context: "activation page: first name field label" },
  "front-door.activation-last-name.label": { text: "Last name", context: "activation page: last name field label" },
  "front-door.name-required.notice": { text: "Enter your first and last name.", context: "activation page: notice when a name field is empty" },
};

for (const entry of Object.values(DEFAULTS)) Object.freeze(entry);
Object.freeze(DEFAULTS);

function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!))];
}

function entryFor(id: FrontDoorKey): CopyRegistryEntry {
  const { text, context } = DEFAULTS[id];
  const placeholders = placeholdersOf(text);
  return {
    id,
    text,
    context,
    status: "approved",
    ...(placeholders.length > 0 ? { placeholders } : {}),
  };
}

/** Returns independent mutable defaults for the legacy registry resolver. */
export function createDefaultCatalog(): CopyRegistry {
  return {
    id: "front-door", locale: "en", revision: "1",
    source: { kind: "imported", reference: "@clossys/writer/front-door.en.json" },
    entries: CANONICAL_IDS.map(entryFor)
  };
}

/** Copies the own, enumerable string-keyed values of `nouns`; anything unreadable reads as no nouns at all. */
function readNouns(nouns: unknown): Map<string, unknown> {
  const read = new Map<string, unknown>();
  if (typeof nouns !== "object" || nouns === null || Array.isArray(nouns)) return read;
  try {
    for (const name of Object.keys(nouns)) read.set(name, (nouns as Record<string, unknown>)[name]);
  } catch {
    return new Map();
  }
  return read;
}

/** Names a lookup key for a message; a key that cannot be stringified (a null-prototype object, a throwing `toString`) reads as its type. */
function describeKey(key: unknown): string {
  try {
    return String(key);
  } catch {
    return `<${typeof key}>`;
  }
}

/** Reads and validates nouns without importing registry approval machinery. */
export function prepareFrontDoorCopy(key: FrontDoorKey, nouns: FrontDoorNouns, catalog: CopyRegistry,
  ids: readonly string[], nounNames: readonly string[]): { complete: false; issues: FrontDoorCopyIssue[] } | { complete: true; entry: CopyRegistryEntry; values: Record<string, string> } {
  if (typeof key !== "string" || !ids.includes(key)) {
    return {
      complete: false as const,
      issues: [{ reason: "unknown-copy-id", id: describeKey(key), message: `Front-door copy id "${describeKey(key)}" is not a reserved id.` }],
    };
  }

  const entry = catalog.entries.find((candidate) => candidate.id === key);
  if (!entry) {
    return {
      complete: false as const,
      issues: [{ reason: "unknown-copy-id", id: key, message: `Front-door copy "${key}" is not present in the catalog.` }],
    };
  }

  const supplied = readNouns(nouns);
  const issues: FrontDoorCopyIssue[] = [];
  for (const name of supplied.keys()) {
    if (!nounNames.includes(name)) {
      issues.push({ reason: "unknown-noun", noun: name, message: `"${name}" is not a front-door noun.` });
    }
  }

  const values: Record<string, string> = {};
  for (const name of entry.placeholders ?? []) {
    const value = supplied.get(name);
    if (typeof value !== "string" || value.trim().length === 0) {
      issues.push({ reason: "missing-noun", id: key, noun: name, message: `Front-door copy "${key}" needs the noun "${name}", which is absent or blank.` });
    } else {
      values[name] = value;
    }
  }
  if (issues.length > 0) return { complete: false as const, issues };

  return { complete: true as const, entry, values };
}
