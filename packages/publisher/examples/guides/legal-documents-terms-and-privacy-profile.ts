import { LEGAL_SECTION_IDS, validateLegalDocument, gateLegalDocument } from "@clossys/publisher/document";
import type { DocumentSection, LegalDocument } from "@clossys/publisher/document";

const ref = (id: string) => ({ id });

// One section per fixed id, in order. Every string is a CopyRef the caller's registry owns.
const sections = LEGAL_SECTION_IDS.terms.map(
  (id): DocumentSection => ({
    kind: "section",
    id,
    level: 2,
    heading: ref(`acme.terms.${id}.heading`),
    blocks: [{ kind: "paragraph", content: [{ kind: "text", text: ref(id === "indemnity" ? "acme.terms.indemnity.not-applicable" : `acme.terms.${id}.p1`) }] }],
  }),
);

const terms: LegalDocument = {
  id: "acme.legal.terms",
  title: ref("acme.terms.title"),
  sections,
  legal: {
    kind: "terms",
    status: "draft",
    effectiveDate: "2026-01-15",
    lastUpdated: "2026-01-10",
    variables: { entity: "Acme Example Ltd", jurisdiction: "Exampleland", contact: "legal@acme.example" },
    factsToConfirm: [ref("acme.terms.facts.entity-registration")], // a draft needs at least one
    notApplicable: { indemnity: ref("acme.terms.indemnity.not-applicable") },
  },
};

validateLegalDocument(terms); // [] when clean
gateLegalDocument(terms, "preview"); // { ok: true, findings: [] }: a valid draft may be previewed
gateLegalDocument(terms, "production"); // { ok: false, ... }: a draft is refused
