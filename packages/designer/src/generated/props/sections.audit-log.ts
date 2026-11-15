// Generated from sections.audit-log by src/generated/props/generate.ts; do not edit.
export const auditLogContractSha256 = "ced5d546706541cfb81cd52fcec4249564fac8ad6e71039be1a1b8272992c356";

export type AuditLogCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  entries: Array<{
    actor: string; // label
    action: string; // action
    target?: string; // label
    "time-text": string; // label
  }>;
  filter?: {
    search?: {
      label?: string; // label
      placeholder?: string; // label
    };
  };
  export?: {
    label?: string; // label
  };
  labels?: {
    time?: string; // label
    actor?: string; // label
    action?: string; // action
    target?: string; // label
    label?: string; // label
  };
  states: {
    loading: {
      label: string; // label
      description?: string; // body
    };
    empty: {
      label: string; // label
      description?: string; // body
    };
    error: {
      label: string; // label
      description?: string; // body
    };
  };
};
export type AuditLogVariant = Record<string, never>;
export interface AuditLogProps {
  copy: AuditLogCopy;
  variant?: AuditLogVariant;
}
