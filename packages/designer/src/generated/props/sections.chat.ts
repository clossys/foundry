// Generated from sections.chat by src/generated/props/generate.ts; do not edit.
export const chatContractSha256 = "d2ec4d03a604723f32394d560c8b8fdf3d221997e0609fd4234678732c850889";

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
