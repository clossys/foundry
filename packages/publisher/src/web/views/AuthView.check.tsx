/**
 * Compile-time-only assertions about `AuthView`'s props. Named `.check.tsx`
 * rather than `.test.tsx` on purpose: this package's tsconfig excludes test
 * files from the real `tsc` run, so a `@ts-expect-error` inside one asserts
 * nothing. Nothing imports this file at runtime.
 */
import { AuthView } from "./AuthView.js";

// Without any chrome prop the view is chrome-free content for a `SiteFrame`:
// `brand` is optional and deprecated, like every other chrome prop.
export const withoutBrand = <AuthView heading="Sign in" description="Welcome back." form={null} />;

// Chrome-free content still requires its own content: the heading.
// @ts-expect-error heading is required
export const withoutHeading = <AuthView description="Welcome back." form={null} />;

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

// `internalNote` is deprecated and still accepted for one release, with its
// earlier shape, so an existing call site keeps compiling on the frame and on
// the legacy page; the runtime tests prove nothing renders from it.
export const withInternalNote = <AuthView heading="Sign in" description="Welcome back." form={null} internalNote={{ label: "Internal", message: "Keys are not set." }} />;
export const withInternalNoteOnLegacyPage = <AuthView brand="Acme" heading="Sign in" description="Welcome back." form={null} internalNote={{ label: "Internal", message: "Keys are not set." }} />;
// It keeps only that shape: a bare string was never accepted.
// @ts-expect-error internalNote takes { label, message }
export const withStringInternalNote = <AuthView heading="Sign in" description="Welcome back." form={null} internalNote="Keys are not set." />;
