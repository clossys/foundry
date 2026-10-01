/**
 * Compile-time-only assertions about `ActivateForm`'s handler contract. Named
 * `.check.tsx` rather than `.test.tsx` on purpose: this package's tsconfig
 * excludes test files from the real `tsc` run, so a `@ts-expect-error`
 * inside one asserts nothing. Nothing imports this file at runtime.
 */
import { ActivateForm } from "./ActivateForm.js";

// The result union is closed: a status outside it is a type error.
// @ts-expect-error closed result union
export const withUnknownStatus = <ActivateForm activate={async () => ({ status: "credential" })} onActivated={() => {}} />;

// `locked` is a sign-in and reset failure, not an activation one.
// @ts-expect-error closed result union
export const withLocked = <ActivateForm activate={async () => ({ status: "locked" })} onActivated={() => {}} />;

// The handler receives the password, and the names only as optional strings.
export const withDetails = (
  <ActivateForm
    activate={async ({ password, firstName, lastName }) => {
      const typed: [string, string | undefined, string | undefined] = [password, firstName, lastName];
      return typed.length === 3 ? { status: "ok" } : { status: "unavailable" };
    }}
    onActivated={() => {}}
    collectName
    unavailable={false}
  />
);

// The identifier noun is the visitor's, not a prop.
// @ts-expect-error identifier is not a noun the caller supplies
export const withIdentifierNoun = <ActivateForm activate={async () => ({ status: "ok" })} onActivated={() => {}} nouns={{ identifier: "x" }} />;
