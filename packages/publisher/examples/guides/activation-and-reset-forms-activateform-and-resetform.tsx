import { ActivateForm, AuthView, ResetForm } from "@clossys/publisher/web";
import type { ActivateDetails, ActivateResult, ResetDetails, ResetResult } from "@clossys/publisher/web";

async function setPassword(_details: ActivateDetails): Promise<ActivateResult> { return { status: "ok" }; } // your handler
async function sendCode(_identifier: string): Promise<ResetResult> { return { status: "ok" }; } // your handler
async function changePassword(_details: ResetDetails): Promise<ResetResult> { return { status: "ok" }; } // your handler
async function sendCodeAgain(): Promise<ResetResult> { return { status: "ok" }; } // your handler
function goToSignIn(): void {}
function goToApp(): void {}
const identityServiceIsConfigured: boolean = true;

// Both pages render inside the SiteFrame their layout mounts, so they pass no chrome prop.
export function ActivatePage() {
  return (
    <AuthView
      heading="Set up your account"
      description="You’re invited to Acme Console. Choose a password to finish."
      isDisabled={!identityServiceIsConfigured}
      form={<ActivateForm activate={setPassword} onActivated={goToApp} collectName unavailable={!identityServiceIsConfigured} nouns={{ surface: "Acme Console" }} />}
    />
  );
}

export function ResetPage() {
  return (
    <AuthView
      heading="Reset your password"
      description="Enter your email and we’ll send you a code."
      form={<ResetForm request={sendCode} reset={changePassword} resendCode={sendCodeAgain} onReset={goToSignIn} nouns={{ surface: "Acme Console" }} />}
    />
  );
}

export default function Example() { return <><ActivatePage /><ResetPage /></>; }
