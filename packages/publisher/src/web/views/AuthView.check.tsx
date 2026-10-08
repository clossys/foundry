/**
 * Compile-time-only assertions about `AuthView`'s props. Named `.check.tsx`
 * rather than `.test.tsx` on purpose: this package's tsconfig excludes test
 * files from the real `tsc` run, so a `@ts-expect-error` inside one asserts
 * nothing. Nothing imports this file at runtime.
 */
import { AuthView } from "./AuthView.js";

// `brand` is required: SiteHeader needs the site identity.
// @ts-expect-error brand is required
export const withoutBrand = <AuthView heading="Sign in" description="Welcome back." form={null} />;

// There is no mode prop: a step differs by heading, form, and notes.
// @ts-expect-error AuthView has no mode prop
export const withMode = <AuthView brand="Acme" heading="Sign in" description="Welcome back." mode="signin" form={null} />;

// `description` is required: every step decides on a supporting line.
// @ts-expect-error description is required
export const withoutDescription = <AuthView brand="Acme" heading="Sign in" form={null} />;

// The view stays copy-free: it has no request-access prop, so it cannot grow a
// built-in request-access link. An alternate step arrives only as `notes`.
// @ts-expect-error AuthView has no requestAccess prop
export const withRequestAccess = <AuthView brand="Acme" heading="Sign in" description="Welcome back." requestAccess={null} form={null} />;

// `header` and `footer` replace the Designer chrome and take any node; the page still names its brand.
export const withOwnChrome = (
  <AuthView brand={null} header={<header />} footer={<footer />} heading="Sign in" description="Welcome back." form={null} />
);
