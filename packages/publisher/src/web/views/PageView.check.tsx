/** Compiled public contract assertions; never imported by a runtime entry. */
import { PageView } from "./PageView.js";

const content = <PageView title="Details"><p>Content</p></PageView>;
const form = <PageView title="Sign in" form={<form aria-label="Sign in" />} />;
// @ts-expect-error Content and form cannot both be supplied.
const ambiguous = <PageView title="Details" form={<form />}><p>Content</p></PageView>;
// @ts-expect-error A public mode is not part of the unified view.
const mode = <PageView title="Details" mode="legal"><p>Content</p></PageView>;
// @ts-expect-error The visible title is plain text.
const title = <PageView title={<strong>Details</strong>}><p>Content</p></PageView>;
// @ts-expect-error Metadata copy needs its caller's resolver.
const meta = <PageView title="Policy" effectiveDate={{dateTime:"2026-10-01",text:{id:"date"}}}><p>Content</p></PageView>;
