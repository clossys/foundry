// Generated from sections.audit-log by src/generated/props/generate.ts; do not edit.
export const auditLogContractSha256 = "87ed873c573c0f5db21fca4707423345dae050dba01ad352f7b361d2a2c98603";

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
