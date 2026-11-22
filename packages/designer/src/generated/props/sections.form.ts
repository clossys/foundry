// Generated from sections.form by src/generated/props/generate.ts; do not edit.
export const formContractSha256 = "7291e31d16ec45ada5c9f88f2359ad547322617c61b62e813fb1f999a01023cb";

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
