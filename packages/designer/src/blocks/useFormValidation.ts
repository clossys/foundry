import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { FormError, FormValidationBinding } from "./Form.js";

/** A field name of `V` — string keys only, since each one becomes part of a DOM id. */
export type FormFieldName<V> = Extract<keyof V, string>;

/**
 * The field names of `V` whose value is a string — the only ones a plain
 * `<input>`/`<textarea>`/`<select>` can hold, and so the only ones
 * `getNativeInputProps` accepts.
 */
export type FormStringFieldName<V> = {
  [K in FormFieldName<V>]: V[K] extends string ? K : never;
}[FormFieldName<V>];

/**
 * Validates one field. Returns the error to show — consumer copy, in
 * whatever language the consumer renders — or nothing when the value is
 * valid. `undefined`, `null`, `false` and `""` all mean "valid"; anything
 * else is the message. Receives every current value too, so a rule can
 * depend on another field (a confirmation matching its original) — but it
 * re-runs only on its OWN field's change/blur/submit, never when that other
 * field changes.
 */
export type FieldValidator<V, K extends keyof V> = (value: V[K], values: V) => ReactNode;

export interface UseFormValidationOptions<V extends Record<string, unknown>> {
  /** Starting values, and what `reset()` returns to. Read on mount and on `reset()`. */
  initialValues: V;
  /** One optional validator per field. A field without one is always valid. */
  validators: { [K in FormFieldName<V>]?: FieldValidator<V, K> };
  /**
   * Called with the current values only when every field is valid. A
   * returned promise holds the form in its pending state (`isSubmitting`)
   * until it settles, and `isSubmitting` is cleared whether it resolves or
   * rejects. A rejection is re-thrown from `handleSubmit`, so a caller that
   * attaches `handleSubmit` to its own `<form>` must catch it. `Form`
   * catches it and passes it to its `onSubmitError` prop. Either way, render
   * the consumer's own message through `Form`'s `submitError`.
   */
  onSubmit: (values: V) => void | Promise<void>;
  /**
   * Prefix for every DOM id this hook generates (`${idPrefix}-${name}`,
   * and `${idPrefix}-${name}-error`). Defaults to React's `useId()`, which
   * is unique per hook instance and stable across server and client
   * render — pass one only when a readable id matters.
   */
  idPrefix?: string;
}

/**
 * Props for a designer field atom (`TextField`, `Textarea`, `SearchField`,
 * `Select`, ... — anything built on a react-aria-components field with
 * `value`/`onChange`). Spread them on: react-aria-components then wires
 * `aria-invalid` and the `aria-describedby` link to the atom's own error
 * element itself, so none of that is hand-rolled here.
 */
export interface FormFieldProps<T> {
  id: string;
  name: string;
  value: T;
  onChange: (value: T) => void;
  onBlur: () => void;
  isInvalid: boolean;
  errorMessage: ReactNode;
  /**
   * Always `"aria"`: the hook owns when an error shows, so the field must
   * not ALSO push it into the browser's native constraint validation
   * (react-aria-components' `"native"` default calls `setCustomValidity`).
   */
  validationBehavior: "aria";
}

/**
 * Props for a plain native `<input>`/`<textarea>`/`<select>`. There is no
 * atom to render the error here, so the consumer renders it, with
 * `id={errorId(name)}`, while `errors[name]` is set — `aria-describedby`
 * names that id only while the field shows an error, so it never points
 * at an element that isn't there.
 */
export interface FormNativeInputProps {
  id: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  onBlur: () => void;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

/** Props for the form's submit `Button`: a real submit, pending (never disabled) while `onSubmit` runs. */
export interface FormSubmitButtonProps {
  type: "submit";
  isPending: boolean;
}

export interface FormValidation<V extends Record<string, unknown>> extends FormValidationBinding {
  /** Current values. */
  values: V;
  /** Errors currently SHOWN — a field that is invalid but not yet due to show its error is absent. */
  errors: Partial<Record<FormFieldName<V>, ReactNode>>;
  /** Fields the user has left (blurred) at least once, or every field after a submit. */
  touched: Partial<Record<FormFieldName<V>, boolean>>;
  /** Submit attempts so far, valid or not. `0` means "before the first submit". */
  submitCount: number;
  /** True while a valid submit's `onSubmit` promise is pending. */
  isSubmitting: boolean;
  /** Stable DOM id of the field's control — what `getFieldProps`/`getNativeInputProps` set as `id`. */
  fieldId: (name: FormFieldName<V>) => string;
  /** Stable DOM id for a native field's error element (see `FormNativeInputProps`). */
  errorId: (name: FormFieldName<V>) => string;
  getFieldProps: <K extends FormFieldName<V>>(name: K) => FormFieldProps<V[K]>;
  getNativeInputProps: (name: FormStringFieldName<V>) => FormNativeInputProps;
  getSubmitButtonProps: () => FormSubmitButtonProps;
  /** Sets a value as if the user had changed it — the same re-validation rule applies. */
  setFieldValue: <K extends FormFieldName<V>>(name: K, value: V[K]) => void;
  /** Back to `initialValues`, no errors, nothing touched, `submitCount` 0. */
  reset: () => void;
}

interface State<V> {
  values: V;
  errors: Partial<Record<FormFieldName<V>, ReactNode>>;
  touched: Partial<Record<FormFieldName<V>, boolean>>;
  submitCount: number;
  isSubmitting: boolean;
  /**
   * The error summary's entries, captured when a submit fails — see
   * `summaryErrors` on `FormValidationBinding` for why it is a snapshot
   * rather than a live view of `errors`.
   */
  summaryErrors: readonly FormError[];
  /** Field names to focus-search after a failed submit, in DOM order. Replaced (new array) per failed submit. */
  focusQueue: readonly string[] | null;
}

// One shared empty list, so "no summary" never churns identity.
const NO_ERRORS: readonly FormError[] = Object.freeze([]);

function isError(result: ReactNode): boolean {
  return result !== undefined && result !== null && result !== false && result !== "";
}

function lookupRoot(form: HTMLFormElement | null): Pick<Document, "getElementById"> | null {
  if (form) {
    const root = form.getRootNode();
    if ("getElementById" in root) return root as Document | ShadowRoot;
  }
  return typeof document === "undefined" ? null : document;
}

/**
 * Sorts field names by their control's position in the document, so
 * "first invalid field" means first to a user reading/tabbing the form,
 * not first in the `validators` object. A name whose element can't be
 * found keeps its validator-key order, after every name that could be.
 */
function sortByDocumentOrder(
  names: readonly string[],
  idFor: (name: string) => string,
  form: HTMLFormElement | null,
): string[] {
  const root = lookupRoot(form);
  const located = names.map((name, index) => ({ name, index, element: root?.getElementById(idFor(name)) ?? null }));
  return located
    .sort((a, b) => {
      if (a.element && b.element) {
        if (a.element === b.element) return a.index - b.index;
        return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      }
      if (a.element) return -1;
      if (b.element) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.name);
}

/**
 * The validation timing half of the form pattern `Form` lays out. `Form`
 * itself still owns no validation — this hook is the optional, separate
 * piece a consumer opts into by passing its return value to `Form`'s
 * `validation` prop (or, without `Form`, by wiring `formRef` and
 * `handleSubmit` onto their own `<form>`). A consumer already using React
 * Hook Form, Formik, or react-aria-components' own `validate` keeps using
 * that and never calls this.
 *
 * **Timing — the whole point.** Before the first submit, typing never
 * shows an error: a field validates when the user LEAVES it (blur). A
 * field already showing an error re-validates on every change, so the
 * error clears the moment the value is fixed instead of lingering until
 * the next blur. After the first submit, every change re-validates at
 * once. A failed submit calls no `onSubmit`, shows every error, and moves
 * focus to the first invalid field in document order — after React has
 * committed the error, so the field is announced together with its
 * `aria-describedby` text rather than before it exists.
 *
 * **Pending, never disabled.** A valid submit sets `isSubmitting` until
 * `onSubmit` settles; `getSubmitButtonProps()` maps that onto the
 * `Button` atom's `isPending`, which keeps the button focusable (a
 * `disabled` button drops keyboard focus to `<body>` mid-submit) and has
 * react-aria-components announce the state. A second submit while the
 * first is pending is dropped by a ref, not by `isSubmitting` state, so
 * two submits in the same tick — before a re-render — still send once.
 *
 * **No copy of its own.** Every error comes from a consumer validator;
 * the hook renders nothing and ships no strings.
 */
export function useFormValidation<V extends Record<string, unknown>>(
  options: UseFormValidationOptions<V>,
): FormValidation<V> {
  const generatedId = useId();
  const prefix = options.idPrefix ?? generatedId;

  // Latest options, read by the stable callbacks below — a consumer's
  // inline `validators`/`onSubmit` object is a new identity every render,
  // and rebuilding every handler (and so every field prop) on each one
  // would be churn for nothing.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const prefixRef = useRef(prefix);
  prefixRef.current = prefix;

  const [state, setState] = useState<State<V>>(() => ({
    values: options.initialValues,
    errors: {},
    touched: {},
    submitCount: 0,
    isSubmitting: false,
    summaryErrors: NO_ERRORS,
    focusQueue: null,
  }));
  // The state as of the last update, synchronously — so a change and a
  // submit in the same tick (Enter right after typing) see each other,
  // rather than each computing from a render-time closure.
  const stateRef = useRef(state);
  const submittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  const update = useCallback((next: (previous: State<V>) => State<V>) => {
    stateRef.current = next(stateRef.current);
    setState(stateRef.current);
  }, []);

  const fieldId = useCallback((name: string) => `${prefixRef.current}-${name}`, []);
  const errorId = useCallback((name: string) => `${prefixRef.current}-${name}-error`, []);

  const validateField = useCallback((name: FormFieldName<V>, values: V): ReactNode => {
    const validator = optionsRef.current.validators[name] as FieldValidator<V, typeof name> | undefined;
    if (!validator) return undefined;
    const result = validator(values[name], values);
    return isError(result) ? result : undefined;
  }, []);

  const withFieldError = useCallback(
    (errors: State<V>["errors"], name: FormFieldName<V>, error: ReactNode): State<V>["errors"] => {
      if (error === undefined) {
        if (!(name in errors)) return errors;
        const rest = { ...errors };
        delete rest[name];
        return rest;
      }
      if (errors[name] === error) return errors;
      return { ...errors, [name]: error };
    },
    [],
  );

  const setFieldValue = useCallback(
    <K extends FormFieldName<V>>(name: K, value: V[K]) => {
      update((previous) => {
        const values = { ...previous.values, [name]: value };
        // Re-validate on change only when the field already shows an error
        // (so it can clear) or a submit has happened; otherwise wait for blur.
        const shouldValidate = previous.submitCount > 0 || name in previous.errors;
        const errors = shouldValidate
          ? withFieldError(previous.errors, name, validateField(name, values))
          : previous.errors;
        return { ...previous, values, errors };
      });
    },
    [update, validateField, withFieldError],
  );

  const blurField = useCallback(
    (name: FormFieldName<V>) => {
      update((previous) => ({
        ...previous,
        touched: previous.touched[name] ? previous.touched : { ...previous.touched, [name]: true },
        errors: withFieldError(previous.errors, name, validateField(name, previous.values)),
      }));
    },
    [update, validateField, withFieldError],
  );

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (submittingRef.current) return;

      const { values, submitCount } = stateRef.current;
      const names = Object.keys(optionsRef.current.validators) as FormFieldName<V>[];
      const errors: State<V>["errors"] = {};
      const touched: State<V>["touched"] = {};
      for (const name of Object.keys(values) as FormFieldName<V>[]) touched[name] = true;
      for (const name of names) {
        touched[name] = true;
        const error = validateField(name, values);
        if (error !== undefined) errors[name] = error;
      }
      const invalid = names.filter((name) => name in errors);

      if (invalid.length > 0) {
        const ordered = sortByDocumentOrder(invalid, fieldId, formRef.current) as FormFieldName<V>[];
        update((previous) => ({
          ...previous,
          errors,
          touched,
          submitCount: submitCount + 1,
          summaryErrors: ordered.map((name) => ({ fieldId: fieldId(name), message: errors[name] })),
          focusQueue: ordered,
        }));
        return;
      }

      submittingRef.current = true;
      update((previous) => ({
        ...previous,
        errors,
        touched,
        submitCount: submitCount + 1,
        isSubmitting: true,
        summaryErrors: NO_ERRORS,
        focusQueue: null,
      }));
      try {
        await optionsRef.current.onSubmit(values);
      } finally {
        submittingRef.current = false;
        update((previous) => ({ ...previous, isSubmitting: false }));
      }
    },
    [fieldId, update, validateField],
  );

  const reset = useCallback(() => {
    update((previous) => ({
      ...previous,
      values: optionsRef.current.initialValues,
      errors: {},
      touched: {},
      submitCount: 0,
      summaryErrors: NO_ERRORS,
      focusQueue: null,
    }));
  }, [update]);

  // Focus after commit, not inside `handleSubmit`: the field's error text
  // (and the `aria-describedby` naming it) exists only once React has
  // rendered this submit's errors, and a screen reader announces the
  // description at the moment focus lands.
  const { focusQueue } = state;
  useEffect(() => {
    if (!focusQueue) return;
    const root = lookupRoot(formRef.current);
    for (const name of focusQueue) {
      const element = root?.getElementById(fieldId(name));
      if (element) {
        element.focus();
        return;
      }
    }
  }, [focusQueue, fieldId]);

  const getFieldProps = useCallback(
    <K extends FormFieldName<V>>(name: K): FormFieldProps<V[K]> => {
      const error = state.errors[name];
      const invalid = error !== undefined;
      return {
        id: fieldId(name),
        name,
        value: state.values[name],
        onChange: (value: V[K]) => setFieldValue(name, value),
        onBlur: () => blurField(name),
        isInvalid: invalid,
        errorMessage: invalid ? error : undefined,
        validationBehavior: "aria",
      };
    },
    [state.errors, state.values, fieldId, setFieldValue, blurField],
  );

  const getNativeInputProps = useCallback(
    (name: FormStringFieldName<V>): FormNativeInputProps => {
      const invalid = state.errors[name] !== undefined;
      return {
        id: fieldId(name),
        name,
        value: state.values[name] as string,
        onChange: (event) => setFieldValue(name, event.currentTarget.value as V[typeof name]),
        onBlur: () => blurField(name),
        "aria-invalid": invalid || undefined,
        "aria-describedby": invalid ? errorId(name) : undefined,
      };
    },
    [state.errors, state.values, fieldId, errorId, setFieldValue, blurField],
  );

  const getSubmitButtonProps = useCallback(
    (): FormSubmitButtonProps => ({ type: "submit", isPending: state.isSubmitting }),
    [state.isSubmitting],
  );

  return useMemo(
    () => ({
      values: state.values,
      errors: state.errors,
      touched: state.touched,
      submitCount: state.submitCount,
      isSubmitting: state.isSubmitting,
      summaryErrors: state.summaryErrors,
      formRef: formRef as RefObject<HTMLFormElement | null>,
      fieldId,
      errorId,
      getFieldProps,
      getNativeInputProps,
      getSubmitButtonProps,
      setFieldValue,
      handleSubmit,
      reset,
    }),
    [state, fieldId, errorId, getFieldProps, getNativeInputProps, getSubmitButtonProps, setFieldValue, handleSubmit, reset],
  );
}
