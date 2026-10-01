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

// `needsCode` is in the union, and the code-step props and `unavailable` are optional additions.
export const withCodeStep = (
  <SignInForm
    identify={async () => ({ status: "ok" })}
    verify={async () => ({ status: "needsCode" })}
    verifyCode={async (_code: string) => ({ status: "credential" })}
    resendCode={async () => ({ status: "rateLimited" })}
    unavailable
    onSignedIn={() => {}}
  />
);

// `verifyCode` answers a `SignInResult`, not a bare status.
// @ts-expect-error verifyCode answers the result object
export const withBareCodeStatus = <SignInForm identify={async () => ({ status: "ok" })} verify={async () => ({ status: "ok" })} verifyCode={async () => "ok"} onSignedIn={() => {}} />;
