"use client";
import { createContext, useContext, type ReactNode } from "react";
export interface FeedbackCopyRef { readonly id: string; readonly locale?: string; readonly values?: Readonly<Record<string, string | number | boolean>> }
export type FeedbackCopyResolver = (ref: FeedbackCopyRef) => { readonly ref: FeedbackCopyRef; readonly text: string } | undefined;
const CopyContext = createContext<FeedbackCopyResolver | undefined>(undefined);
export function FeedbackCopyProvider({resolver, children}: {resolver?: FeedbackCopyResolver; children: ReactNode}) {
  const inherited = useContext(CopyContext);
  return <CopyContext.Provider value={resolver ?? inherited}>{children}</CopyContext.Provider>;
}
export function useFeedbackCopy(explicit?: FeedbackCopyResolver) {
  const inherited = useContext(CopyContext);
  return (ref: FeedbackCopyRef): string => {
    const resolved = (explicit ?? inherited)?.(ref);
    if (!resolved || resolved.ref.id !== ref.id || resolved.ref.locale !== ref.locale || !resolved.text.trim()) throw new TypeError("Designer feedback copy requires a host resolver or explicit host label");
    return resolved.text;
  };
}
export const FEEDBACK_COPY_REFS = {
  toastClose: {id: "st.5t6kmpqx5k"}, toastAction: {id: "st.kq4avsz26w"},
} as const;
