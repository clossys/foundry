/**
 * A single, shared definition of "looks like a real npm package name", used
 * everywhere this package validates one: entitlement entries, opt-outs,
 * inventory entries, admission candidates. One definition rather than four
 * near-copies means a change to what counts as a valid name cannot drift
 * between modules.
 */

const NAME_COMPONENT = "[a-z0-9][a-z0-9._-]*";
const PACKAGE_NAME_PATTERN = new RegExp(`^(@${NAME_COMPONENT}/)?${NAME_COMPONENT}$`);

export function isValidPackageName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 214 && PACKAGE_NAME_PATTERN.test(value);
}
