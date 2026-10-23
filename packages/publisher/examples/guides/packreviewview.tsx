import { PackReviewView } from "@clossys/publisher/web";
import type { PackReviewViewLabels } from "@clossys/publisher/web";

const labels: PackReviewViewLabels = {
  strategy: { heading: "Strategy", empty: "No strategy", summary: "Summary", context: "Context", openQuestions: "Questions" },
  brandKit: { heading: "Brand", empty: "No brand kit", assets: "Assets", colors: "Colors", type: "Type", specimen: "Specimen", facts: "Facts" },
  voice: { heading: "Voice", empty: "No voice", rules: "Rules", tagline: "Tagline", pitch: "Pitch", boilerplate: "Boilerplate", faq: "FAQ" },
  pagesHeading: "Pages", exportsHeading: "Exports", sheetHeading: "Contact sheet", none: "None",
  statuses: { draft: "Draft", delegated: "Delegated", approved: "Approved" },
  kinds: { "og-image": "Share card", favicon: "Favicon", "app-icon": "App icon", logo: "Logo", "email-html": "HTML email", "email-text": "Text email", other: "Other" },
  exportWidth: (width) => `${width}px`, frameTitle: ({ page, state, width }) => `${page} ${state ?? "default"} ${width}px`,
}; // every heading, badge, kind and frame name, as approved copy

export function ReviewPage() {
  return (
    <PackReviewView
      brand={<span>Example Studio</span>}
      headerAction={<a href="/">Back to the site</a>}
      heading="Pack review"
      description="Pages, states and exports of this site."
      pages={[
        {
          id: "/contact",
          href: "/contact",
          status: "delegated",
          states: [{ id: "accepted", href: "/contact?preview=accepted" }],
        },
      ]}
      exports={[{ id: "share-card:0", kind: "og-image", path: "out/share/og-image.png", status: "approved" }]}
      labels={labels}
    />
  );
}

export default ReviewPage;
