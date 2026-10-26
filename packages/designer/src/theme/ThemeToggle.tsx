import { useId, useState } from "react";
import { Icon } from "../components/Icon.js";
import { ToggleGroup, ToggleGroupItem, type ToggleGroupProps } from "../components/ToggleGroup.js";
import { Toolbar } from "../components/Toolbar.js";
import { Tooltip } from "../components/Tooltip.js";
import { Monitor, Moon, Sun, type IconNode } from "../icons/index.js";
import { useTheme } from "./ThemeProvider.js";
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

export interface ThemeToggleProps extends Omit<ToggleGroupProps,
  "children" | "selectionMode" | "selectedKeys" | "defaultSelectedKeys" | "onSelectionChange" | "disallowEmptySelection"> {
  /** Spoken names for each preference. @default System / Light / Dark */
  preferenceLabels?: ThemePreferenceLabels;
  /** Accessible name of the existing toolbar that owns arrow-key focus. @default "Appearance" */
  toolbarLabel?: string;
  /** Tooltip copy for an individual option, receiving the current and target preference. */
  toggleLabel?: (current: ThemePreference, target: ThemePreference, labels: ThemePreferenceLabels) => string;
  /** Polite announcement after the preference changes. */
  preferenceAnnouncement?: (next: ThemePreference, labels: ThemePreferenceLabels) => string;
}

function defaultToggleLabel(_current: ThemePreference, target: ThemePreference, labels: ThemePreferenceLabels): string {
  return labels[target];
}

function defaultPreferenceAnnouncement(next: ThemePreference, labels: ThemePreferenceLabels): string {
  return `Theme set to ${labels[next]}`;
}

/** Three explicit preferences, using the adopted fill's native radio selection and focus protocol. */
export function ThemeToggle({
  preferenceLabels = DEFAULT_PREFERENCE_LABELS,
  toolbarLabel = "Appearance",
  toggleLabel = defaultToggleLabel,
  preferenceAnnouncement = defaultPreferenceAnnouncement,
  "aria-label": ariaLabel = "Theme",
  "aria-describedby": describedby,
  ...rest
}: ThemeToggleProps) {
  const { preference, setPreference } = useTheme();
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
