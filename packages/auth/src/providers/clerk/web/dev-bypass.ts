export type AuthEnvironment = Readonly<Record<string, string | undefined>>;

function runtimeAuthEnvironment(): AuthEnvironment {
  // Direct public-property reads let framework bundlers replace the same
  // values in both server and client bundles.
  return {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_DEV_NO_AUTH: process.env.NEXT_PUBLIC_DEV_NO_AUTH,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  };
}

/** Reports whether the explicit development-only bypass is active. */
export function devAuthBypassEnabled(environment: AuthEnvironment = runtimeAuthEnvironment()): boolean {
  return environment.NODE_ENV !== "production" && environment.NEXT_PUBLIC_DEV_NO_AUTH === "1";
}

export function devAuthBypassIsKeyless(environment: AuthEnvironment = runtimeAuthEnvironment()): boolean {
  return devAuthBypassEnabled(environment) && !environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}
