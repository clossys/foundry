export type AuthEnvironment = Readonly<Record<string, string | undefined>>;

function runtimeAuthEnvironment(): AuthEnvironment {
  // Keep public names as direct property accesses so Next.js can replace the
  // same values in both the server and client bundles.
  return {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_DEV_NO_AUTH: process.env.NEXT_PUBLIC_DEV_NO_AUTH,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  };
}

/**
 * Reports whether the explicitly requested development-only bypass is active.
 * Production always wins over the flag.
 */
export function devAuthBypassEnabled(
  environment: AuthEnvironment = runtimeAuthEnvironment(),
): boolean {
  return (
    environment.NODE_ENV !== "production"
    && environment.NEXT_PUBLIC_DEV_NO_AUTH === "1"
  );
}

export function devAuthBypassIsKeyless(
  environment: AuthEnvironment = runtimeAuthEnvironment(),
): boolean {
  return (
    devAuthBypassEnabled(environment)
    && !environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  );
}
