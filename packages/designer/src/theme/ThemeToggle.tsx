import { useId, useState } from "react";
import { Button, Icon, type ButtonProps } from "../atoms/index.js";
import { Monitor, Moon, Sun, type IconNode } from "../icons/index.js";
import { useTheme } from "./ThemeProvider.js";
import type { ThemePreference } from "./internal/theme-core.js";

const CYCLE: readonly ThemePreference[] = ["system", "light", "dark"];

export interface ThemePreferenceLabels {
  readonly system: string;
  readonly light: string;
  readonly dark: string;
}

const DEFAULT_PREFERENCE_LABELS: ThemePreferenceLabels = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const PREFERENCE_GLYPH: Record<ThemePreference, IconNode> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

function nextPreference(current: ThemePreference): ThemePreference {
  const index = CYCLE.indexOf(current);
  // `index` is always found (CYCLE covers every ThemePreference), so the
  // fallback `0` below is unreachable in practice — kept only to satisfy
  // this package's `noUncheckedIndexedAccess` typecheck setting.
  return CYCLE[(index + 1) % CYCLE.length] ?? "system";
}

export interface ThemeToggleProps extends Omit<ButtonProps, "children" | "onPress"> {
  /**
   * Visible names for each theme preference.
   * @default System / Light / Dark
   */
  preferenceLabels?: ThemePreferenceLabels;
  /**
   * Accessible name for the cycling control.
   * @default (current, next, labels) => `Theme: ${labels[current]}. Activate to switch to ${labels[next]}.`
   */
  toggleLabel?: (current: ThemePreference, next: ThemePreference, labels: ThemePreferenceLabels) => string;
  /**
   * Live-region announcement after the preference changes.
   * @default (next, labels) => `Theme set to ${labels[next]}`
   */
  preferenceAnnouncement?: (next: ThemePreference, labels: ThemePreferenceLabels) => string;
}

function defaultToggleLabel(
  current: ThemePreference,
  next: ThemePreference,
  labels: ThemePreferenceLabels,
): string {
  return `Theme: ${labels[current]}. Activate to switch to ${labels[next]}.`;
}

function defaultPreferenceAnnouncement(next: ThemePreference, labels: ThemePreferenceLabels): string {
  return `Theme set to ${labels[next]}`;
}

/**
 * A single control that cycles System -> Light -> Dark -> System.
 *
 * WHY A CYCLE, NOT A TWO-STATE SWITCH WITH A SEPARATE RESET. This
 * package's own `Switch` atom communicates exactly one bit — on/off — and
 * a theme preference isn't a bit, it's one of three values. A `Switch`
 * plus a separate "reset to system" control would need two controls to do
 * one job, and the switch itself would have no correct position to show
 * whenever the preference is `"system"` (the OS could be either). A
 * single cycling control keeps `"system"` a first-class, always-reachable
 * stop on the SAME control — never a secondary escape hatch a keyboard or
 * screen-reader user has to discover separately. It also keeps this
 * component to exactly one focusable element, rather than two that have
 * to stay visually and semantically paired.
 *
 * This is a deliberate choice, not the only valid one: `useTheme()`'s
 * `setPreference` accepts any of the three values directly, so a consumer
 * who wants a segmented three-button group, or a `Menu` of three explicit
 * options instead of a cycling button, can build one from this package's
 * `Button`/`Menu` atoms and `useTheme()` without reaching for
 * `ThemeToggle` at all — nothing about the public API privileges this
 * component's own interaction shape.
 *
 * ACCESSIBILITY. Built on this package's own `Button` atom (react-aria-
 * components underneath — see the README's "Why these dependencies") for
 * the same reason every other interactive atom here is: Enter/Space
 * activation, focus management, and disabled-state semantics are not
 * reimplemented here, so this control is keyboard-operable for free.
 * `aria-label` always states BOTH the current preference and what
 * activating the control does next ("Theme: System. Activate to switch to
 * Light."), so a screen-reader user gets the same information a sighted
 * user gets from the icon. That label alone isn't relied on to announce a
 * CHANGE, though: not every screen reader/browser combination reliably
 * re-announces an `aria-label` that changes on an element that already
 * has focus. A visually hidden (`sr-only`) `role="status"`/`aria-live`
 * region is updated on every press instead, which is announced
 * consistently regardless of whether the label itself is re-read.
 */
export function ThemeToggle({
  className,
  variant = "ghost",
  size = "sm",
  preferenceLabels = DEFAULT_PREFERENCE_LABELS,
  toggleLabel = defaultToggleLabel,
  preferenceAnnouncement = defaultPreferenceAnnouncement,
  "aria-label": ariaLabel,
  ...rest
}: ThemeToggleProps) {
  const { preference, setPreference } = useTheme();
  const [announcement, setAnnouncement] = useState("");
  const statusId = useId();

  const next = nextPreference(preference);
  const label = toggleLabel(preference, next, preferenceLabels);

  return (
    <>
      <Button
        {...rest}
        variant={variant}
        size={size}
        className={className}
        aria-label={ariaLabel ?? label}
        aria-describedby={statusId}
        onPress={() => {
          setPreference(next);
          setAnnouncement(preferenceAnnouncement(next, preferenceLabels));
        }}
      >
        <Icon glyph={PREFERENCE_GLYPH[preference]} decorative />
      </Button>
      <span id={statusId} role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
