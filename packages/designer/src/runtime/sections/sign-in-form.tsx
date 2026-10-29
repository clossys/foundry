import type { SurfaceRendererEntry } from "../../studio/surface-renderer-contract.js";
/** Private sign-in composition. The Section host owns every value, phase and action. */
import { useId } from "react";
import type { ReactNode } from "react";
import { Form as FoundryForm } from "../../blocks/Form.js";
import { ContentSection } from "../../blocks/ContentSection.js";
import { Button } from "../../components/Button.js";
import { TextField } from "../../components/TextField.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";

import { object, optionalText, readSectionContent, required, SectionContentError, text, type JsonObject, type SectionContent } from "./group-a-content.js";

const LEAF = "sections.sign-in-form";
const STAMP = dsAttrs("sections", LEAF, "foundry/sections.sign-in-form");
export const signInFormInputs = { slots: ["header", "providers", "credentials", "verification", "actions", "error"], members: ["sign-in.password", "sign-in.provider", "sign-in.verify"] } as const;
type Phase = "credentials" | "code";
type ValueKey = "identifier" | "password" | "code";
/** Delivered through the existing ConsumerRuntimePorts.sectionHosts[leaf] port. */
interface SignInHost {
  readonly phase: Phase;
  readonly values: Readonly<Record<ValueKey, string>>;
  readonly pending: boolean;
  readonly onValueChange: (field: ValueKey, value: string) => void;
  readonly onSubmit: (phase: Phase) => void;
  readonly onProvider?: (id: string) => void;
  readonly onBack?: () => void;
  readonly onResend?: () => void;
}
interface SignInCopy {
  readonly heading: string;
  readonly description?: string;
  readonly providers: readonly { readonly id: string; readonly label: string }[];
  readonly identifierLabel: string;
  readonly identifierPlaceholder?: string;
  readonly passwordLabel: string;
  readonly passwordPlaceholder?: string;
  readonly codeLabel: string;
  readonly codeDescription?: string;
  readonly codePlaceholder?: string;
  readonly submit: string;
  readonly verify: string;
  readonly pending: string;
  readonly back: string;
  readonly resend: string;
  readonly divider: string;
  readonly error?: string;
  readonly identifierError?: string;
  readonly passwordError?: string;
  readonly codeError?: string;
}

function record(content: SectionContent, slot: string, keys: readonly string[], optional = false): JsonObject {
  const value = optional ? content.values[slot] : required(content, slot);
  if (optional && value === undefined) return {};
  const row = object(content, value, slot);
  for (const key of Object.keys(row)) if (!keys.includes(key)) throw new SectionContentError(LEAF, `${slot}.${key} is not supported`);
  return row;
}

function copyOf(input: RuntimeRenderInput<ReactNode>): SignInCopy {
  const content = readSectionContent(input, LEAF, signInFormInputs);
  const header = record(content, "header", ["heading", "description"]);
  const credentials = record(content, "credentials", ["identifierLabel", "identifierPlaceholder", "passwordLabel", "passwordPlaceholder"]);
  const verification = record(content, "verification", ["codeLabel", "description", "placeholder"]);
  const actions = record(content, "actions", ["submit", "verify", "pending", "back", "resend", "divider"]);
  const error = record(content, "error", ["message", "identifier", "password", "code"], true);
  const providers = content.values.providers ?? [];
  if (!Array.isArray(providers) || providers.length > 4) throw new SectionContentError(LEAF, "providers must be a list of at most four provider actions");
  const seen = new Set<string>();
  const providerRows = providers.map((value, index) => {
    const row = object(content, value, `providers.${index}`);
    if (Object.keys(row).some(key => key !== "id" && key !== "label")) throw new SectionContentError(LEAF, `providers.${index} only accepts id and label`);
    const id = text(content, row.id, `providers.${index}.id`);
    if (!/^[a-z][a-z0-9-]*$/.test(id) || seen.has(id)) throw new SectionContentError(LEAF, "providers need unique action ids");
    seen.add(id);
    return { id, label: text(content, row.label, `providers.${index}.label`) };
  });
  return {
    heading: text(content, header.heading, "header.heading"), description: optionalText(content, header.description, "header.description"), providers: providerRows,
    identifierLabel: text(content, credentials.identifierLabel, "credentials.identifierLabel"), identifierPlaceholder: optionalText(content, credentials.identifierPlaceholder, "credentials.identifierPlaceholder"),
    passwordLabel: text(content, credentials.passwordLabel, "credentials.passwordLabel"), passwordPlaceholder: optionalText(content, credentials.passwordPlaceholder, "credentials.passwordPlaceholder"),
    codeLabel: text(content, verification.codeLabel, "verification.codeLabel"), codeDescription: optionalText(content, verification.description, "verification.description"), codePlaceholder: optionalText(content, verification.placeholder, "verification.placeholder"),
    submit: text(content, actions.submit, "actions.submit"), verify: text(content, actions.verify, "actions.verify"), pending: text(content, actions.pending, "actions.pending"),
    back: text(content, actions.back, "actions.back"), resend: text(content, actions.resend, "actions.resend"), divider: text(content, actions.divider, "actions.divider"),
    error: optionalText(content, error.message, "error.message"), identifierError: optionalText(content, error.identifier, "error.identifier"), passwordError: optionalText(content, error.password, "error.password"), codeError: optionalText(content, error.code, "error.code"),
  };
}

function hostOf(input: RuntimeRenderInput<ReactNode>, copy: SignInCopy): SignInHost | undefined {
  if (input.sectionHost === undefined) return undefined;
  const host = input.sectionHost as Partial<SignInHost>;
  if (!host || !(host.phase === "credentials" || host.phase === "code") || typeof host.pending !== "boolean"
    || !host.values || ["identifier", "password", "code"].some(key => typeof host.values?.[key as ValueKey] !== "string")
    || typeof host.onValueChange !== "function" || typeof host.onSubmit !== "function"
    || (host.phase === "credentials" && copy.providers.length > 0 && typeof host.onProvider !== "function")
    || (host.phase === "code" && (typeof host.onBack !== "function" || typeof host.onResend !== "function"))) {
    throw new TypeError(`${LEAF}: sectionHost needs controlled phase, values, pending and callbacks for its visible actions`);
  }
  return host as SignInHost;
}

function SignInForm({ copy, host }: { readonly copy: SignInCopy; readonly host?: SignInHost }) {
  const headingId = useId();
  const phase = host?.phase ?? "credentials", pending = host?.pending ?? false;
  const values = host?.values ?? { identifier: "", password: "", code: "" };
  const change = (key: ValueKey, value: string) => { if (host && !pending) host.onValueChange(key, value); };
  return (
    <ContentSection {...STAMP} headingId={headingId} heading={<span dir="auto">{copy.heading}</span>}
      description={copy.description ? <span dir="auto">{copy.description}</span> : undefined}>
      <FoundryForm {...STAMP} aria-labelledby={headingId} aria-busy={pending || undefined} noValidate actionsLayout="stretch"
        onSubmit={event => { event.preventDefault(); if (host && !pending) host.onSubmit(phase); }}
        submitError={copy.error ? <span dir="auto">{copy.error}</span> : undefined}
        actions={<>
          {phase === "code" ? <>
            <Button type="button" variant="secondary" isDisabled={!host || pending} onPress={() => host?.onBack?.()}><span dir="auto">{copy.back}</span></Button>
            <Button type="button" variant="ghost" isDisabled={!host || pending} onPress={() => host?.onResend?.()}><span dir="auto">{copy.resend}</span></Button>
          </> : null}
          <Button type="submit" variant="primary" isDisabled={!host} isPending={pending}>
            <span dir="auto">{pending ? copy.pending : phase === "code" ? copy.verify : copy.submit}</span>
          </Button>
        </>}>
        {phase === "credentials" ? <>
          {copy.providers.length ? <>
            <div className="flex flex-col gap-sm">
              {copy.providers.map(provider => <Button key={provider.id} type="button" variant="secondary" isDisabled={!host || pending}
                onPress={() => { if (host && !pending) host.onProvider?.(provider.id); }}><span dir="auto">{provider.label}</span></Button>)}
            </div>
            <p dir="auto" className="text-body-s text-ink-muted">{copy.divider}</p>
          </> : null}
          <TextField name="identifier" type="text" dir="auto" autoComplete="username" value={values.identifier} onChange={value => change("identifier", value)}
            label={<span dir="auto">{copy.identifierLabel}</span>} placeholder={copy.identifierPlaceholder} isRequired isDisabled={!host} isReadOnly={pending}
            validationBehavior="aria" isInvalid={!!copy.identifierError} errorMessage={copy.identifierError ? <span dir="auto">{copy.identifierError}</span> : undefined} />
          <TextField name="password" type="password" dir="auto" autoComplete="current-password" value={values.password} onChange={value => change("password", value)}
            label={<span dir="auto">{copy.passwordLabel}</span>} placeholder={copy.passwordPlaceholder} isRequired isDisabled={!host} isReadOnly={pending}
            validationBehavior="aria" isInvalid={!!copy.passwordError} errorMessage={copy.passwordError ? <span dir="auto">{copy.passwordError}</span> : undefined} />
        </> : <TextField name="code" type="text" dir="auto" autoComplete="one-time-code" value={values.code} onChange={value => change("code", value)}
          label={<span dir="auto">{copy.codeLabel}</span>} description={copy.codeDescription ? <span dir="auto">{copy.codeDescription}</span> : undefined} placeholder={copy.codePlaceholder} isRequired isReadOnly={pending}
          validationBehavior="aria" isInvalid={!!copy.codeError} errorMessage={copy.codeError ? <span dir="auto">{copy.codeError}</span> : undefined} />}
      </FoundryForm>
    </ContentSection>
  );
}

/** No live host means a disabled specimen. Rendering never attempts authentication or advances phases. */
export const signInFormRenderer: SurfaceRendererEntry = {
  leaf: LEAF,
  sample: () => ({
    header: { heading: "Sign in", description: "Continue to your workspace." },
    providers: [{ id: "work-sso", label: "Continue with work SSO" }],
    credentials: { identifierLabel: "Email or username", passwordLabel: "Password", identifierPlaceholder: "Your email or username" },
    verification: { codeLabel: "Verification code", description: "Enter the code from your sign-in method.", placeholder: "Your verification code" },
    actions: { submit: "Sign in", verify: "Verify code", pending: "Please wait", back: "Back", resend: "Resend code", divider: "Or use your credentials" },
  }),
  render(input) {
    const copy = copyOf(input);
    return <SignInForm copy={copy} host={hostOf(input, copy)} />;
  },
};
