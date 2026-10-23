import { SignInForm, AuthView } from "@clossys/publisher/web/client";

const form = <SignInForm
  nouns={{ surface: "Example" }}
  identify={async () => ({ status: "ok" })}
  verify={async () => ({ status: "ok" })}
  onSignedIn={() => {}}
/>;
const page = <AuthView heading="Sign in" description="Continue" form={form} />; // inside the layout's SiteFrame

export default function Example() { return page; }
