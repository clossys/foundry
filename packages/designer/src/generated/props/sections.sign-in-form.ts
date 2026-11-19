// Generated from sections.sign-in-form by src/generated/props/generate.ts; do not edit.
export const signInFormContractSha256 = "a915cc25cc8e529610f7ab1720eb4725c73d4fa6d189a5155e3e9b1195beb6dd";

export type SignInFormCopy = {
  header: {
    heading: string; // heading
    description?: string; // lead
  };
  providers: Array<{
    label: string; // label
  }>;
  credentials: {
    "identifier-label": string; // label
    "identifier-placeholder"?: string; // label
    "password-label": string; // label
    "password-placeholder"?: string; // label
  };
  verification: {
    "code-label": string; // label
    description?: string; // body
    placeholder?: string; // label
  };
  actions: {
    submit: string; // action
    verify: string; // action
    pending: string; // action
    back: string; // action
    resend: string; // action
    divider: string; // label
  };
  error?: {
    message?: string; // body
    identifier?: string; // label
    password?: string; // label
    code?: string; // label
  };
};
export type SignInFormVariant = {
  "sign-in"?: "password" | "provider" | "verify";
};
export interface SignInFormProps {
  copy: SignInFormCopy;
  variant?: SignInFormVariant;
}
