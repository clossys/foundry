/**
 * Sign-in failure classes.
 *
 * A sign-in provider's error carries text that can reveal whether an account
 * exists. This module reads a failure down to one of seven classes and maps a
 * class to a copy id, so a host can show the Writer copy for that id and never
 * the provider's own words. The output is a class or an id and nothing else.
 *
 * Pure, with no imports: the provider code table is supplied by the caller,
 * and the Clerk table ships behind `./providers/clerk/web`.
 */

/** The seven classes a sign-in failure can be read as, in order. */
export const SIGN_IN_FAILURE_CLASSES = [
  "credential",
  "notFound",
  "rateLimited",
  "locked",
  "network",
  "unavailable",
  "unknown",
] as const;

export type SignInFailureClass = (typeof SIGN_IN_FAILURE_CLASSES)[number];

/** The fields `classifySignInFailure` reads from a failure; everything else is ignored. */
export interface SignInFailureShape {
  readonly status?: number;
  readonly code?: string;
  readonly errors?: ReadonlyArray<{ readonly code?: string }>;
}

/** The most `errors[]` entries `classifySignInFailure` reads; a longer array is read up to here. */
const MAX_ERRORS_READ = 16;

/** Provider error code -> class. `unknown` is the absence of an entry, never a value. */
export type SignInFailureCodeTable = Readonly<Record<string, Exclude<SignInFailureClass, "unknown">>>;

export interface ClassifySignInFailureOptions {
  /** Provider error codes this call recognises. Without it only the status is read. */
  readonly codes?: SignInFailureCodeTable;
  /**
   * Stop the class from telling a visitor whether an account exists or is
   * locked: `notFound` reads as `credential` and `locked` as `rateLimited`.
   */
  readonly hideAccountExistence?: boolean;
}

/** The Writer copy ids a class can map to. */
export type SignInFailureCopyId =
  | "front-door.password.notice"
  | "front-door.code.notice"
  | "front-door.identifier-not-found.notice"
  | "front-door.rate-limited.notice"
  | "front-door.locked.notice"
  | "front-door.unavailable.notice";

export interface SignInFailureCopyIdOptions {
  /** The factor the visitor was using; it changes the `credential` id only. Defaults to `password`. */
  readonly factor?: "password" | "code";
}

function tableClass(codes: SignInFailureCodeTable, code: unknown): Exclude<SignInFailureClass, "unknown"> | undefined {
  if (typeof code !== "string" || !Object.prototype.hasOwnProperty.call(codes, code)) return undefined;
  const value: unknown = codes[code];
  if (typeof value !== "string" || value === "unknown") return undefined;
  return (SIGN_IN_FAILURE_CLASSES as readonly string[]).includes(value)
    ? (value as Exclude<SignInFailureClass, "unknown">)
    : undefined;
}

function statusClass(status: unknown): SignInFailureClass {
  if (typeof status !== "number") return "unknown";
  if (status === 429) return "rateLimited";
  if (status === 423) return "locked";
  if (status >= 500 && status <= 599) return "unavailable";
  return "unknown";
}

function read(failure: object, codes: SignInFailureCodeTable | undefined): SignInFailureClass {
  const shape = failure as { status?: unknown; code?: unknown; errors?: unknown };
  if (codes !== undefined && codes !== null && typeof codes === "object") {
    const errors = shape.errors;
    if (Array.isArray(errors)) {
      const length = Math.min(errors.length, MAX_ERRORS_READ);
      for (let index = 0; index < length; index += 1) {
        const entry: unknown = errors[index];
        if (typeof entry !== "object" || entry === null) continue;
        const matched = tableClass(codes, (entry as { code?: unknown }).code);
        if (matched !== undefined) return matched;
      }
    }
    const matched = tableClass(codes, shape.code);
    if (matched !== undefined) return matched;
  }
  return statusClass(shape.status);
}

/**
 * Reads a sign-in failure as one of the seven classes. Never throws and never
 * returns provider text. A 404 is `unknown`: `notFound` comes only from a
 * provider code in `options.codes`.
 */
export function classifySignInFailure(failure: unknown, options?: ClassifySignInFailureOptions): SignInFailureClass {
  if (typeof failure !== "object" || failure === null) return "unknown";
  let failureClass: SignInFailureClass;
  let hide = false;
  try {
    failureClass = read(failure, options?.codes);
    hide = options?.hideAccountExistence === true;
  } catch {
    return "unknown";
  }
  if (hide) {
    if (failureClass === "notFound") return "credential";
    if (failureClass === "locked") return "rateLimited";
  }
  return failureClass;
}

/** The Writer copy id for a class. `unknown`, `network` and `unavailable` share one id. */
export function signInFailureCopyId(
  failureClass: SignInFailureClass,
  options?: SignInFailureCopyIdOptions,
): SignInFailureCopyId {
  switch (failureClass) {
    case "credential":
      return options?.factor === "code" ? "front-door.code.notice" : "front-door.password.notice";
    case "notFound":
      return "front-door.identifier-not-found.notice";
    case "rateLimited":
      return "front-door.rate-limited.notice";
    case "locked":
      return "front-door.locked.notice";
    default:
      return "front-door.unavailable.notice";
  }
}
