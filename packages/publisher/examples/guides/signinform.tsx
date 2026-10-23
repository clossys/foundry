import { AuthView, SignInForm } from "@clossys/publisher/web";
import type { SignInResult } from "@clossys/publisher/web";

async function lookUp(_identifier: string): Promise<SignInResult> { return { status: "ok" }; } // your handler
async function check(_secret: string): Promise<SignInResult> { return { status: "ok" }; } // your handler
async function checkCode(_code: string): Promise<SignInResult> { return { status: "ok" }; } // optional, for the code step
async function sendNewCode(): Promise<SignInResult> { return { status: "ok" }; } // optional, for the code step
function goToApp(): void {}

// Rendered inside the SiteFrame its layout mounts, so it passes no chrome prop.
export function SignInPage() {
  return (
    <AuthView
      heading="Sign in"
      description="Continue to Acme Console."
      form={
        <SignInForm
          identify={lookUp}
          verify={check}
          verifyCode={checkCode}
          resendCode={sendNewCode}
          onSignedIn={goToApp}
          nouns={{ surface: "Acme Console" }}
        />
      }
    />
  );
}

export default SignInPage;
