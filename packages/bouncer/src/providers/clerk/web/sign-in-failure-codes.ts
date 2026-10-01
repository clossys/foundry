import type { SignInFailureCodeTable } from "../../../sign-in-failure.js";

/**
 * Clerk error codes read as sign-in failure classes, for
 * `classifySignInFailure(failure, { codes: CLERK_SIGN_IN_FAILURE_CODES })`.
 * Each code was checked against the installed Clerk packages. Codes Clerk may
 * send that are not listed read as `unknown`, or by status when it is set.
 */
export const CLERK_SIGN_IN_FAILURE_CODES = {
  form_password_incorrect: "credential",
  form_password_or_identifier_incorrect: "credential",
  form_code_incorrect: "credential",
  form_identifier_not_found: "notFound",
  user_locked: "locked",
  clerk_offline: "network",
} as const satisfies SignInFailureCodeTable;
