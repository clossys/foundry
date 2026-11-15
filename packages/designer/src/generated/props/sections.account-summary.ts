// Generated from sections.account-summary by src/generated/props/generate.ts; do not edit.
export const accountSummaryContractSha256 = "e4f63dd680d7be1d8a70f9df3d78d10b13641ffbf7c9baa339cee27a8a429c1f";

export type AccountSummaryCopy = {
  heading: string; // heading
  identity: {
    name: string; // label
    "name-label": string; // label
    email: string; // label
    "email-label": string; // label
  };
  rows: Array<{
    label: string; // label
    value: string; // body
  }>;
  actions: Array<{
    label: string; // action
  }>;
};
export type AccountSummaryVariant = Record<string, never>;
export interface AccountSummaryProps {
  copy: AccountSummaryCopy;
  variant?: AccountSummaryVariant;
}
