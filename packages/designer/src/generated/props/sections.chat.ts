// Generated from sections.chat by src/generated/props/generate.ts; do not edit.
export const chatContractSha256 = "6ee38951e47973f2ea5f8ea28d394def65f4db8d2e4b54d40b0a7f302d105df7";

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
