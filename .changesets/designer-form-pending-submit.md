---
designer: minor
---

Callers can spread `useFormValidation`'s `getSubmitButtonProps()` onto the submit `Button` to show a focusable pending state while an async submit runs, and a second submit during that time does not call `onSubmit` again.
