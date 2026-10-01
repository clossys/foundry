import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { resolveFrontDoorCopy } from "@clossys/writer";
import type { FrontDoorKey, FrontDoorNouns } from "@clossys/writer";
import { Button, TextField } from "@clossys/designer/atoms";
import { Form } from "@clossys/designer/blocks";
import { RenderError } from "../../internal/errors.js";

/** Why a sign-in step did not go through. The set is closed. */
export type SignInFailure = "credential" | "notFound" | "rateLimited" | "locked" | "network" | "unavailable";

/**
 * What every handler answers. Only `verify` may answer `needsCode`, and only
 * when `verifyCode` is given; anywhere else it reads as `unavailable`.
 */
export type SignInResult = { status: "ok" } | { status: "needsCode" } | { status: SignInFailure };

export interface SignInFormProps {
  /** Looks the identifier up. Receives it trimmed. A rejection is read as `unavailable`. */
  identify: (identifier: string) => Promise<SignInResult>;
  /**
   * Checks the password for the identifier `identify` accepted. `needsCode`
   * moves to the code step when `verifyCode` is given. A rejection is read as
   * `unavailable`.
   */
  verify: (secret: string) => Promise<SignInResult>;
  /**
   * Checks the one-time code sent after the password, on the optional code
   * step. Receives it trimmed. Without it, a `needsCode` from `verify` reads as
   * `unavailable`. A rejection is read as `unavailable`.
   */
  verifyCode?: (code: string) => Promise<SignInResult>;
  /**
   * Sends a new code from the code step. Without it the code step shows no
   * resend control. Any cooldown is the caller's: answer `rateLimited`. A
   * rejection is read as `unavailable`.
   */
  resendCode?: () => Promise<SignInResult>;
  /**
   * Keeps the form on screen with the unavailable notice in its alert from the
   * first render, and its submit and resend controls disabled; no handler is
   * called. Pair it with `AuthView`'s `isDisabled`.
   */
  unavailable?: boolean;
  /** Called once, after `verify` or `verifyCode` answers `ok`. Navigation is the caller's. */
  onSignedIn: () => void;
  /** Nouns for the shipped copy, such as `surface`. The identifier noun is the visitor's own entry. */
  nouns?: Omit<FrontDoorNouns, "identifier">;
}

type Step = "identify" | "password" | "code";

const FAILURE_NOTICE: Record<Exclude<SignInFailure, "credential" | "notFound">, FrontDoorKey> = {
  rateLimited: "front-door.rate-limited.notice",
  locked: "front-door.locked.notice",
  network: "front-door.network.notice",
  unavailable: "front-door.unavailable.notice",
};

const FIELD_ERROR_FOR_STEP: Record<Step, FrontDoorKey> = {
  identify: "front-door.identifier-not-found.notice",
  password: "front-door.password.notice",
  code: "front-door.code.notice",
};

const REQUIRED_FOR_STEP: Record<Step, FrontDoorKey> = {
  identify: "front-door.identifier-required.notice",
  password: "front-door.password-required.notice",
  code: "front-door.code-required.notice",
};

/** The alert for a status that is neither `ok` nor a field error. Anything outside the union, `needsCode` included, is `unavailable`. */
function alertFor(status: unknown): FrontDoorKey {
  return status === "rateLimited" || status === "locked" || status === "network" ? FAILURE_NOTICE[status] : FAILURE_NOTICE.unavailable;
}

/** Runs one handler and returns its status, unchecked. A throw, sync or async, reads as `unavailable`. */
async function settle(run: () => Promise<SignInResult> | undefined): Promise<unknown> {
  try {
    return (await run())?.status;
  } catch {
    return "unavailable";
  }
}

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
 * password step, then an optional code step. It calls no identity provider
 * and reads no browser global: the caller injects `identify`, `verify` and,
 * for the code step, `verifyCode` and `resendCode`, and decides where to go in
 * `onSignedIn`. Render it inside `AuthView`'s form slot; the page's only
 * `<h1>` stays `AuthView`'s.
 *
 * The code step is a second step after a correct password, not a first
 * factor: it shows only when `verify` answers `needsCode` and `verifyCode` is
 * given. A `needsCode` from `identify` or `verifyCode`, or from `verify`
 * without `verifyCode`, reads as `unavailable`, so the form never shows a
 * step it cannot finish.
 *
 * What it guarantees: nothing is validated before a submit or on blur, and an
 * empty submit shows its notice inline and calls no handler; `credential` and
 * `notFound` show inline on the step's own field (the identify step reads
 * both as "no account", the password step as "wrong password", the code step
 * as "wrong or expired code"), and `rateLimited`, `locked`, `network` and
 * `unavailable` show in the form's one `submitError` alert, so a failure is
 * never shown twice; an inline error clears when its field changes; the
 * submit and resend buttons are pending, never `disabled`, while a call is in
 * flight, and a second submit or resend is ignored; a resend that answers
 * `ok` clears the code and its error, and a failed one shows in the alert and
 * keeps the step; after `verify` or `verifyCode` answers `ok` the button stays
 * pending and `onSignedIn` is called once; a handler that throws, or answers
 * anything outside `SignInResult`, reads as `unavailable`; the one back
 * control returns to the identifier step with the identifier kept and the
 * password and code cleared; a step change moves focus to the new step's
 * field; `unavailable` shows its notice from the first render, disables the
 * submit and resend buttons and calls nothing, and keeps the form on screen;
 * and every visible word is resolved through `resolveFrontDoorCopy`, so
 * incomplete `nouns` throw `RenderError` `resolution-failed` on render,
 * naming the id and never a noun.
 *
 * What it does not do: no passkey, SSO, sign-up or one-time-code first
 * factor, no redirect, no resend cooldown, and no password reset link.
 */
export function SignInForm({ identify, verify, verifyCode, resendCode, unavailable = false, onSignedIn, nouns }: SignInFormProps) {
  const [step, setStep] = useState<Step>("identify");
  const [identifier, setIdentifier] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [fieldNotice, setFieldNotice] = useState<FrontDoorKey | null>(null);
  const [alertNotice, setAlertNotice] = useState<FrontDoorKey | null>(null);

  const handlers = useRef({ identify, verify, verifyCode, resendCode, onSignedIn, unavailable });
  handlers.current = { identify, verify, verifyCode, resendCode, onSignedIn, unavailable };
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
    codeTitle: copyFor("front-door.code.title", known),
    codeLabel: copyFor("front-door.code.label", known),
    codePrimary: copyFor("front-door.code.primary", known),
    codeSecondary: copyFor("front-door.code.secondary", known),
    identifierRequired: copyFor("front-door.identifier-required.notice", known),
    passwordRequired: copyFor("front-door.password-required.notice", known),
    codeRequired: copyFor("front-door.code-required.notice", known),
    identifierNotFound: copyFor("front-door.identifier-not-found.notice", known),
    passwordNotice: copyFor("front-door.password.notice", known),
    codeNotice: copyFor("front-door.code.notice", known),
    rateLimited: copyFor("front-door.rate-limited.notice", known),
    locked: copyFor("front-door.locked.notice", known),
    network: copyFor("front-door.network.notice", known),
    unavailable: copyFor("front-door.unavailable.notice", known),
  };
  const passwordDescription = step === "password" ? copyFor("front-door.password.description", known) : null;
  const codeDescription = step === "code" ? copyFor("front-door.code.description", known) : null;
  const noticeText: Partial<Record<FrontDoorKey, string>> = {
    "front-door.identifier-required.notice": text.identifierRequired,
    "front-door.password-required.notice": text.passwordRequired,
    "front-door.code-required.notice": text.codeRequired,
    "front-door.identifier-not-found.notice": text.identifierNotFound,
    "front-door.password.notice": text.passwordNotice,
    "front-door.code.notice": text.codeNotice,
    "front-door.rate-limited.notice": text.rateLimited,
    "front-door.locked.notice": text.locked,
    "front-door.network.notice": text.network,
    "front-door.unavailable.notice": text.unavailable,
  };

  function signIn() {
    // The button stays pending: the caller is navigating away.
    if (!signedIn.current) {
      signedIn.current = true;
      handlers.current.onSignedIn();
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (inFlight.current || handlers.current.unavailable) return;

    const value = step === "identify" ? identifier.trim() : step === "password" ? secret : code.trim();
    if (value === "") {
      setAlertNotice(null);
      setFieldNotice(REQUIRED_FOR_STEP[step]);
      return;
    }

    inFlight.current = true;
    setPending(true);
    setFieldNotice(null);
    setAlertNotice(null);

    const current = handlers.current;
    const status = await settle(() =>
      step === "identify" ? current.identify(value) : step === "password" ? current.verify(value) : current.verifyCode?.(value),
    );

    if (status === "ok") {
      if (step === "identify") {
        setSecret("");
        setStep("password");
      } else {
        signIn();
        return;
      }
    } else if (status === "needsCode" && step === "password" && handlers.current.verifyCode !== undefined) {
      setSecret("");
      setCode("");
      setStep("code");
    } else if (status === "credential" || status === "notFound") {
      setFieldNotice(FIELD_ERROR_FOR_STEP[step]);
    } else {
      // Anything else, including a stray `needsCode` or a status outside the union, is a failure to sign in, never silence.
      setAlertNotice(alertFor(status));
    }
    inFlight.current = false;
    setPending(false);
  }

  async function resend() {
    if (inFlight.current || handlers.current.unavailable) return;
    inFlight.current = true;
    setResending(true);
    setAlertNotice(null);

    const current = handlers.current;
    const status = await settle(() => current.resendCode?.());

    if (status === "ok") {
      setCode("");
      setFieldNotice(null);
    } else {
      setAlertNotice(alertFor(status));
    }
    inFlight.current = false;
    setResending(false);
  }

  // The code needs no clearing here: entering the code step always starts it empty.
  function changeIdentifier() {
    if (inFlight.current) return;
    setSecret("");
    setFieldNotice(null);
    setAlertNotice(null);
    setStep("identify");
  }

  const fieldError = fieldNotice === null ? undefined : noticeText[fieldNotice];
  const submitError = unavailable ? text.unavailable : alertNotice === null ? undefined : noticeText[alertNotice];

  if (step === "identify") {
    return (
      <Form
        aria-label={text.identifyTitle}
        onSubmit={submit}
        noValidate
        submitError={submitError}
        actions={
          <Button type="submit" isPending={pending} isDisabled={unavailable}>
            {text.identifyPrimary}
          </Button>
        }
      >
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

  const back = (
    <Button type="button" variant="ghost" onPress={changeIdentifier}>
      {text.passwordSecondary}
    </Button>
  );

  if (step === "code") {
    return (
      <Form
        aria-label={text.codeTitle}
        onSubmit={submit}
        noValidate
        submitError={submitError}
        actions={
          <>
            <Button type="submit" isPending={pending} isDisabled={unavailable}>
              {text.codePrimary}
            </Button>
            {resendCode === undefined ? null : (
              <Button type="button" variant="ghost" isPending={resending} isDisabled={unavailable} onPress={resend}>
                {text.codeSecondary}
              </Button>
            )}
            {back}
          </>
        }
      >
        <p className="text-body text-ink-secondary">{codeDescription}</p>
        <TextField
          id={`${fieldId}-code`}
          name="code"
          label={text.codeLabel}
          autoComplete="one-time-code"
          value={code}
          onChange={(value) => {
            setCode(value);
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
          <Button type="submit" isPending={pending} isDisabled={unavailable}>
            {text.passwordPrimary}
          </Button>
          {back}
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
