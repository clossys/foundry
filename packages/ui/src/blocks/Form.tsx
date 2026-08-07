import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type FormHTMLAttributes,
  type ReactNode,
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
   * component doc comment below.
   */
  errors?: readonly FormError[];
  /** Slot for the form's submit/cancel controls, rendered at the end. */
  actions?: ReactNode;
  /** Native `<form>` submit handler, passed straight through — `Form` adds no logic of its own around it. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * A form's own layout: an optional heading region, the fields region, an
 * error-summary region, and an actions region — four regions that differ in
 * kind, and a page can hold two `Form`s (two independent forms on one
 * settings page), which is what makes this a block rather than a view.
 *
 * **Implements no validation logic or form state, deliberately.**
 * react-aria-components already carries validation through each field's own
 * `isInvalid`/`validationErrors` (native or Zod/Yup-backed, via its
 * `validate/validationBehavior` props), and most real consumers layer a form
 * library (React Hook Form, Formik, TanStack Form, ...) of their own choice
 * on top of that. A shared UI package that tried to own validation would
 * have to pick one of those, and every consumer using a different one would
 * immediately need an escape hatch — the same structural-difference-through-
 * a-mode-prop failure this package's README warns against, just scoped to a
 * form library instead of visual styling. `Form` provides three things
 * only: the region layout, the error-summary region (below), and `onSubmit`
 * passthrough to a native `<form>` — nothing about *when* a field is
 * invalid or *what* makes it so.
 *
 * **The error summary is this component's real accessibility value.** A
 * sighted user scanning a long form after a failed submit can see which
 * fields turned red; a screen-reader user tabbing field-by-field cannot
 * discover that without visiting every one. The summary collects every
 * error in one place, focused and announced the moment a submission fails,
 * with each entry a real link to its field — the same pattern this
 * package's own `Banner`(`danger`)/`Toaster`(`danger`) already use for an
 * assertive live region, applied here to a whole region a user can also tab
 * into rather than one that only interrupts once and disappears.
 *
 * `errors` is controlled: passing a new (non-empty) array is the only
 * signal `Form` has that a validation pass just ran and failed, since it
 * tracks no validation state of its own — moving focus to the summary is
 * keyed on the `errors` array's own identity changing, not derived from
 * `isInvalid` anywhere. A consumer must not construct an equivalent new
 * array on every unrelated render (memoize it, or only replace it from the
 * submit handler itself), or the summary steals focus back on every one of
 * those too.
 */
export function Form({
  heading,
  children,
  errors,
  actions,
  onSubmit,
  className,
  style,
  ...rest
}: FormProps) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const errorList = errors ?? [];
  const hasErrors = errorList.length > 0;
  // The summary `<div>` is plain markup, not a react-aria-components
  // primitive, so it gets no `isFocusVisible` render prop of its own the
  // way `Button`'s ring does — this local state stands in for it, so the
  // ring still only shows a real `var(--ui-ring-focus)` token (with the
  // same real fallback every other atom's own ring uses), never a bare
  // `var()` with no fallback.
  const [summaryFocused, setSummaryFocused] = useState(false);

  useEffect(() => {
    if (errorList.length > 0) {
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
      onSubmit={onSubmit}
      className={cx("flex flex-col gap-lg", className)}
      style={style}
    >
      {heading ? <h2 className="text-h2 font-display text-ink-primary">{heading}</h2> : null}
      {hasErrors ? (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          onFocus={() => setSummaryFocused(true)}
          onBlur={() => setSummaryFocused(false)}
          className="flex flex-col gap-sm rounded-control border border-status-danger bg-status-danger-tint p-md text-status-danger-text outline-none"
          style={summaryFocused ? { boxShadow: UI_RING_FOCUS } : undefined}
        >
          <h2 className="text-body font-body font-semibold">
            {errorList.length === 1 ? "There is 1 error" : `There are ${errorList.length} errors`}
          </h2>
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
      {actions ? <div className="flex items-center gap-sm">{actions}</div> : null}
    </form>
  );
}
