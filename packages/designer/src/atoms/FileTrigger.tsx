import type { ReactNode } from "react";
import {
  FileTrigger as AriaFileTrigger,
  type FileTriggerProps as AriaFileTriggerProps,
} from "react-aria-components";

export interface FileTriggerProps extends AriaFileTriggerProps {
  /**
   * The pressable element that opens the OS file picker when pressed — the
   * same "must be a react-aria-components-aware pressable element" shape
   * `Menu`'s, `Popover`'s, and `Tooltip`'s own `trigger` slots already
   * document, typically a react-aria-components `Button` (or this
   * package's own `Button` atom, rendered by the CONSUMER — this file never
   * imports `Button.js`, the same one-way composition `Menu`'s own doc
   * comment establishes for its trigger).
   */
  children: ReactNode;
}

/**
 * File selection wired onto an arbitrary pressable trigger — react-aria-
 * components' own `FileTrigger`, which supplies what's easy to get subtly
 * wrong by hand: a real, natively-accessible `<input type="file">` (kept
 * permanently `display: none` and driven entirely by press events on
 * `children`, rather than a `<label>`/`<input>` pair a consumer has to
 * style around); resetting the input's own value before every open, so
 * selecting the SAME file twice in a row still fires `onSelect` a second
 * time (a native `<input type="file">`'s `change` event does not fire
 * again on an unchanged value on its own); `acceptedFileTypes`
 * ([`accept`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file#accept));
 * `allowsMultiple` (`multiple`); and `defaultCamera`, for a mobile device's
 * camera capture prompt.
 *
 * Deliberately unstyled beyond that, because it has no visual surface OF
 * ITS OWN: it renders `children` exactly as given, with only a press
 * handler attached. Every visible affordance — including any disabled
 * state — belongs to whichever trigger element the consumer supplies (its
 * own `isDisabled`, its own styling), the same way `Menu`'s and `Popover`'s
 * own `trigger` slots already work.
 *
 * `className` is deliberately NOT accepted here, unlike every other atom in
 * this package: react-aria-components' own `FileTrigger` hardcodes the
 * hidden input's `className` to `""` internally, unconditionally
 * discarding whatever is passed. Accepting the prop here would render into
 * the type signature but never actually apply — the identical kind of
 * silent no-op this package's README already documents for `Select`'s
 * missing `aria-invalid` (see `Select.tsx`'s own doc comment) rather than a
 * gap quietly worked around.
 *
 * Deliberately out of scope, per this package's own atom/block boundary:
 * upload progress, drag-and-drop, and any preview of the selected files —
 * `onSelect` hands back the browser's own `FileList` and stops there. A
 * block built on top of this (and this package's own `ProgressBar`, for
 * upload progress) owns the rest.
 */
export function FileTrigger({ children, ...rest }: FileTriggerProps) {
  return <AriaFileTrigger {...rest}>{children}</AriaFileTrigger>;
}
