// Generated from sections.testimonials by src/generated/props/generate.ts; do not edit.
export const testimonialsContractSha256 = "39b3f5d21cf5c5b1824e934f4b9afb74e221ccfe59f7bfa525dffb0772ddbc35";

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
