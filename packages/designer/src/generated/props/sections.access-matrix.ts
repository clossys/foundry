// Generated from sections.access-matrix by src/generated/props/generate.ts; do not edit.
export const accessMatrixContractSha256 = "5eaf0c2f0e867470162e224c22ae590f17dc068d4514ad844138f1ec291c4d38";

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
