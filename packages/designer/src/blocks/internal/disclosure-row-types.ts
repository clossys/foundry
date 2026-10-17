import type { CSSProperties, ReactNode } from "react";

export interface DisclosureRowOptions {
  id: string;
  question: ReactNode;
  /** Optional layout for the question wrapper; omitted for existing consumers. */
  questionClassName?: string;
  answer: ReactNode;
  recipe: Readonly<Record<"item" | "trigger" | "details" | "panel" | "chevron" | "chevronOpen" | "chevronNative" | "answer", string>>;
  colors: { border: string; primary: string; secondary: string };
  answerStyle: CSSProperties;
  rowStyle?: CSSProperties;
  headingLevel?: 3 | 4;
}
