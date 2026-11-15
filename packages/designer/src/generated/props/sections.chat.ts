// Generated from sections.chat by src/generated/props/generate.ts; do not edit.
export const chatContractSha256 = "26695b117c2f570ca838456ef24b7fee86807a6bfa5bddbeef5dccc87477fa4e";

export type ChatCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  parts: Array<{
    content: string; // body
    timestamp?: string; // label
  }>;
  composer: {
    placeholder: string; // label
    label?: string; // label
  };
  labels?: {
    status?: string; // label
  };
};
export type ChatVariant = {
  part?: "message" | "bubble" | "attachment" | "trace" | "questionnaire" | "scroller";
};
export interface ChatProps {
  copy: ChatCopy;
  variant?: ChatVariant;
}
