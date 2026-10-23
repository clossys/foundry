import { Faq } from "@clossys/designer/blocks";

function ProductFaq() {
  return (
    <Faq
      heading="FAQ heading"
      items={[
        { id: "one", question: "Question text one", answer: "Answer text one." },
        { id: "two", question: "Question text two", answer: "Answer text two." },
      ]}
    />
  );
}

export default ProductFaq;
