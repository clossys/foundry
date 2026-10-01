import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { FrontDoorNouns } from "@clossys/writer";
import { Button, TextField } from "@clossys/designer/atoms";
import { Form } from "@clossys/designer/blocks";
import { resolveFormCopy, useFocusRequest } from "./frontDoorFormSupport.js";

/** Why a reset step did not go through. The set is closed. */
export type ResetFailure = "credential" | "notFound" | "weakPassword" | "rateLimited" | "locked" | "network" | "unavailable";

/** What `request`, `reset` and `resendCode` answer. */
export type ResetResult = { status: "ok" } | { status: ResetFailure };

/** What the visitor entered on the second step. `code` is trimmed. */
export interface ResetDetails {
  code: string;
  password: string;
}

export interface ResetFormProps {
  /** Asks for a code to be sent to the identifier. Receives it trimmed. A rejection is read as `unavailable`. */
  request: (identifier: string) => Promise<ResetResult>;
  /** Sets the new password with the code. A rejection is read as `unavailable`. */
  reset: (details: ResetDetails) => Promise<ResetResult>;
  /** Sends the code again. When omitted, the form shows no resend control. A rejection is read as `unavailable`. */
  resendCode?: () => Promise<ResetResult>;
  /** Called once, after `reset` answers `ok`. Navigation is the caller's. */
  onReset: () => void;
  /**
   * The identity service cannot be used right now. The form stays visible,
   * its fields and button are disabled, the unavailable notice shows in the
   * form's alert from the first render, and no handler is ever called.
   */
  unavailable?: boolean;
  /** Nouns for the shipped copy, such as `surface`. The identifier noun is the visitor's own entry. */
  nouns?: Omit<FrontDoorNouns, "identifier">;
}

type Step = "request" | "reset";
type Field = "identifier" | "code" | "password";

const KEYS = [
  "front-door.sign-in.label",
  "front-door.reset.title",
  "front-door.reset.primary",
  "front-door.code.title",
  "front-door.code.label",
  "front-door.code.notice",
  "front-door.code.secondary",
  "front-door.reset.label",
  "front-door.reset-code.primary",
  "front-door.password.secondary",
  "front-door.identifier-required.notice",
  "front-door.code-required.notice",
  "front-door.password-required.notice",
  "front-door.identifier-not-found.notice",
  "front-door.password-weak.notice",
  "front-door.rate-limited.notice",
  "front-door.locked.notice",
  "front-door.network.notice",
  "front-door.unavailable.notice",
] as const;

type Key = (typeof KEYS)[number];

const ALERT_NOTICE = new Map<unknown, Key>([
  ["rateLimited", "front-door.rate-limited.notice"],
  ["locked", "front-door.locked.notice"],
  ["network", "front-door.network.notice"],
  ["unavailable", "front-door.unavailable.notice"],
]);

/**
 * A provider-free password reset form: an identifier step that asks for a
 * code, then a step for the code and the new password. It calls no identity
 * provider and reads no browser global: the caller injects `request`,
 * `reset` and, optionally, `resendCode`, and decides where to go in
 * `onReset`. Render it inside `AuthView`'s form slot; the page's only `<h1>`
 * stays `AuthView`'s.
 *
 * What it guarantees: nothing is validated before a submit or on blur, and an
 * empty submit shows its notices inline, moves focus to the first empty field
 * and calls no handler. Each answer has one place: on the identifier step
 * `notFound` shows inline on the field; on the second step `credential` shows
 * inline on the code field and `weakPassword` inline on the new password
 * field; `rateLimited`, `locked`, `network` and `unavailable` show in the
 * form's one `submitError` alert, so a failure is never shown twice. An answer
 * that makes no sense for the call (`credential` or `weakPassword` from
 * `request`, `notFound` from `reset`, anything but the alert failures from
 * `resendCode`) reads as `unavailable`, as does a handler that throws or
 * answers outside `ResetResult`. An inline error clears when its field
 * changes; the submit button is pending, never `disabled`, while a call is in
 * flight and a second submit is ignored; after `reset` answers `ok` the button
 * stays pending and `onReset` is called once; a `request` answer of `ok` moves
 * focus to the code field; the one ghost control returns to the identifier
 * step with the identifier kept and the code and password cleared; with
 * `unavailable` set the form stays visible, disabled, with the unavailable
 * notice, and calls nothing; and every visible word is resolved through
 * `resolveFrontDoorCopy`, so incomplete `nouns` throw `RenderError`
 * `resolution-failed` on render, naming the id and never a noun.
 *
 * What it does not do: no sign-in after the reset, no redirect, and no link
 * back to sign-in; those belong to the page.
 */
export function ResetForm({ request, reset, resendCode, onReset, unavailable = false, nouns }: ResetFormProps) {
  const [step, setStep] = useState<Step>("request");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<"submit" | "resend" | null>(null);
  const [fieldNotices, setFieldNotices] = useState<Partial<Record<Field, Key>>>({});
  const [alertNotice, setAlertNotice] = useState<Key | null>(null);

  const handlers = useRef({ request, reset, resendCode, onReset, unavailable });
  handlers.current = { request, reset, resendCode, onReset, unavailable };
  const inFlight = useRef(false);
  const fieldId = useId();
  const focus = useFocusRequest(fieldId);

  // Resolved on every render, so incomplete nouns fail where the form is wired rather than when a failure first shows.
  const words = resolveFormCopy("ResetForm", KEYS, { ...nouns });
  // The identifier is the visitor's own entry, so this line can only resolve once the second step shows it.
  const codeDescription = step === "reset" ? resolveFormCopy("ResetForm", ["front-door.code.description"], { ...nouns, identifier: identifier.trim() })["front-door.code.description"] : null;

  /** Marks a call in flight, clears the shown notices and returns the answer's status; a handler that throws answers `unavailable`. */
  async function call(kind: "submit" | "resend", run: () => Promise<ResetResult>): Promise<unknown> {
    inFlight.current = true;
    setPending(kind);
    setFieldNotices({});
    setAlertNotice(null);
    try {
      return (await run())?.status;
    } catch {
      return "unavailable";
    }
  }

  function settle() {
    inFlight.current = false;
    setPending(null);
  }

  function showAlert(status: unknown) {
    // Anything else, including a status outside the union, is a failure, never silence.
    setAlertNotice(ALERT_NOTICE.get(status) ?? "front-door.unavailable.notice");
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (handlers.current.unavailable || inFlight.current) return;

    if (step === "request") {
      const value = identifier.trim();
      if (value === "") {
        setAlertNotice(null);
        setFieldNotices({ identifier: "front-door.identifier-required.notice" });
        focus("identifier");
        return;
      }
      const status = await call("submit", () => handlers.current.request(value));
      if (status === "ok") {
        setCode("");
        setPassword("");
        setStep("reset");
        focus("code");
      } else if (status === "notFound") {
        setFieldNotices({ identifier: "front-door.identifier-not-found.notice" });
      } else {
        showAlert(status);
      }
      settle();
      return;
    }

    const trimmed = code.trim();
    const missing: Partial<Record<Field, Key>> = {};
    if (trimmed === "") missing.code = "front-door.code-required.notice";
    if (password === "") missing.password = "front-door.password-required.notice";
    if (missing.code !== undefined || missing.password !== undefined) {
      setAlertNotice(null);
      setFieldNotices(missing);
      focus(missing.code !== undefined ? "code" : "password");
      return;
    }

    const status = await call("submit", () => handlers.current.reset({ code: trimmed, password }));
    if (status === "ok") {
      // The button stays pending: the caller is navigating away, and nothing else may run.
      handlers.current.onReset();
      return;
    }
    if (status === "credential") {
      setFieldNotices({ code: "front-door.code.notice" });
      focus("code");
    } else if (status === "weakPassword") {
      setFieldNotices({ password: "front-door.password-weak.notice" });
      focus("password");
    } else {
      showAlert(status);
    }
    settle();
  }

  async function resend() {
    const send = handlers.current.resendCode;
    if (send === undefined || handlers.current.unavailable || inFlight.current) return;
    const status = await call("resend", send);
    if (status === "ok") {
      setCode("");
      focus("code");
    } else {
      showAlert(status);
    }
    settle();
  }

  function changeIdentifier() {
    if (inFlight.current) return;
    setCode("");
    setPassword("");
    setFieldNotices({});
    setAlertNotice(null);
    setStep("request");
    focus("identifier");
  }

  function clearNotice(field: Field) {
    setFieldNotices((previous) => {
      if (previous[field] === undefined) return previous;
      const { [field]: _removed, ...rest } = previous;
      return rest;
    });
  }

  const fieldError = (field: Field) => {
    const key = fieldNotices[field];
    return key === undefined ? undefined : words[key];
  };
  const submitError = unavailable ? words["front-door.unavailable.notice"] : alertNotice === null ? undefined : words[alertNotice];

  if (step === "request") {
    return (
      <Form
        aria-label={words["front-door.reset.title"]}
        onSubmit={submit}
        noValidate
        submitError={submitError}
        actions={
          <Button type="submit" isPending={pending === "submit"} isDisabled={unavailable}>
            {words["front-door.reset.primary"]}
          </Button>
        }
      >
        <TextField
          id={`${fieldId}-identifier`}
          name="identifier"
          label={words["front-door.sign-in.label"]}
          autoComplete="username"
          value={identifier}
          onChange={(value) => {
            setIdentifier(value);
            clearNotice("identifier");
          }}
          isDisabled={unavailable}
          isInvalid={fieldError("identifier") !== undefined}
          errorMessage={fieldError("identifier")}
          validationBehavior="aria"
        />
      </Form>
    );
  }

  return (
    <Form
      aria-label={words["front-door.code.title"]}
      onSubmit={submit}
      noValidate
      submitError={submitError}
      actions={
        <>
          <Button type="submit" isPending={pending === "submit"} isDisabled={unavailable}>
            {words["front-door.reset-code.primary"]}
          </Button>
          {resendCode === undefined ? null : (
            <Button type="button" variant="ghost" onPress={resend} isPending={pending === "resend"} isDisabled={unavailable}>
              {words["front-door.code.secondary"]}
            </Button>
          )}
          <Button type="button" variant="ghost" onPress={changeIdentifier} isDisabled={unavailable}>
            {words["front-door.password.secondary"]}
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-secondary">{codeDescription}</p>
      <TextField
        id={`${fieldId}-code`}
        name="code"
        label={words["front-door.code.label"]}
        autoComplete="one-time-code"
        value={code}
        onChange={(value) => {
          setCode(value);
          clearNotice("code");
        }}
        isDisabled={unavailable}
        isInvalid={fieldError("code") !== undefined}
        errorMessage={fieldError("code")}
        validationBehavior="aria"
      />
      <TextField
        id={`${fieldId}-password`}
        name="password"
        type="password"
        label={words["front-door.reset.label"]}
        autoComplete="new-password"
        value={password}
        onChange={(value) => {
          setPassword(value);
          clearNotice("password");
        }}
        isDisabled={unavailable}
        isInvalid={fieldError("password") !== undefined}
        errorMessage={fieldError("password")}
        validationBehavior="aria"
      />
    </Form>
  );
}
