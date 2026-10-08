import type { AuthEnvironment } from "./dev-bypass.js";

const PUBLISHABLE_KEY_SETTING = "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY";
const SECRET_KEY_SETTING = "CLERK_SECRET_KEY";

export interface MissingProviderSettingsInput {
  /** A publishable key the host passes in code rather than through the environment. */
  readonly publishableKey?: string;
  /** Defaults to `process.env`. */
  readonly environment?: AuthEnvironment;
}

function runtimeEnvironment(): AuthEnvironment {
  // Direct public-property reads let framework bundlers replace the same
  // value in both server and client bundles, as dev-bypass.ts does.
  return {
    [PUBLISHABLE_KEY_SETTING]: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    [SECRET_KEY_SETTING]: process.env.CLERK_SECRET_KEY,
  };
}

function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** The names, never the values, of the Clerk settings that are not set. */
export function missingProviderSettings(input: MissingProviderSettingsInput = {}): string[] {
  const environment = input.environment ?? runtimeEnvironment();
  const missing: string[] = [];
  if (!isSet(input.publishableKey) && !isSet(environment[PUBLISHABLE_KEY_SETTING])) missing.push(PUBLISHABLE_KEY_SETTING);
  if (!isSet(environment[SECRET_KEY_SETTING])) missing.push(SECRET_KEY_SETTING);
  return missing;
}

/**
 * Returns a function that writes one log line naming the missing sign-in
 * provider settings the first time it finds any, and returns the missing names
 * every time. The page shows only the user-facing unavailable message; this
 * line is where a developer learns which settings to set. A throwing sink is
 * swallowed so reporting never breaks a request.
 */
export function createMissingSettingsReporter(log: (line: string) => void = (line) => console.error(line)) {
  let reported = false;
  return function report(input: MissingProviderSettingsInput = {}): string[] {
    const missing = missingProviderSettings(input);
    if (missing.length > 0 && !reported) {
      reported = true;
      try {
        log(`[bouncer] Sign-in provider settings are missing: ${missing.join(", ")}. Sign-in is unavailable until they are set.`);
      } catch {
        // A broken log sink must not fail the request.
      }
    }
    return missing;
  };
}
