import { Testimonial } from "@clossys/designer/blocks";

function CustomerQuote() {
  return (
    <Testimonial
      quote="Quote text goes here."
      attributorName="Attributor name"
      attributorRole="Attributor role, Attributor org"
      avatarSrc="/avatar.png"
      avatarAlt="Attributor name"
    />
  );
}

export default CustomerQuote;
