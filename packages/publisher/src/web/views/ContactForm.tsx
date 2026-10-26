import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { Button, Select, TextField, Textarea } from "@clossys/designer/components";
import { Form, useFormValidation } from "@clossys/designer/blocks";
import { RenderError } from "../../internal/errors.js";
import type { ContactResult } from "../contact/types.js";

/** Caller-approved copy for every word the form renders. */
export interface ContactFormCopy {
  /** Label of the topic select. */
  topicLabel: CopyRef;
  /** Placeholder of the topic select while nothing is chosen. */
  topicPlaceholder: CopyRef;
  nameLabel: CopyRef;
  emailLabel: CopyRef;
  /** Label of the optional phone field. */
  phoneLabel: CopyRef;
  messageLabel: CopyRef;
  /** The submit button's label. */
  submit: CopyRef;
  /** The submit button's label while a submission is in flight. */
  submitting: CopyRef;
  /** Heading of the error summary shown after a submit that failed client validation. */
  errorSummary: CopyRef;
  topicRequired: CopyRef;
  nameRequired: CopyRef;
  emailRequired: CopyRef;
  emailInvalid: CopyRef;
  messageRequired: CopyRef;
  /** Heading of the confirmation shown once the message is accepted. Receives focus. */
  sentHeading: CopyRef;
  /** Body of the confirmation. */
  sentBody: CopyRef;
  /** Short label leading every failure message (for example "Error"), so a failure reads as one without relying on colour. */
  failureLabel: CopyRef;
  /** Shown when the server answered `invalid`. Per-field mapping is not part of this form. */
  invalid: CopyRef;
  /** Shown when the server answered `rate-limited`. */
  rateLimited: CopyRef;
  /** Shown when the server answered `unavailable`, or when `onSubmit` rejected. */
  unavailable: CopyRef;
}

/** One topic the visitor can choose. `id` is what reaches `onSubmit`; `label` is what the visitor reads. */
export interface ContactFormTopic {
  /** Unique kebab-case id. Never rendered. */
  id: string;
  label: CopyRef;
}

/** Five declared fields plus the configured honeypot key; compatible with createContactHandler. */
export type ContactFormValues<Honeypot extends string = "website"> = Readonly<{
  topic: string;
  name: string;
  email: string;
  /** Empty text when left empty. */
  phone: string;
  message: string;
}> & Readonly<Record<Honeypot, string>>;

export type ContactFormDevPreview = "idle" | "submitting" | "accepted" | "invalid" | "rate-limited" | "unavailable";

export type ContactFormProps<Honeypot extends string = "website"> = {
  resolveCopyId: CopyResolver;
  copy: ContactFormCopy;
  /** At least one topic, with unique kebab-case ids. */
  topics: readonly ContactFormTopic[];
  /** Unknown ids are ignored. */
  initialTopic?: string;
  /** A rejection or an unknown answer reads as unavailable. */
  onSubmit: (values: ContactFormValues<NoInfer<Honeypot>>) => Promise<ContactResult>;
  /** Pins an inert review state; production callers must omit it. */
  devPreview?: ContactFormDevPreview;
} & ("website" extends Honeypot
  ? { /** Match createContactHandler's honeypotField; defaults to website. */ honeypotField?: Honeypot }
  : { /** Match createContactHandler's honeypotField. */ honeypotField: Honeypot });

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HONEYPOT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DECLARED_FIELDS = new Set(["topic", "name", "email", "phone", "message"]);

const SUBMIT_ID_SUFFIX = "submit";

type Outcome = "idle" | "accepted" | "invalid" | "rate-limited" | "unavailable";

const DEV_PREVIEWS: readonly ContactFormDevPreview[] = ["idle", "submitting", "accepted", "invalid", "rate-limited", "unavailable"];

function validateDevPreview(value: unknown): void {
  if (value === undefined) return;
  // The message names the prop, never the value: the value is caller data.
  if (typeof value !== "string" || !DEV_PREVIEWS.includes(value as ContactFormDevPreview)) {
    throw new RenderError("resolution-failed", "ContactForm requires devPreview to be one of the listed states.");
  }
}

function resolveCopy(ref: CopyRef | undefined, path: string, resolver: CopyResolver): string {
  const resolution = ref === undefined || ref === null ? undefined : resolver(ref);
  if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
    throw new RenderError("resolution-failed", `ContactForm could not resolve copy at ${path}.`);
  }
  return resolution.text;
}

function validateTopics(topics: readonly ContactFormTopic[]): void {
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new RenderError("resolution-failed", "ContactForm requires at least one topic.");
  }
  const seen = new Set<string>();
  topics.forEach((topic, index) => {
    const id = topic?.id;
    // The message names the position, never the id: an id is caller data.
    if (typeof id !== "string" || !KEBAB_CASE.test(id)) {
      throw new RenderError("resolution-failed", `ContactForm requires topics[${index}].id to be kebab-case.`);
    }
    if (seen.has(id)) {
      throw new RenderError("resolution-failed", `ContactForm requires topics[${index}].id to be unique.`);
    }
    seen.add(id);
  });
}

function validateHoneypotField(name: string): void {
  if (typeof name !== "string" || !HONEYPOT_NAME.test(name) || DECLARED_FIELDS.has(name)) {
    throw new RenderError("resolution-failed", "ContactForm requires honeypotField to be a name that is not one of the declared fields.");
  }
}

/** A light shape check only. The server handler owns the strict rule; this just catches an obvious slip before a round trip. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value.trim());
}

/**
 * Client form for CaptureView's form slot. It owns validation, its single
 * error summary and ContactResult states; the view owns the page heading and
 * card, and SiteFrame owns landmarks. A successful send focuses its h2;
 * failures retain values and focus submit. Render from a host client boundary.
 */
export function ContactForm(props: ContactFormProps): ReactElement;
export function ContactForm<Honeypot extends string>(props: ContactFormProps<Honeypot> & { honeypotField: Honeypot }): ReactElement;
export function ContactForm({
  resolveCopyId,
  copy,
  topics,
  initialTopic,
  honeypotField = "website",
  onSubmit,
  devPreview,
}: ContactFormProps | (ContactFormProps<string> & { honeypotField: string })) {
  validateTopics(topics);
  validateHoneypotField(honeypotField);
  validateDevPreview(devPreview);

  const text = {
    topicLabel: resolveCopy(copy.topicLabel, "copy.topicLabel", resolveCopyId),
    topicPlaceholder: resolveCopy(copy.topicPlaceholder, "copy.topicPlaceholder", resolveCopyId),
    nameLabel: resolveCopy(copy.nameLabel, "copy.nameLabel", resolveCopyId),
    emailLabel: resolveCopy(copy.emailLabel, "copy.emailLabel", resolveCopyId),
    phoneLabel: resolveCopy(copy.phoneLabel, "copy.phoneLabel", resolveCopyId),
    messageLabel: resolveCopy(copy.messageLabel, "copy.messageLabel", resolveCopyId),
    submit: resolveCopy(copy.submit, "copy.submit", resolveCopyId),
    submitting: resolveCopy(copy.submitting, "copy.submitting", resolveCopyId),
    errorSummary: resolveCopy(copy.errorSummary, "copy.errorSummary", resolveCopyId),
    topicRequired: resolveCopy(copy.topicRequired, "copy.topicRequired", resolveCopyId),
    nameRequired: resolveCopy(copy.nameRequired, "copy.nameRequired", resolveCopyId),
    emailRequired: resolveCopy(copy.emailRequired, "copy.emailRequired", resolveCopyId),
    emailInvalid: resolveCopy(copy.emailInvalid, "copy.emailInvalid", resolveCopyId),
    messageRequired: resolveCopy(copy.messageRequired, "copy.messageRequired", resolveCopyId),
    sentHeading: resolveCopy(copy.sentHeading, "copy.sentHeading", resolveCopyId),
    sentBody: resolveCopy(copy.sentBody, "copy.sentBody", resolveCopyId),
    failureLabel: resolveCopy(copy.failureLabel, "copy.failureLabel", resolveCopyId),
    invalid: resolveCopy(copy.invalid, "copy.invalid", resolveCopyId),
    rateLimited: resolveCopy(copy.rateLimited, "copy.rateLimited", resolveCopyId),
    unavailable: resolveCopy(copy.unavailable, "copy.unavailable", resolveCopyId),
  };
  const options = topics.map((topic, index) => ({
    id: topic.id,
    label: resolveCopy(topic.label, `topics[${index}].label`, resolveCopyId),
  }));
  const preselected = initialTopic !== undefined && topics.some((topic) => topic.id === initialTopic) ? initialTopic : "";

  const [outcome, setOutcome] = useState<Outcome>("idle");
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const validation = useFormValidation<Record<string, string>>({
    initialValues: { topic: preselected, name: "", email: "", phone: "", message: "", [honeypotField]: "" },
    validators: {
      topic: (value) => (value.trim() === "" ? text.topicRequired : undefined),
      name: (value) => (value.trim() === "" ? text.nameRequired : undefined),
      email: (value) => (value.trim() === "" ? text.emailRequired : looksLikeEmail(value) ? undefined : text.emailInvalid),
      message: (value) => (value.trim() === "" ? text.messageRequired : undefined),
    },
    onSubmit: async (values) => {
      let result: ContactResult | undefined;
      try {
        result = await onSubmitRef.current(values as ContactFormValues & ContactFormValues<string>);
      } catch {
        result = { status: "unavailable" };
      }
      // Anything the handler answers other than the three known statuses (undefined, a proxy error body) is a failure to send, never silence.
      const status = result?.status;
      setOutcome(status === "accepted" || status === "invalid" || status === "rate-limited" ? status : "unavailable");
    },
  });

  // The previous outcome is cleared at the start of every submit attempt, including one a client-side check refuses, so a stale failure never sits beside a new error summary and a repeated failure is announced again.
  // A pinned preview is inert: submitting sends nothing and changes nothing.
  const previewing = devPreview !== undefined;
  const binding = useMemo(
    () => ({
      ...validation,
      isSubmitting: previewing ? devPreview === "submitting" : validation.isSubmitting,
      handleSubmit: (event?: Parameters<typeof validation.handleSubmit>[0]) => {
        if (previewing) {
          event?.preventDefault();
          return Promise.resolve();
        }
        setOutcome("idle");
        return validation.handleSubmit(event);
      },
    }),
    [validation, previewing, devPreview],
  );
  const shown = devPreview ?? outcome;

  const submitId = validation.fieldId(SUBMIT_ID_SUFFIX);

  // Sent: the heading takes focus so the change of state is announced from a known place.
  useEffect(() => {
    if (!previewing && outcome === "accepted") sentHeadingRef.current?.focus();
  }, [outcome, previewing]);

  // Failed: focus returns to the submit button, values untouched.
  useEffect(() => {
    if (!previewing && (outcome === "invalid" || outcome === "rate-limited" || outcome === "unavailable")) {
      document.getElementById(submitId)?.focus();
    }
  }, [outcome, previewing, submitId]);

  const failureMessage = shown === "invalid" ? text.invalid : shown === "rate-limited" ? text.rateLimited : shown === "unavailable" ? text.unavailable : null;
  const failure =
    failureMessage === null ? null : (
      <div className="flex flex-col gap-xs">
        <span className="font-semibold">{text.failureLabel}</span>
        <span>{failureMessage}</span>
      </div>
    );
  const topicField = validation.getFieldProps("topic");

  return shown === "accepted" ? (
    <div role="status" className="flex flex-col gap-sm">
      <h2 ref={sentHeadingRef} tabIndex={-1} className="text-h2 font-display text-ink-primary outline-none">
        {text.sentHeading}
      </h2>
      <p className="text-body text-ink-secondary">{text.sentBody}</p>
    </div>
  ) : (
    <Form
      actionsLayout="end"
      method="post"
      validation={binding}
      errorSummaryMessage={() => text.errorSummary}
      submitError={failure}
      actions={
        <Button id={submitId} type="submit" isPending={binding.isSubmitting}>
          {binding.isSubmitting ? text.submitting : text.submit}
        </Button>
      }
    >
      <Select
        id={topicField.id}
        name={topicField.name}
        label={text.topicLabel}
        placeholder={text.topicPlaceholder}
        options={options}
        isRequired
        selectedKey={topicField.value === "" ? null : topicField.value}
        onSelectionChange={(key) => topicField.onChange(key === null ? "" : String(key))}
        onBlur={topicField.onBlur}
        isInvalid={topicField.isInvalid}
        errorMessage={topicField.errorMessage}
        validationBehavior="aria"
      />
      <TextField {...validation.getFieldProps("name")} label={text.nameLabel} autoComplete="name" isRequired />
      <TextField {...validation.getFieldProps("email")} label={text.emailLabel} type="email" autoComplete="email" isRequired />
      <TextField {...validation.getFieldProps("phone")} label={text.phoneLabel} type="tel" autoComplete="tel" />
      <Textarea {...validation.getFieldProps("message")} label={text.messageLabel} rows={6} isRequired />
      <div aria-hidden="true" className="sr-only">
        <input
          type="text"
          name={honeypotField}
          value={validation.values[honeypotField] ?? ""}
          onChange={(event) => validation.setFieldValue(honeypotField, event.currentTarget.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
    </Form>
  );
}
