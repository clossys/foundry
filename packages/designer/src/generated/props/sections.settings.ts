// Generated from sections.settings by src/generated/props/generate.ts; do not edit.
export const settingsContractSha256 = "f4d3ee447a46931861b393ceef159b407bc6144baade0bafd9429c3ad0bc4876";

export type SettingsCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  groups: Array<{
    legend: string; // label
    description?: string; // body
    controls: Array<{
      label: string; // label
      description?: string; // body
      placeholder?: string; // label
      options?: Array<{
        label?: string; // label
      }>;
    }>;
  }>;
  "save-bar"?: {
    label?: string; // label
    save?: string; // label
    discard?: string; // label
    unsaved?: string; // label
  };
};
export type SettingsVariant = Record<string, never>;
export interface SettingsProps {
  copy: SettingsCopy;
  variant?: SettingsVariant;
}
