// Example fix: Supply the surface noun required by the shipped SignInForm copy.
import { SiteFrame, AuthView, CaptureView, DocumentView } from "@clossys/publisher/web";
const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const frame: import("@clossys/publisher/web").SiteFrameInput = {
  shell: {
    brand: { assetId: "brand-mark", label: { id: "brand.home" }, size: "md", variant: "mark" },
    skipLink: { id: "shell.skip" },
    footer: { legal: { entity: { id: "legal.entity" }, links: [{ href: "/privacy", label: { id: "legal.privacy" } }] } },
  },
  resolveCopy: fixtureResolveCopy,
  resolveAsset: () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example" }),
};
const { shell, resolveCopy, resolveAsset } = frame;
import { SignInForm } from "@clossys/publisher/web";
const ContactForm = () => <form><button type="submit">Send</button></form>;
const privacyDocument: import("@clossys/publisher/document").StructuredDocument = { id: "privacy", title: { id: "privacy.title" }, sections: [{ id: "about", kind: "section", level: 2, heading: { id: "privacy.about" }, blocks: [{ kind: "paragraph", content: [{ kind: "text", text: { id: "privacy.body" } }] }] }] };
const resolveCopyId = fixtureResolveCopy;
const identify: import("@clossys/publisher/web").SignInFormProps["identify"] = async () => ({ status: "ok" });
const verify: import("@clossys/publisher/web").SignInFormProps["verify"] = async () => ({ status: "ok" });
const goHome = (): void => {};

export default function Example() {
  return (<>
<SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
  <CaptureView
    heading="Talk to us"
    description="We reply within a week."
    form={<ContactForm />}
    notes={<a href="/help">Need help instead? Visit support</a>}
  />
</SiteFrame>

<SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
  <DocumentView
    document={privacyDocument}
    resolveCopyId={resolveCopyId}
    summary={{ id: "privacy.summary" }}
    action={<a href="/terms">Read the terms</a>}
  />
</SiteFrame>

<SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
  <AuthView
    heading="Sign in"
    description="Use your work email."
    form={<SignInForm nouns={{ surface: "Example" }} identify={identify} verify={verify} onSignedIn={goHome} />}
    notes={<a href="/reset">Forgot password?</a>}
  />
</SiteFrame>
</>);
}
