import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type FormHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { Link } from "../atoms/Link.js";
import { cx } from "../atoms/internal/cx.js";
import { UI_RING_FOCUS } from "../atoms/internal/ui-vars.js";

export interface FormError {
  /**
   * The real DOM `id` of the invalid field's own focusable control — e.g.
   * an explicit `id` a consumer passes to `TextField`/`Select`/`Textarea`/
   * `Field`'s wrapped control (react-aria-components applies a supplied
   * `id` to the underlying `<input>`/`<select>`/control itself, not a
   * wrapper element, the same target a native `<label for>` would point
   * at). `Form` uses this to link the summary entry to its field: as the
   * `href` of a real anchor (`#fieldId`), and as the target `Form` moves
   * focus to when that anchor is activated.
   */
  fieldId: string;
  /** The error text shown in the summary. */
  message: ReactNode;
}

/**
 * What `Form` needs from a validation source to run the submit side of the
 * pattern: `useFormValidation`'s return value satisfies it, and so can a
 * consumer's own adapter over another form library. Kept to these four
 * members so `Form` depends on the shape, not on the hook.
 */
export interface FormValidationBinding {
  /**
   * Runs one submit attempt: prevents the native submission, validates, and
   * either moves focus to the first invalid field or calls the consumer's
   * submit. `Form` calls it from the `<form>`'s own `onSubmit` and catches
   * a rejection from the returned promise, passing it to `onSubmitError`.
   */
  handleSubmit: (event?: FormEvent) => Promise<void>;
  /**
   * The error-summary entries, in DOM order, as of the most recent failed
   * submit. A snapshot, not a live view: it is replaced (a new array) only
   * when a submit fails, and emptied by a valid submit or a reset — it does
   * not shrink as the user fixes fields. That is deliberate. The summary
   * is a `role="alert"` region, and every change to an alert's content is
   * announced again; a list that shrank on each keystroke that fixed a
   * field would interrupt the user while they type. The inline error on
   * each field is what clears live.
   */
  summaryErrors: readonly FormError[];
  /** True while a valid submit is pending — `Form` sets `aria-busy` on the `<form>` from it. */
  isSubmitting: boolean;
  /**
   * `Form` attaches its `<form>` element here, so the validation source can
   * resolve field ids within the form's own document or shadow root when
   * it looks for the first invalid field.
   */
  formRef: RefObject<HTMLFormElement | null>;
}

export interface FormProps
  extends Omit<FormHTMLAttributes<HTMLFormElement>, "children" | "onSubmit"> {
  /** Optional heading region, rendered above the fields. */
  heading?: ReactNode;
  /** The fields region — arbitrary consumer content (`TextField`s, `FieldGroup`s, `Field`s, ...). */
  children: ReactNode;
  /**
   * Validation errors to summarize, one entry per invalid field. Empty or
   * omitted renders no error-summary region at all — this is a controlled
   * prop, the same "no owned state" contract `DataTable`'s `sortDescriptor`/
   * `Pagination`'s `page` already follow: `Form` never validates anything
   * itself, it only renders whatever the consumer's own validation already
   * decided (react-aria-components' per-field `isInvalid`/`validationErrors`,
   * a third-party form library's error map, or anything else).
   *
   * Passing a NEW array here (a fresh reference) is what `Form` treats as
   * "a submit just failed" and moves focus to the summary for — see the
   * component doc comment below. With `validation`, this defaults to
   * `validation.summaryErrors` and never moves focus (the first invalid
   * field gets it instead).
   *
   * The summary renders only when `errorSummaryMessage` is also passed.
   */
  errors?: readonly FormError[];
  /**
   * Heading for the error summary, called with the number of entries. The
   * summary is opt-in: without this prop no summary renders at all, even
   * when there are errors — the inline error on each field carries them.
   * `Form` ships no heading text of its own, so there is nothing to fall
   * back to in a language the consumer does not render.
   */
  errorSummaryMessage?: (count: number) => ReactNode;
  /**
   * A send failure — the network or server refused a submission that
   * passed validation. Rendered as one `role="alert"` region above the
   * actions while set; consumer content only. Field-level problems belong
   * in the fields' own errors and the summary, not here.
   */
  submitError?: ReactNode;
  /**
   * Opts into the validation pattern — pass `useFormValidation`'s return
   * value (or any `FormValidationBinding`). `Form` then submits through
   * `validation.handleSubmit`, sets `noValidate` (so the browser's own
   * constraint bubbles don't pre-empt the pattern), sets `aria-busy` while
   * a submit is pending, and uses `validation.summaryErrors` as `errors`
   * unless `errors` is passed.
   */
  validation?: FormValidationBinding;
  /**
   * Called with the rejection when a valid submit's `onSubmit` promise
   * rejects, only with `validation`. `Form` catches that rejection so it
   * never becomes an unhandled promise rejection, and the validation source
   * clears its pending state whether the promise resolves or rejects. Render
   * the consumer's own message through `submitError`, for example by
   * setting state here. `Form` renders no error text of its own. Optional:
   * when omitted the rejection is dropped, so a caller that wants to know
   * about a failed send passes this (or catches inside its own `onSubmit`).
   */
  onSubmitError?: (error: unknown) => void;
  /** Slot for the form's submit/cancel controls, rendered at the end. */
  actions?: ReactNode;
  /**
   * Native `<form>` submit handler, passed straight through — `Form` adds
   * no logic of its own around it. Ignored when `validation` is passed:
   * the validation source owns submission then, and its own `onSubmit`
   * (called only once every field is valid) is where the send goes.
   * Calling both would send twice, or send an invalid form.
   */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * A form's own layout: an optional heading region, the fields region, an
 * error-summary region, a submit-error region, and an actions region —
 * regions that differ in kind, and a page can hold two `Form`s (two
 * independent forms on one settings page), which is what makes this a
 * block rather than a view.
 *
 * **`Form` itself owns no validation logic or form state, deliberately.**
 * react-aria-components already carries validation through each field's own
 * `isInvalid`/`validationErrors` (native or Zod/Yup-backed, via its
 * `validate/validationBehavior` props), and many consumers layer a form
 * library (React Hook Form, Formik, TanStack Form, ...) of their own choice
 * on top of that. A shared UI package that forced one of those would leave
 * every consumer using a different one needing an escape hatch — the same
 * structural-difference-through-a-mode-prop failure this package's README
 * warns against, scoped to a form library instead of visual styling. So
 * the pattern's validation half is a separate, optional hook,
 * `useFormValidation`, that a consumer opts into through the `validation`
 * prop; everyone else passes `errors` from whatever they already use.
 *
 * **Two ways in, two focus rules.**
 *
 * - With `validation`: a failed submit moves focus to the FIRST INVALID
 *   FIELD in document order (the hook does this after the field's error
 *   has rendered). If `errorSummaryMessage` is also passed, the summary
 *   renders too, announced through its `role="alert"` without taking
 *   focus — taking focus there as well would fight the field for it.
 * - With `errors` alone (no `validation`): the summary is the only thing
 *   `Form` knows about, so a NEW non-empty `errors` array moves focus to
 *   the summary — keyed on the array's own identity, since `Form` tracks
 *   no validation state that could say "a submit just failed". A consumer
 *   must not construct an equivalent new array on every unrelated render
 *   (memoize it, or only replace it from the submit handler itself), or
 *   the summary steals focus back on every one of those too.
 *
 * **The error summary is opt-in, and consumer-worded.** It renders only
 * when `errorSummaryMessage` is supplied and there are errors: `Form`
 * ships no English (or any other) default heading. When shown, it
 * collects every error in one place with each entry a real link to its
 * field — what a screen-reader user tabbing field-by-field otherwise has
 * no way to discover without visiting every one — using the same
 * assertive-live-region pattern `Banner`(`danger`)/`Toaster`(`danger`)
 * already use, applied to a region a user can also tab into.
 *
 * **Pending, not disabled.** The actions slot is the consumer's; give the
 * submit `Button` `validation`'s pending state (`useFormValidation`'s
 * `getSubmitButtonProps()`), never `isDisabled`, so it keeps focus while
 * the send runs. `submitError` is the one region for a send that failed
 * after validation passed.
 */
export function Form({
  heading,
  children,
  errors,
  errorSummaryMessage,
  submitError,
  validation,
  onSubmitError,
  actions,
  onSubmit,
  className,
  style,
  ...rest
}: FormProps) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const errorList = errors ?? validation?.summaryErrors ?? [];
  const showSummary = errorSummaryMessage !== undefined && errorList.length > 0;
  // The summary `<div>` is plain markup, not a react-aria-components
  // primitive, so it gets no `isFocusVisible` render prop of its own the
  // way `Button`'s ring does — this local state stands in for it, so the
  // ring still only shows a real `var(--ui-ring-focus)` token (with the
  // same real fallback every other atom's own ring uses), never a bare
  // `var()` with no fallback.
  const [summaryFocused, setSummaryFocused] = useState(false);

  useEffect(() => {
    // With `validation`, the first invalid field takes focus instead (the
    // hook moves it); the summary is announced by its `role="alert"` only.
    if (validation) return;
    if (showSummary) {
      summaryRef.current?.focus();
    }
    // Intentionally keyed on the `errors` prop's own reference, not on a
    // derived boolean/count — see this component's own doc comment and
    // `FormProps.errors` for why: a new array is the only "a submit just
    // failed" signal this component has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors]);

  return (
    <form
      {...rest}
      ref={validation?.formRef}
      noValidate={validation ? true : rest.noValidate}
      aria-busy={validation?.isSubmitting ? true : rest["aria-busy"]}
      onSubmit={
        validation
          ? (event) => {
              validation.handleSubmit(event).catch((error: unknown) => {
                onSubmitError?.(error);
              });
            }
          : onSubmit
      }
      className={cx("flex flex-col gap-lg", className)}
      style={style}
    >
      {heading ? <h2 className="text-h2 font-display text-ink-primary">{heading}</h2> : null}
      {showSummary ? (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          onFocus={() => setSummaryFocused(true)}
          onBlur={() => setSummaryFocused(false)}
          className="flex flex-col gap-sm rounded-control border border-status-danger bg-status-danger-tint p-md text-status-danger-text outline-none"
          style={summaryFocused ? { boxShadow: UI_RING_FOCUS } : undefined}
        >
          <h2 className="text-body font-body font-semibold">{errorSummaryMessage?.(errorList.length)}</h2>
          <ul className="flex flex-col gap-xs text-body-s">
            {errorList.map((error, index) => (
              <li key={`${error.fieldId}-${index}`}>
                <Link
                  href={`#${error.fieldId}`}
                  className="text-status-danger-text"
                  style={(renderProps) =>
                    renderProps.isFocusVisible ? { boxShadow: UI_RING_FOCUS } : undefined
                  }
                  onPress={() => {
                    document.getElementById(error.fieldId)?.focus();
                  }}
                >
                  {error.message}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-md">{children}</div>
      {submitError ? (
        <div
          role="alert"
          className="rounded-control border border-status-danger bg-status-danger-tint p-md text-body-s text-status-danger-text"
        >
          {submitError}
        </div>
      ) : null}
      {actions ? <div className="flex items-center gap-sm">{actions}</div> : null}
    </form>
  );
}
