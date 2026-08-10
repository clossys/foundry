export type AuthEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Reports whether the explicitly requested development-only bypass is active.
 * Production always wins over the flag.
 */
export function devAuthBypassEnabled(
  environment: AuthEnvironment = process.env,
): boolean {
  return (
    environment.NODE_ENV !== "production"
    && environment.NEXT_PUBLIC_DEV_NO_AUTH === "1"
  );
}

export function devAuthBypassIsKeyless(
  environment: AuthEnvironment = process.env,
): boolean {
  return (
    devAuthBypassEnabled(environment)
    && !environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  );
}
