// Generated from sections.settings by src/generated/props/generate.ts; do not edit.
export const settingsContractSha256 = "60174a47849a79ac0bc56d5641ff6c56b7b39a445f4e1dde6486139f8776a627";

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
