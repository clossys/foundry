import { useShellCopy } from "../components/Banner.copy-context.js";
import { SHELL_COPY_REFS } from "../components/Banner.copy.js";
import { useId, useState } from "react";
import { Icon } from "../components/Icon.js";
import { ToggleGroup, ToggleGroupItem, type ToggleGroupProps } from "../components/ToggleGroup.js";
import { Toolbar } from "../components/Toolbar.js";
import { Tooltip } from "../components/Tooltip.js";
import { Monitor, Moon, Sun, type IconNode } from "../icons/index.js";
import { useOptionalTheme } from "./ThemeProvider.js";
import type { ThemePreference } from "./internal/theme-core.js";

const PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/*
 * The selected preference is a surface step with the primary ink and a 1px
 * ink ring (the state reads at 3:1 or more without a fill), not the full
 * action fill, which made the toggle the brightest object in a dark
 * sidebar. Colour-only motion on the fast tier.
 */
const SELECTED_STEP =
  "icon-control-md shrink-0 transition-colors duration-(--ui-duration-fast) data-selected:bg-surface-selected data-selected:text-ink-primary data-selected:ring-1 data-selected:ring-inset data-selected:ring-current aria-pressed:bg-surface-selected aria-pressed:text-ink-primary";

export interface ThemePreferenceLabels {
  readonly system: string;
  readonly light: string;
  readonly dark: string;
}


const PREFERENCE_GLYPH: Record<ThemePreference, IconNode> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export interface ThemeToggleProps extends Omit<ToggleGroupProps,
  "children" | "selectionMode" | "selectedKeys" | "defaultSelectedKeys" | "onSelectionChange" | "disallowEmptySelection"> {
  /** Spoken preference names; omitted names resolve through the host Writer seam. */
  preferenceLabels?: ThemePreferenceLabels;
  /** Accessible toolbar name; omitted means resolve its Writer reference. */
  toolbarLabel?: string;
  /** Tooltip copy for an individual option, receiving the current and target preference. */
  toggleLabel?: (current: ThemePreference, target: ThemePreference, labels: ThemePreferenceLabels) => string;
  /** Polite announcement after the preference changes. */
  preferenceAnnouncement?: (next: ThemePreference, labels: ThemePreferenceLabels) => string;
  /** Host-controlled preference; overrides the nearest ThemeProvider and works without one. */
  preference?: ThemePreference;
  /** Called with the chosen preference; with `preference`, the host applies it. */
  onPreferenceChange?: (preference: ThemePreference) => void;
}

function defaultToggleLabel(_current: ThemePreference, target: ThemePreference, labels: ThemePreferenceLabels): string {
  return labels[target];
}


/** Three explicit preferences, using the adopted fill's native radio selection and focus protocol. */
export function ThemeToggle({
  preferenceLabels: suppliedPreferenceLabels,
  toolbarLabel: suppliedToolbarLabel,
  toggleLabel = defaultToggleLabel,
  preferenceAnnouncement: suppliedPreferenceAnnouncement,
  "aria-label": suppliedAriaLabel,
  "aria-describedby": describedby,
  preference: hostPreference,
  onPreferenceChange,
  ...rest
}: ThemeToggleProps) {
  const context = useOptionalTheme();
  const copy = useShellCopy();
  const preferenceLabels = suppliedPreferenceLabels ?? { system: copy(SHELL_COPY_REFS.theme.system), light: copy(SHELL_COPY_REFS.theme.light), dark: copy(SHELL_COPY_REFS.theme.dark) };
  const toolbarLabel = suppliedToolbarLabel ?? copy(SHELL_COPY_REFS.theme.toolbar);
  const ariaLabel = suppliedAriaLabel ?? copy(SHELL_COPY_REFS.theme.group);
  const preferenceAnnouncement = suppliedPreferenceAnnouncement ?? ((next: ThemePreference, labels: ThemePreferenceLabels) => copy(SHELL_COPY_REFS.theme.announcement, { theme: labels[next] }));
  if (hostPreference === undefined && !context) throw new Error("useTheme() must be called within a <ThemeProvider>.");
  const preference = hostPreference ?? context!.preference;
  const setPreference = (next: ThemePreference) => {
    if (hostPreference === undefined) context!.setPreference(next);
    onPreferenceChange?.(next);
  };
  const [announcedPreference, setAnnouncedPreference] = useState<ThemePreference | null>(null);
  const statusId = useId();

  return <>
    <Toolbar aria-label={toolbarLabel} className="border-0 p-0">
    <ToggleGroup {...rest} aria-label={ariaLabel} aria-describedby={[describedby, statusId].filter(Boolean).join(" ")}
      selectionMode="single" disallowEmptySelection selectedKeys={new Set([preference])}
      onSelectionChange={keys => {
        const next = [...keys][0];
        if ((next === "system" || next === "light" || next === "dark") && next !== preference) {
          setPreference(next);
          setAnnouncedPreference(next);
        }
      }}>
      {PREFERENCES.map(target => <Tooltip key={target} trigger={
        <ToggleGroupItem id={target} aria-label={preferenceLabels[target]} className={SELECTED_STEP}>
          <Icon glyph={PREFERENCE_GLYPH[target]} decorative />
        </ToggleGroupItem>
      }>{toggleLabel(preference, target, preferenceLabels)}</Tooltip>)}
    </ToggleGroup>
    </Toolbar>
    <span id={statusId} role="status" aria-live="polite" className="sr-only">
      {announcedPreference === null ? null : preferenceAnnouncement(announcedPreference, preferenceLabels)}
    </span>
  </>;
}
