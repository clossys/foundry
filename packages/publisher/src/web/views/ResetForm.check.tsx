/**
 * Compile-time-only assertions about `ResetForm`'s handler contract. Named
 * `.check.tsx` rather than `.test.tsx` on purpose: this package's tsconfig
 * excludes test files from the real `tsc` run, so a `@ts-expect-error`
 * inside one asserts nothing. Nothing imports this file at runtime.
 */
import { ResetForm } from "./ResetForm.js";

// The result union is closed: a status outside it is a type error.
// @ts-expect-error closed result union
export const withUnknownStatus = <ResetForm request={async () => ({ status: "expired" })} reset={async () => ({ status: "ok" })} onReset={() => {}} />;

// A handler that does not return a result is a type error.
// @ts-expect-error reset must answer a result
export const withNoAnswer = <ResetForm request={async () => ({ status: "ok" })} reset={async () => {}} onReset={() => {}} />;

// The code step's handler receives the code and the new password; the resend control is optional.
export const withDetails = (
  <ResetForm
    request={async (identifier: string) => (identifier === "" ? { status: "notFound" } : { status: "ok" })}
    reset={async ({ code, password }) => (code === password ? { status: "weakPassword" } : { status: "ok" })}
    resendCode={async () => ({ status: "rateLimited" })}
    onReset={() => {}}
    unavailable={false}
  />
);

// The identifier noun is the visitor's, not a prop.
// @ts-expect-error identifier is not a noun the caller supplies
export const withIdentifierNoun = <ResetForm request={async () => ({ status: "ok" })} reset={async () => ({ status: "ok" })} onReset={() => {}} nouns={{ identifier: "x" }} />;
