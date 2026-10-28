import { useState } from "react";
import { Menu } from "../components/Menu.js";
import { Icon } from "../components/Icon.js";
import { useTheme, type ThemePreference } from "../theme/ThemeProvider.js";
import type { ThemeToggleProps } from "../theme/ThemeToggle.js";
import { useShellCopy } from "../components/Banner.copy-context.js";
import { SHELL_COPY_REFS } from "../components/Banner.copy.js";
import { Monitor } from "../icons/Monitor.js";
import { Moon } from "../icons/Moon.js";
import { Sun } from "../icons/Sun.js";

/** Internal frame composition: the same provider and Writer references as ThemeToggle. */
export function AppFrameThemeSection({ preferenceLabels: suppliedLabels, toggleLabel, preferenceAnnouncement }: Pick<ThemeToggleProps, "preferenceLabels" | "toggleLabel" | "preferenceAnnouncement">) {
  const { preference, setPreference } = useTheme();
  const copy = useShellCopy();
  const [announcement, setAnnouncement] = useState("");
  const labels = suppliedLabels ?? { system: copy(SHELL_COPY_REFS.theme.system), light: copy(SHELL_COPY_REFS.theme.light), dark: copy(SHELL_COPY_REFS.theme.dark) };
  const options = [{ id: "system", glyph: Monitor }, { id: "light", glyph: Sun }, { id: "dark", glyph: Moon }] as const;
  return <Menu.Section aria-label={copy(SHELL_COPY_REFS.theme.group)} heading={<>{copy(SHELL_COPY_REFS.theme.group)}<span role="status" aria-live="polite" className="sr-only">{announcement}</span></>}
    selectionMode="single" selectedKeys={new Set([preference])} shouldCloseOnSelect={false}
    onSelectionChange={keys => {
      const next = [...keys][0] as ThemePreference | undefined;
      if (!options.some(option => option.id === next) || next === preference || next === undefined) return;
      setPreference(next);
      setAnnouncement(preferenceAnnouncement ? preferenceAnnouncement(next, labels) : copy(SHELL_COPY_REFS.theme.announcement, { theme: labels[next] }));
    }}>
    {options.map(option => <Menu.Item key={option.id} id={option.id} textValue={labels[option.id]}>
      <Icon glyph={option.glyph} decorative size="sm" /><span title={toggleLabel?.(preference, option.id, labels)}>{labels[option.id]}</span>
    </Menu.Item>)}
  </Menu.Section>;
}
