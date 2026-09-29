/**
 * Compile-time-only assertions about `AuthView`'s props. Named `.check.tsx`
 * rather than `.test.tsx` on purpose: this package's tsconfig excludes test
 * files from the real `tsc` run, so a `@ts-expect-error` inside one asserts
 * nothing. Nothing imports this file at runtime.
 */
import { AuthView } from "./AuthView.js";

// `brand` is required: SiteHeader needs the site identity.
// @ts-expect-error brand is required
export const withoutBrand = <AuthView heading="Sign in" form={null} />;

// There is no mode prop: a step differs by heading, form, and secondaryAction.
// @ts-expect-error AuthView has no mode prop
export const withMode = <AuthView brand="Acme" heading="Sign in" mode="signin" form={null} />;
