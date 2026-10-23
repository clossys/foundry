// Example fix: Supply the surface noun required by the shipped SignInForm copy.
import { SiteHeader, SiteFooter } from "@clossys/designer/shell/server";
const Home: import("@clossys/designer/atoms/server").IconNode = [["path", { d: "M3 12h18" }]];
const Settings = Home;
const identify: import("@clossys/publisher/web").SignInFormProps["identify"] = async () => ({ status: "ok" });
const verify: import("@clossys/publisher/web").SignInFormProps["verify"] = async () => ({ status: "ok" });
const goHome = (): void => {};

import { AuthView, SignInForm } from "@clossys/publisher/web";

export default function Example() {
  return (<>
<AuthView
  brand={<a href="https://example.com/">Acme</a>}
  headerAction={
    <>
      <SiteHeader.ActionLink href="/" label="App" icon={Home} isCurrent />
      <SiteHeader.ActionLink href="https://admin.example.com/" label="Admin" icon={Settings} />
    </>
  }
  heading="Sign in"
  description="Use your work email."
  form={<SignInForm nouns={{ surface: "Example" }} identify={identify} verify={verify} onSignedIn={goHome} />}
  notes={<a href="/reset">Forgot password?</a>}
  footerSecondary={
    <SiteFooter.Legal
      entity="Acme"
      links={[
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
      ]}
    />
  }
/>
</>);
}
