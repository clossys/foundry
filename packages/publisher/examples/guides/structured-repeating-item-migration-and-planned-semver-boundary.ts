// Example fix: Parenthesize the illustrative objects so they are valid standalone expressions.
const ref = (id: string): import("@clossys/writer").CopyRef => ({ id });

// Before: legacy node-shaped FAQ item (do not carry this forward).
({ node: { question: "...", answer: "..." } });

// After: every audience-facing field is a CopyRef.
({
  fields: {
    question: { copy: ref("acme.faq.question") },
    answer: { copy: ref("acme.faq.answer") },
  },
});

export {};
