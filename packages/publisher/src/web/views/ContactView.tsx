import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { Button, Select, TextField, Textarea } from "@clossys/designer/atoms";
import { Card, mergeUiClasses } from "@clossys/designer/atoms/server";
import { Form, useFormValidation } from "@clossys/designer/blocks";
import { PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import type { SiteFooterLegalProps } from "@clossys/designer/shell/server";
import { RenderError } from "../../internal/errors.js";
import type { ContactResult } from "../contact/types.js";

/**
 * Approved copy for every visible word this view renders. There is no
 * built-in wording: each entry is a `CopyRef` resolved through
 * `resolveCopyId`, and an entry that does not resolve throws.
 */
export interface ContactViewCopy {
  /** The page's only `<h1>`. Never mentions a topic. */
  heading: CopyRef;
  /** A line of supporting copy under the heading. Never mentions a topic. */
  description: CopyRef;
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
  /** Shown when the server answered `invalid`. Per-field mapping is not part of this view. */
  invalid: CopyRef;
  /** Shown when the server answered `rate-limited`. */
  rateLimited: CopyRef;
  /** Shown when the server answered `unavailable`, or when `onSubmit` rejected. */
  unavailable: CopyRef;
}

/** One topic the visitor can choose. `id` is what reaches `onSubmit`; `label` is what the visitor reads. */
export interface ContactViewTopic {
  /** Unique kebab-case id. Never rendered. */
  id: string;
  label: CopyRef;
}

/** What `onSubmit` receives: the five declared fields as text, plus the honeypot field under its own name. */
export interface ContactViewValues {
  readonly topic: string;
  readonly name: string;
  readonly email: string;
  /** `""` when left empty. */
  readonly phone: string;
  readonly message: string;
  readonly [field: string]: string;
}

/**
 * A state the view can be pinned to without a real send, for a review page.
 * The set is closed: any other value throws.
 */
export type ContactViewDevPreview = "idle" | "submitting" | "accepted" | "invalid" | "rate-limited" | "unavailable";

export interface ContactViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onSubmit"> {
  /** Persistent site identity, rendered alone in the page banner. A slot: consumers typically pass a `Brandmark`. */
  brand: ReactNode;
  /** The legal row, passed straight to `SiteFooter.Legal`. Every visible word in it comes from these props. */
  legal: SiteFooterLegalProps;
  /** The approved-copy resolver used for every string in `copy` and in `topics`. */
  resolveCopyId: CopyResolver;
  copy: ContactViewCopy;
  /** The topics on offer, at least one, with unique kebab-case ids. */
  topics: readonly ContactViewTopic[];
  /** A topic id to preselect. An id that is not in `topics` is ignored. */
  initialTopic?: string;
  /**
   * Name of the hidden honeypot field. Match the handler's `honeypotField`.
   * @default "website"
   */
  honeypotField?: string;
  /** Sends the form. Its `ContactResult` decides what the view shows next; a rejection is read as `unavailable`. */
  onSubmit: (values: ContactViewValues) => Promise<ContactResult>;
  /**
   * Pins the view to one state and makes it inert: submitting never calls
   * `onSubmit`. For a review page only. A production page must not pass it,
   * and the view never reads the URL or the environment to choose one itself.
   * A value outside `ContactViewDevPreview` throws.
   */
  devPreview?: ContactViewDevPreview;
  style?: CSSProperties;
}

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HONEYPOT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DECLARED_FIELDS = new Set(["topic", "name", "email", "phone", "message"]);

/** Off-screen and out of the tab order, but present in the DOM so a bot that fills every input fills this one. */
const HONEYPOT_STYLE: CSSProperties = {
  position: "absolute",
  left: "-10000px",
  width: "1px",
  height: "1px",
  overflow: "hidden",
};

const SUBMIT_ID_SUFFIX = "submit";

type Outcome = "idle" | "accepted" | "invalid" | "rate-limited" | "unavailable";

const DEV_PREVIEWS: readonly ContactViewDevPreview[] = ["idle", "submitting", "accepted", "invalid", "rate-limited", "unavailable"];

function validateDevPreview(value: unknown): void {
  if (value === undefined) return;
  // The message names the prop, never the value: the value is caller data.
  if (typeof value !== "string" || !DEV_PREVIEWS.includes(value as ContactViewDevPreview)) {
    throw new RenderError("resolution-failed", "ContactView requires devPreview to be one of the listed states.");
  }
}

function resolveCopy(ref: CopyRef | undefined, path: string, resolver: CopyResolver): string {
  const resolution = ref === undefined || ref === null ? undefined : resolver(ref);
  if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
    throw new RenderError("resolution-failed", `ContactView could not resolve copy at ${path}.`);
  }
  return resolution.text;
}

function validateTopics(topics: readonly ContactViewTopic[]): void {
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new RenderError("resolution-failed", "ContactView requires at least one topic.");
  }
  const seen = new Set<string>();
  topics.forEach((topic, index) => {
    const id = topic?.id;
    // The message names the position, never the id: an id is caller data.
    if (typeof id !== "string" || !KEBAB_CASE.test(id)) {
      throw new RenderError("resolution-failed", `ContactView requires topics[${index}].id to be kebab-case.`);
    }
    if (seen.has(id)) {
      throw new RenderError("resolution-failed", `ContactView requires topics[${index}].id to be unique.`);
    }
    seen.add(id);
  });
}

function validateHoneypotField(name: string): void {
  if (typeof name !== "string" || !HONEYPOT_NAME.test(name) || DECLARED_FIELDS.has(name)) {
    throw new RenderError("resolution-failed", "ContactView requires honeypotField to be a name that is not one of the declared fields.");
  }
}

/** A light shape check only. The server handler owns the strict rule; this just catches an obvious slip before a round trip. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value.trim());
}

/**
 * A single-screen contact page: a logo-only transparent banner, the page
 * header, one form in a card, and a transparent legal footer. The form asks
 * for a topic, a name, an email, an optional phone and a message, and carries
 * a hidden honeypot field.
 *
 * What it guarantees: exactly one `<h1>`, which never names the chosen topic;
 * topic, name, email and message are checked in the browser before anything
 * is sent, and a failed check sends nothing and moves focus to the first
 * invalid field; the honeypot is out of the tab order, `aria-hidden` and
 * `autocomplete="off"`, and its value reaches `onSubmit`; the submit button is
 * pending, never `disabled`, while a send is in flight; an `accepted` result
 * replaces the form with a `role="status"` confirmation and focuses its
 * heading; `invalid`, `rate-limited` and `unavailable` each show a
 * `role="alert"`, keep every typed value and return focus to the submit
 * button; and every visible word comes from `copy` and `topics` through
 * `resolveCopyId` (an entry that does not resolve throws an error naming its
 * path, never its id).
 *
 * With `devPreview` set, the view shows that one state and is inert: a submit
 * never calls `onSubmit`, and no focus moves on its own. Only a page that is
 * not production should pass it.
 *
 * What it does not do: it does not show which field a server `invalid` result
 * refers to (that is a later unit), it does not decide the result (that is
 * `createContactHandler`), and it does not detect bots beyond leaving the
 * honeypot for a bot to fill.
 */
export function ContactView({
  brand,
  legal,
  resolveCopyId,
  copy,
  topics,
  initialTopic,
  honeypotField = "website",
  onSubmit,
  devPreview,
  className,
  style,
  ...rest
}: ContactViewProps) {
  validateTopics(topics);
  validateHoneypotField(honeypotField);
  validateDevPreview(devPreview);

  const text = {
    heading: resolveCopy(copy.heading, "copy.heading", resolveCopyId),
    description: resolveCopy(copy.description, "copy.description", resolveCopyId),
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
        result = await onSubmitRef.current(values as ContactViewValues);
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

  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      <SiteHeader ground="transparent" brand={brand} />
      <main className="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl" style={{ maxWidth: "var(--ui-width-prose-max, none)" }}>
        <PageHeader title={text.heading} description={text.description} />
        <Card>
          {shown === "accepted" ? (
            <div role="status" className="flex flex-col gap-sm">
              <h2 ref={sentHeadingRef} tabIndex={-1} className="text-h2 font-display text-ink-primary outline-none">
                {text.sentHeading}
              </h2>
              <p className="text-body text-ink-secondary">{text.sentBody}</p>
            </div>
          ) : (
            <Form
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
              <div aria-hidden="true" style={HONEYPOT_STYLE}>
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
          )}
        </Card>
      </main>
      <SiteFooter ground="transparent" secondary={<SiteFooter.Legal {...legal} />} />
    </div>
  );
}
