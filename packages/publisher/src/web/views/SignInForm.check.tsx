/**
 * Compile-time-only assertions about `SignInForm`'s handler contract. Named
 * `.check.tsx` rather than `.test.tsx` on purpose: this package's tsconfig
 * excludes test files from the real `tsc` run, so a `@ts-expect-error`
 * inside one asserts nothing. Nothing imports this file at runtime.
 */
import { SignInForm } from "./SignInForm.js";

// The result union is closed: a status outside it is a type error.
// @ts-expect-error closed result union
export const withUnknownStatus = <SignInForm identify={async () => ({ status: "expired" })} verify={async () => ({ status: "ok" })} onSignedIn={() => {}} />;
