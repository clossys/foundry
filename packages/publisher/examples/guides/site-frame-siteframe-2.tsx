const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const fixtureFrame: import("@clossys/publisher/web").SiteFrameInput = {
  shell: {
    brand: { assetId: "brand-mark", label: { id: "brand.home" }, size: "md", variant: "mark" },
    skipLink: { id: "shell.skip" },
    footer: { legal: { entity: { id: "legal.entity" }, links: [{ href: "/privacy", label: { id: "legal.privacy" } }] } },
  },
  resolveCopy: fixtureResolveCopy,
  resolveAsset: () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example" }),
};
import { SignInForm } from "@clossys/publisher/web";
const { resolveCopy, resolveAsset } = fixtureFrame;
const Home: import("@clossys/designer/atoms/server").IconNode = [["path", { d: "M3 12h18" }]];
const Settings = Home;
const signIn: import("@clossys/publisher/web").SignInFormProps = { nouns: { surface: "Example" }, identify: async () => ({ status: "ok" }), verify: async () => ({ status: "ok" }), onSignedIn: () => {} };

import { AuthView, SiteFrame, siteShellFor } from "@clossys/publisher/web";
import type { SiteFrameConfig } from "@clossys/publisher/web";

const frame: SiteFrameConfig = {
  brand: { assetId: "brand-mark", label: { id: "brand.name" }, size: "md", variant: "mark" },
  skipLink: { id: "shell.skipLink" },
  origin: "https://example.com",
  site: {
    nav: { label: { id: "nav.label" }, links: [{ href: "/pricing", label: { id: "nav.pricing" } }] },
    actions: [{ href: "/contact", label: { id: "nav.contact" } }],
    footerLinks: [{ href: "/about", label: { id: "footer.about" } }],
    social: { label: { id: "footer.profiles" }, links: [{ href: "https://social.example/profile", label: { id: "social.profile" }, icon: Home }] },
  },
  environments: [
    { surface: "front-door", href: "https://app.example.com/", label: { id: "env.app" }, icon: Home },
    { surface: "admin", href: "https://admin.example.com/", label: { id: "env.admin" }, icon: Settings },
  ],
  legal: {
    entity: { id: "legal.entity" },
    links: [
      { href: "/privacy", label: { id: "legal.privacy" } },
      { href: "/terms", label: { id: "legal.terms" } },
    ],
  },
};

export function SignInPage() {
  return (
    <SiteFrame shell={siteShellFor(frame, "front-door")} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
      <AuthView heading="Sign in" description="Use your work email." form={<SignInForm {...signIn} />} />
    </SiteFrame>
  );
}

export default SignInPage;
