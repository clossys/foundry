// Generated from sections.testimonials by src/generated/props/generate.ts; do not edit.
export const testimonialsContractSha256 = "6143793875dd18c275fcf801947313a6f24033be4d1ba5aba11298b004c591e8";

export type TestimonialsCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  quotes: Array<{
    quote: string; // body
    "attributor-name": string; // label
    "attributor-role"?: string; // label
  }>;
};
export type TestimonialsVariant = {
  layout?: "single" | "grid";
};
export interface TestimonialsProps {
  copy: TestimonialsCopy;
  variant?: TestimonialsVariant;
}
