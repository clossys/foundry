// Generated from sections.account-summary by src/generated/props/generate.ts; do not edit.
export const accountSummaryContractSha256 = "529a42a2c0ad2b1f86ebe6713db51a7e54f16114a776f995170544b3bf2bffe6";

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
