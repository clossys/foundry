// Generated from sections.testimonials by src/generated/props/generate.ts; do not edit.
export const testimonialsContractSha256 = "b5972838fd46b24f3edff03e57666b5b2bd494df73782b8a654774789679e94e";

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
