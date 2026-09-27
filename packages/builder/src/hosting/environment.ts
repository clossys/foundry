/**
 * Build-environment checks for `builder hosting install` (issue #1526).
 *
 * A name is present or absent. This module does not accept or return
 * variable values. Provider token names are left out of the build
 * environment that the check reports.
 */

export const PROVIDER_TOKEN_NAMES = ["VERCEL_TOKEN"] as const;

const PROVIDER_TOKENS = new Set<string>(PROVIDER_TOKEN_NAMES);

export type BuildEnvironmentReport = {
  /** Declared names with provider tokens removed, in declaration order. */
  readonly placed: readonly string[];
  readonly present: readonly string[];
  readonly absent: readonly string[];
};

export function isProviderTokenName(name: string): boolean {
  return PROVIDER_TOKENS.has(name);
}

/**
 * Compares declared build-environment names to the names that are present.
 * `presentNames` is a list of names, not values.
 */
export function checkBuildEnvironmentNames(
  declaredNames: readonly string[],
  presentNames: readonly string[],
): BuildEnvironmentReport {
  const present = new Set(presentNames);
  const placed = declaredNames.filter((name) => !PROVIDER_TOKENS.has(name));
  return {
    placed,
    present: placed.filter((name) => present.has(name)),
    absent: placed.filter((name) => !present.has(name)),
  };
}

/** Names the install's child environment must not receive. */
export function installOmittedNames(credentialVariables: readonly string[]): readonly string[] {
  return [...new Set([...credentialVariables, ...PROVIDER_TOKEN_NAMES])];
}

/**
 * Copies `parent` except the omitted names, so a credential or provider
 * token value is not assigned onto the child environment.
 */
export function childEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
  omitNames: readonly string[],
): Record<string, string> {
  const omit = new Set(omitNames);
  const child: Record<string, string> = {};
  for (const name of Object.keys(parent)) {
    if (omit.has(name)) continue;
    const value = parent[name];
    if (value === undefined) continue;
    child[name] = value;
  }
  return child;
}
