import { previewSectionedDocument, previewCopyResolver } from '../fixture-documents.js';
export const OTHER_KIND_LINKS = [{
    "sectionId": "hero",
    "kind": "hero",
    "href": "../gallery.html#published-kind-hero"
},
{
    "sectionId": "features",
    "kind": "feature-grid",
    "href": "../gallery.html#published-kind-features"
},
{
    "sectionId": "faq",
    "kind": "faq",
    "href": "../gallery.html#published-kind-faq"
},
{
    "sectionId": "steps",
    "kind": "ordered-step-sequence",
    "href": "../gallery.html#published-kind-steps"
},
{
    "sectionId": "status",
    "kind": "status-list",
    "href": "../gallery.html#published-kind-status"
},
{
    "sectionId": "stats",
    "kind": "stat-grid",
    "href": "../gallery.html#published-kind-stats"
},
{
    "sectionId": "pricing",
    "kind": "pricing",
    "href": "../gallery.html#published-kind-pricing"
},
{
    "sectionId": "proof",
    "kind": "testimonial",
    "href": "../gallery.html#published-kind-proof"
},
{
    "sectionId": "outcomes",
    "kind": "stat",
    "href": "../gallery.html#published-kind-outcomes"
}] as const;
export const OTHER_KIND_SOURCE = { document: previewSectionedDocument, copyResolver: previewCopyResolver };
