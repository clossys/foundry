import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { FrontDoorNouns } from "@clossys/writer";
import { Button, TextField } from "@clossys/designer/atoms";
import { Form } from "@clossys/designer/blocks";
import { resolveFormCopy, useFocusRequest } from "./frontDoorFormSupport.js";

/** Why an activation did not go through. The set is closed. */
export type ActivateFailure = "expired" | "weakPassword" | "rateLimited" | "network" | "unavailable";

/** What `activate` answers. */
export type ActivateResult = { status: "ok" } | { status: ActivateFailure };

/** What the visitor chose. `firstName` and `lastName` are present, trimmed, only when `collectName` is set. */
export interface ActivateDetails {
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface ActivateFormProps {
  /** Sets the password for the invitation. Called only on submit. A rejection is read as `unavailable`. */
  activate: (details: ActivateDetails) => Promise<ActivateResult>;
  /** Called once, after `activate` answers `ok`. Navigation is the caller's. */
  onActivated: () => void;
  /** Also asks for a first and a last name, both required. */
  collectName?: boolean;
  /**
   * The identity service cannot be used right now. The form stays visible,
   * its fields and button are disabled, the unavailable notice shows in the
   * form's alert from the first render, and `activate` is never called.
   */
  unavailable?: boolean;
  /** Nouns for the shipped copy, such as `surface`. */
  nouns?: Omit<FrontDoorNouns, "identifier">;
}

type Field = "firstName" | "lastName" | "password";

const KEYS = [
  "front-door.activation.title",
  "front-door.activation.label",
  "front-door.activation-first-name.label",
  "front-door.activation-last-name.label",
  "front-door.activation.primary",
  "front-door.name-required.notice",
  "front-door.password-required.notice",
  "front-door.password-weak.notice",
  "front-door.activation.notice",
  "front-door.rate-limited.notice",
  "front-door.network.notice",
  "front-door.unavailable.notice",
] as const;

type Key = (typeof KEYS)[number];

const ALERT_NOTICE = new Map<unknown, Key>([
  ["expired", "front-door.activation.notice"],
  ["rateLimited", "front-door.rate-limited.notice"],
  ["network", "front-door.network.notice"],
]);

/**
 * A provider-free form for setting a password from an invitation. It calls
 * no identity provider and reads no browser global: the caller injects
 * `activate`, and decides where to go in `onActivated`. Render it inside
 * `AuthView`'s form slot; the page's only `<h1>` stays `AuthView`'s.
 *
 * What it guarantees: nothing is validated before a submit or on blur, and an
 * empty submit shows its notices inline, moves focus to the first field that
 * needs attention and calls no handler; `weakPassword` shows inline on the
 * password field, and `expired`, `rateLimited`, `network` and `unavailable`
 * show in the form's one `submitError` alert, so a failure is never shown
 * twice; an inline error clears when its field changes; the submit button is
 * pending, never `disabled`, while a call is in flight and a second submit is
 * ignored; after `activate` answers `ok` the button stays pending and
 * `onActivated` is called once; a handler that throws, or answers anything
 * outside `ActivateResult`, reads as `unavailable`; with `unavailable` set
 * the form stays visible, disabled, with the unavailable notice and calls
 * nothing; and every visible word is resolved through `resolveFrontDoorCopy`,
 * so incomplete `nouns` throw `RenderError` `resolution-failed` on render,
 * naming the id and never a noun.
 *
 * What it does not do: it shows no identifier, asks for no confirmation
 * field, and signs nobody in; that is `onActivated`'s.
 */
export function ActivateForm({ activate, onActivated, collectName = false, unavailable = false, nouns }: ActivateFormProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldNotices, setFieldNotices] = useState<Partial<Record<Field, Key>>>({});
  const [alertNotice, setAlertNotice] = useState<Key | null>(null);

  const handlers = useRef({ activate, onActivated, collectName, unavailable });
  handlers.current = { activate, onActivated, collectName, unavailable };
  const inFlight = useRef(false);
  const fieldId = useId();
  const focus = useFocusRequest(fieldId);

  // Resolved on every render, so incomplete nouns fail where the form is wired rather than when a failure first shows.
  const words = resolveFormCopy("ActivateForm", KEYS, { ...nouns });

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (handlers.current.unavailable || inFlight.current) return;

    const first = firstName.trim();
    const last = lastName.trim();
    const missing: Partial<Record<Field, Key>> = {};
    if (handlers.current.collectName) {
      if (first === "") missing.firstName = "front-door.name-required.notice";
      else if (last === "") missing.lastName = "front-door.name-required.notice";
    }
    if (password === "") missing.password = "front-door.password-required.notice";
    const firstMissing = (["firstName", "lastName", "password"] as const).find((field) => missing[field] !== undefined);
    if (firstMissing !== undefined) {
      setAlertNotice(null);
      setFieldNotices(missing);
      focus(firstMissing);
      return;
    }

    inFlight.current = true;
    setPending(true);
    setFieldNotices({});
    setAlertNotice(null);

    let result: ActivateResult | undefined;
    try {
      const details: ActivateDetails = handlers.current.collectName ? { password, firstName: first, lastName: last } : { password };
      result = await handlers.current.activate(details);
    } catch {
      result = { status: "unavailable" };
    }
    const status: unknown = result?.status;

    if (status === "ok") {
      // The button stays pending: the caller is navigating away, and nothing else may run.
      handlers.current.onActivated();
      return;
    }
    if (status === "weakPassword") {
      setFieldNotices({ password: "front-door.password-weak.notice" });
      focus("password");
    } else {
      // Anything else, including a status outside the union, is a failure to activate, never silence.
      setAlertNotice(ALERT_NOTICE.get(status) ?? "front-door.unavailable.notice");
    }
    inFlight.current = false;
    setPending(false);
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

  return (
    <Form
      aria-label={words["front-door.activation.title"]}
      onSubmit={submit}
      noValidate
      submitError={submitError}
      actions={
        <Button type="submit" isPending={pending} isDisabled={unavailable}>
          {words["front-door.activation.primary"]}
        </Button>
      }
    >
      {collectName ? (
        <>
          <TextField
            id={`${fieldId}-firstName`}
            name="firstName"
            label={words["front-door.activation-first-name.label"]}
            autoComplete="given-name"
            value={firstName}
            onChange={(value) => {
              setFirstName(value);
              clearNotice("firstName");
            }}
            isDisabled={unavailable}
            isInvalid={fieldError("firstName") !== undefined}
            errorMessage={fieldError("firstName")}
            validationBehavior="aria"
          />
          <TextField
            id={`${fieldId}-lastName`}
            name="lastName"
            label={words["front-door.activation-last-name.label"]}
            autoComplete="family-name"
            value={lastName}
            onChange={(value) => {
              setLastName(value);
              clearNotice("lastName");
            }}
            isDisabled={unavailable}
            isInvalid={fieldError("lastName") !== undefined}
            errorMessage={fieldError("lastName")}
            validationBehavior="aria"
          />
        </>
      ) : null}
      <TextField
        id={`${fieldId}-password`}
        name="password"
        type="password"
        label={words["front-door.activation.label"]}
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
