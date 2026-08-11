import type { Viewer } from "./roles.js";

/** A framework-neutral authenticated session. */
export interface Session {
  readonly subjectId: string;
  readonly viewer?: Viewer;
  readonly expiresAt?: Date;
}

/** Resolves a session from application-owned request or runtime context. */
export interface SessionResolver<TContext = unknown> {
  resolve(context: TContext): Session | null | Promise<Session | null>;
}

/** An application-owned authorization decision. Returning false denies access. */
export type AuthorizationPredicate<TContext = unknown> = (
  session: Session | null,
  context: TContext,
) => boolean | Promise<boolean>;

/** Runs an authorization predicate and denies missing, invalid, expired, or failed sessions. */
export async function isAuthorized<TContext>(
  predicate: AuthorizationPredicate<TContext>,
  session: Session | null | undefined,
  context: TContext,
): Promise<boolean> {
  if (
    session == null
    || typeof session !== "object"
    || typeof session.subjectId !== "string"
    || session.subjectId.trim().length === 0
    || (session.expiresAt !== undefined
      && (!(session.expiresAt instanceof Date)
        || !Number.isFinite(session.expiresAt.getTime())
        || session.expiresAt.getTime() <= Date.now()))
  ) {
    return false;
  }

  try {
    return await predicate(session, context) === true;
  } catch {
    return false;
  }
}
