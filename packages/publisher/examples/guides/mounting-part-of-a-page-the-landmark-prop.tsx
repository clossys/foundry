import { SectionedView } from "@clossys/publisher/web";
import { resolveSectionedViewDocument } from "@clossys/publisher/core";
const fixtureResolveCopy: import("@clossys/writer").CopyResolver = (ref) => ({
  ref, text: ref.id, recordId: "readme-example", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "readme-example" }, entryId: ref.id,
});
const resolved = resolveSectionedViewDocument({ id: "example", sectionGroundRhythm: "view", sections: [{ id: "welcome", kind: "hero", heading: { id: "welcome.heading" } }] }, fixtureResolveCopy);
const ConsumerOwnedSection = () => <section>Consumer content</section>;

export default function Example() {
  return (<>
<main>
  <SectionedView document={resolved} landmark="none" />
  <ConsumerOwnedSection />
</main>
</>);
}
