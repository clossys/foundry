# PageView

`PageView` is the shared content and form page from `@clossys/publisher/web`.
It renders a plain-text title, optional subtitle, one flat bordered plate,
and optional plain-text notes below the plate. All three text regions align
to the start edge. The view fills its containing column up to the existing
prose-width token and inherits the surrounding light or dark theme.

Use one content slot or one form slot. Supplying both is a type error and
is also refused at runtime. The view does not create a form, intercept its
submission, fetch data, persist state, or decide how a submission succeeds.
A form supplied by the host retains its accessible name and handlers.

```tsx
import { PageView } from "@clossys/publisher/web";

export function ContentPage() {
  return (
    <PageView
      title="About this project"
      subtitle="The information needed to get started."
      notes="Contact the project team for further details."
    >
      <p>The host supplies the page content.</p>
    </PageView>
  );
}
```

## Form slot

The browser entry also exports `PageView`. Create the form with an existing
form Block or factory, or supply a host-owned form, then pass that named form
as a slot. Existing options include `ContactForm`, `ActivateForm`, `ResetForm`
and `createSignInForm`; their contracts and submission handling stay with
those forms and their host.

```tsx
import type { ReactNode } from "react";
import { PageView } from "@clossys/publisher/web/client";

export function SignInPage({ form }: { form: ReactNode }) {
  return <PageView title="Sign in" form={form} notes="Use the account provided by your host." />;
}
```

The ordinary and React-server web entries expose the same server-safe
`PageView` export and `PageViewProps` type. Interactive form content remains
the supplied client component; the page layout needs no client hooks.

## Policy dates

`effectiveDate` and `updated` use the document-view metadata shape:
`{ dateTime, text }`, with a real ISO date or date-time and a `CopyRef` for
the complete visible label. Supply `resolveCopyId` whenever either line is
present. Missing or blank resolved copy and invalid dates are refused. The
view renders each label as escaped text in a semantic `time` element.

```tsx
import type { ReactNode } from "react";
import type { CopyResolver } from "@clossys/writer";
import { PageView } from "@clossys/publisher/web";

export function PolicyPage({ children, resolveCopyId }: {
  children: ReactNode;
  resolveCopyId: CopyResolver;
}) {
  return (
    <PageView
      title="Policy"
      effectiveDate={{ dateTime: "2026-10-01", text: { id: "policy.effective" } }}
      updated={{ dateTime: "2026-10-20", text: { id: "policy.updated" } }}
      resolveCopyId={resolveCopyId}
    >
      {children}
    </PageView>
  );
}
```

## Frame and migration

Render the view inside a frame. It supplies one `h1` and no `main`, banner,
footer or skip-link target; the frame owns those landmarks. Its root cannot
claim a frame landmark role or the frame's main ID. Keep headings inside
the content slot below the page's `h1`.

| Existing page | PageView composition |
| --- | --- |
| DocumentView | Supply the resolved title and rendered document content. Keep the existing structured-document validation and renderer before passing the resulting element. |
| LegalView | Supply the rendered policy content and its effective/update metadata. Keep legal-document validation with the document renderer. |
| CaptureView | Pass its named form through `form`, with its title and supporting text. |
| AuthView | Pass the host-created sign-in or account form through `form`. |
| ContactView | Pass the existing ContactForm through `form`; its host still owns submission and delivery. |

This addition removes no existing view. Use `StatusView` for an error,
not-found, empty or other status page that needs a call to action on the
background without a card. PageView has no public layout or mode switch.

The shared PageLayout retains its existing centered, raised-card defaults
for current callers. Only PageView opts into its internal plate and
start-alignment options.
