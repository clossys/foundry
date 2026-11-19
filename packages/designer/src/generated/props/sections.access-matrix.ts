// Generated from sections.access-matrix by src/generated/props/generate.ts; do not edit.
export const accessMatrixContractSha256 = "5b650696e8f8013d92788b80699d149cfb2e074a901b0a68b48ed8a1893b1027";

export type AccessMatrixCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  roles: Array<{
    label: string; // label
    "locked-reason"?: string; // label
  }>;
  permissions: Array<{
    label: string; // label
    permissions: Array<{
      label: string; // label
      description?: string; // body
    }>;
  }>;
  labels?: {
    label?: string; // label
    "permission-header"?: string; // label
    cell?: string; // label
    "group-all"?: string; // label
    inherited?: string; // label
    locked?: string; // label
    "change-summary"?: string; // label
  };
};
export type AccessMatrixVariant = Record<string, never>;
export interface AccessMatrixProps {
  copy: AccessMatrixCopy;
  variant?: AccessMatrixVariant;
}
