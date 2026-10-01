import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { resolveFrontDoorCopy } from "@clossys/writer";
import type { FrontDoorKey, FrontDoorNouns } from "@clossys/writer";
import { Button, TextField } from "@clossys/designer/atoms";
import { Form } from "@clossys/designer/blocks";
import { RenderError } from "../../internal/errors.js";

/** Why a sign-in step did not go through. The set is closed. */
export type SignInFailure = "credential" | "notFound" | "rateLimited" | "locked" | "network" | "unavailable";

/** What `identify` and `verify` answer. */
export type SignInResult = { status: "ok" } | { status: SignInFailure };

export interface SignInFormProps {
  /** Looks the identifier up. Receives it trimmed. A rejection is read as `unavailable`. */
  identify: (identifier: string) => Promise<SignInResult>;
  /** Checks the password for the identifier `identify` accepted. A rejection is read as `unavailable`. */
  verify: (secret: string) => Promise<SignInResult>;
  /** Called once, after `verify` answers `ok`. Navigation is the caller's. */
  onSignedIn: () => void;
  /** Nouns for the shipped copy, such as `surface`. The identifier noun is the visitor's own entry. */
  nouns?: Omit<FrontDoorNouns, "identifier">;
}

type Step = "identify" | "password";

const FAILURE_NOTICE: Record<Exclude<SignInFailure, "credential" | "notFound">, FrontDoorKey> = {
  rateLimited: "front-door.rate-limited.notice",
  locked: "front-door.locked.notice",
  network: "front-door.network.notice",
  unavailable: "front-door.unavailable.notice",
};

const FIELD_ERROR_FOR_STEP: Record<Step, FrontDoorKey> = {
  identify: "front-door.identifier-not-found.notice",
  password: "front-door.password.notice",
};

/** Resolves one shipped front-door entry. The message names the id's position in the catalog, never the caller's nouns. */
function copyFor(key: FrontDoorKey, nouns: FrontDoorNouns): string {
  const resolved = resolveFrontDoorCopy(key, nouns);
  if (!resolved.complete || resolved.text === undefined) {
    throw new RenderError("resolution-failed", `SignInForm could not resolve front-door copy "${key}".`);
  }
  return resolved.text;
}

/**
 * A provider-free, identifier-first sign-in form: an identifier step, then a
 * password step. It calls no identity provider and reads no browser global:
 * the caller injects `identify` and `verify`, and decides where to go in
 * `onSignedIn`. Render it inside `AuthView`'s form slot; the page's only
 * `<h1>` stays `AuthView`'s.
 *
 * What it guarantees: nothing is validated before a submit or on blur, and an
 * empty submit shows its notice inline and calls no handler; `credential` and
 * `notFound` show inline on the step's own field (the identify step reads
 * both as "no account", the password step as "wrong password"), and
 * `rateLimited`, `locked`, `network` and `unavailable` show in the form's one
 * `submitError` alert, so a failure is never shown twice; an inline error
 * clears when its field changes; the submit button is pending, never
 * `disabled`, while a call is in flight and a second submit is ignored; after
 * `verify` answers `ok` the button stays pending and `onSignedIn` is called
 * once; a handler that throws, or answers anything outside `SignInResult`,
 * reads as `unavailable`; the one back control returns to the identifier step
 * with the identifier kept and the password cleared; and every visible word
 * is resolved through `resolveFrontDoorCopy`, so incomplete `nouns` throw
 * `RenderError` `resolution-failed` on render, naming the id and never a noun.
 *
 * What it does not do: no passkey, SSO, sign-up or one-time-code first
 * factor, no redirect, and no password reset link.
 */
export function SignInForm({ identify, verify, onSignedIn, nouns }: SignInFormProps) {
  const [step, setStep] = useState<Step>("identify");
  const [identifier, setIdentifier] = useState("");
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldNotice, setFieldNotice] = useState<FrontDoorKey | null>(null);
  const [alertNotice, setAlertNotice] = useState<FrontDoorKey | null>(null);

  const handlers = useRef({ identify, verify, onSignedIn });
  handlers.current = { identify, verify, onSignedIn };
  const inFlight = useRef(false);
  const signedIn = useRef(false);
  const previousStep = useRef<Step>("identify");
  const fieldId = useId();

  // A step change, not the first render, moves focus to the new step's field.
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    document.getElementById(`${fieldId}-${step}`)?.focus();
  }, [step, fieldId]);

  // Resolved on every render, so incomplete nouns fail where the form is wired rather than when a failure first shows.
  const known: FrontDoorNouns = { ...nouns, identifier };
  const text = {
    identifierLabel: copyFor("front-door.sign-in.label", known),
    identifyTitle: copyFor("front-door.sign-in.title", known),
    identifyPrimary: copyFor("front-door.sign-in.primary", known),
    passwordTitle: copyFor("front-door.password.title", known),
    passwordLabel: copyFor("front-door.password.label", known),
    passwordPrimary: copyFor("front-door.password.primary", known),
    passwordSecondary: copyFor("front-door.password.secondary", known),
    identifierRequired: copyFor("front-door.identifier-required.notice", known),
    passwordRequired: copyFor("front-door.password-required.notice", known),
    identifierNotFound: copyFor("front-door.identifier-not-found.notice", known),
    passwordNotice: copyFor("front-door.password.notice", known),
    rateLimited: copyFor("front-door.rate-limited.notice", known),
    locked: copyFor("front-door.locked.notice", known),
    network: copyFor("front-door.network.notice", known),
    unavailable: copyFor("front-door.unavailable.notice", known),
  };
  const passwordDescription = step === "password" ? copyFor("front-door.password.description", known) : null;
  const noticeText: Partial<Record<FrontDoorKey, string>> = {
    "front-door.identifier-required.notice": text.identifierRequired,
    "front-door.password-required.notice": text.passwordRequired,
    "front-door.identifier-not-found.notice": text.identifierNotFound,
    "front-door.password.notice": text.passwordNotice,
    "front-door.rate-limited.notice": text.rateLimited,
    "front-door.locked.notice": text.locked,
    "front-door.network.notice": text.network,
    "front-door.unavailable.notice": text.unavailable,
  };

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (inFlight.current) return;

    const value = step === "identify" ? identifier.trim() : secret;
    if (value === "") {
      setAlertNotice(null);
      setFieldNotice(step === "identify" ? "front-door.identifier-required.notice" : "front-door.password-required.notice");
      return;
    }

    inFlight.current = true;
    setPending(true);
    setFieldNotice(null);
    setAlertNotice(null);

    let result: SignInResult | undefined;
    try {
      result = await (step === "identify" ? handlers.current.identify(value) : handlers.current.verify(value));
    } catch {
      result = { status: "unavailable" };
    }
    const status: unknown = result?.status;

    if (status === "ok") {
      if (step === "identify") {
        setSecret("");
        setStep("password");
      } else {
        // The button stays pending: the caller is navigating away.
        if (!signedIn.current) {
          signedIn.current = true;
          handlers.current.onSignedIn();
        }
        return;
      }
    } else if (status === "credential" || status === "notFound") {
      setFieldNotice(FIELD_ERROR_FOR_STEP[step]);
    } else {
      // Anything else, including a status outside the union, is a failure to sign in, never silence.
      setAlertNotice(status === "rateLimited" || status === "locked" || status === "network" ? FAILURE_NOTICE[status] : FAILURE_NOTICE.unavailable);
    }
    inFlight.current = false;
    setPending(false);
  }

  function changeIdentifier() {
    if (inFlight.current) return;
    setSecret("");
    setFieldNotice(null);
    setAlertNotice(null);
    setStep("identify");
  }

  const fieldError = fieldNotice === null ? undefined : noticeText[fieldNotice];
  const submitError = alertNotice === null ? undefined : noticeText[alertNotice];

  if (step === "identify") {
    return (
      <Form aria-label={text.identifyTitle} onSubmit={submit} noValidate submitError={submitError} actions={<Button type="submit" isPending={pending}>{text.identifyPrimary}</Button>}>
        <TextField
          id={`${fieldId}-identify`}
          name="identifier"
          label={text.identifierLabel}
          autoComplete="username"
          value={identifier}
          onChange={(value) => {
            setIdentifier(value);
            setFieldNotice(null);
          }}
          isInvalid={fieldError !== undefined}
          errorMessage={fieldError}
          validationBehavior="aria"
        />
      </Form>
    );
  }

  return (
    <Form
      aria-label={text.passwordTitle}
      onSubmit={submit}
      noValidate
      submitError={submitError}
      actions={
        <>
          <Button type="submit" isPending={pending}>
            {text.passwordPrimary}
          </Button>
          <Button type="button" variant="ghost" onPress={changeIdentifier}>
            {text.passwordSecondary}
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-secondary">{passwordDescription}</p>
      <TextField
        id={`${fieldId}-password`}
        name="password"
        type="password"
        label={text.passwordLabel}
        autoComplete="current-password"
        value={secret}
        onChange={(value) => {
          setSecret(value);
          setFieldNotice(null);
        }}
        isInvalid={fieldError !== undefined}
        errorMessage={fieldError}
        validationBehavior="aria"
      />
    </Form>
  );
}
