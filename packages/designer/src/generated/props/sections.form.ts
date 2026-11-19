// Generated from sections.form by src/generated/props/generate.ts; do not edit.
export const formContractSha256 = "2e7c3dd5e8d63c0e11af9147f1250224f2d11c41e147581d712a89fab1e3fc72";

export type FormCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  fields: Array<{
    label: string; // label
    description?: string; // body
    placeholder?: string; // label
    options?: Array<{
      label?: string; // label
    }>;
    error?: string; // label
  }>;
  submit: {
    label: string; // label
  };
  "error-summary"?: {
    heading?: string; // heading
    items?: Array<{
      message?: string; // label
    }>;
  };
  success?: {
    message?: string; // body
  };
  error?: {
    message?: string; // body
  };
};
export type FormVariant = {
  form?: "contact";
};
export interface FormProps {
  copy: FormCopy;
  variant?: FormVariant;
}
