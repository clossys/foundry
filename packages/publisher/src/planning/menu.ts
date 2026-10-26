import { freeze } from "../layouts/resolve.js";
import { getFormatLeaf } from "../formats/index.js";
import type { FormatId, PublisherDeliveryChoice } from "../formats/contract.js";
import type { PublisherConfiguration, PublisherLaneRecommendation, PublisherRequirements } from "./configuration.js";

export const PUBLISHER_MENU_VERSION = 2 as const;
export const MILESTONE_IDS = ["M1", "M2", "M3", "M4"] as const;
export type MilestoneId = typeof MILESTONE_IDS[number];
export const PUBLISHER_LANES = ["Landing", "Showcase", "Document", "Contact", "Auth", "Status", "Assets", "Email", "Image", "Document media", "Deck", "Demo", "Commerce", "Portal", "Dashboard", "Collection", "Record", "Settings", "Studio", "Video"] as const;
export type PublisherPlanLane = typeof PUBLISHER_LANES[number];
export const PUBLISHER_PACKS = [
  { id: "pack.standard-website", label: "Standard website" },
  { id: "pack.brand-assets", label: "Brand assets" },
  { id: "pack.conversation", label: "Conversation" },
  { id: "pack.customer", label: "Customer" },
  { id: "pack.app", label: "App" },
  { id: "pack.proof", label: "Proof and depth" },
] as const;
export type PublisherPlanPackId = typeof PUBLISHER_PACKS[number]["id"];
export interface MenuNeeds {
  readonly sections: readonly string[];
  readonly frames: readonly string[];
  readonly formats: readonly string[];
}
export interface PublisherMenuItem {
  readonly id: string;
  readonly label: string;
  readonly milestone: MilestoneId;
  readonly pack: PublisherPlanPackId;
  readonly lanes: readonly PublisherPlanLane[];
  /** Built describes an available mechanism, never consumer adoption or readiness. */
  readonly status: "built" | "concept-only";
  readonly kind: "page" | "asset" | "app-route" | "concept";
  readonly needs: MenuNeeds;
  readonly recommendations: readonly PublisherLaneRecommendation[];
  readonly requirements: PublisherRequirements;
}
const web = { sections: ["Page sections"], frames: ["frames.site-shell"], formats: ["web.page.responsive"] };
const webConfiguration = (config: string, app = false): PublisherConfiguration => ({ kind: "web", format: "web.page.responsive", frame: { leaf: app ? "frames.app-shell" : "frames.site-shell", ...(!app ? { config: "site" } : {}) }, layout: { leaf: config.startsWith("split.") ? "layouts.split" : config.startsWith("bento.") ? "layouts.bento" : config.startsWith("sidebar-content.") ? "layouts.sidebar-content" : "layouts.stack", config }, media: { size: getFormatLeaf("web.page.responsive")!.size }, deliveries: [{ id: "static-site-bundle" }] });
const requirements = (purpose: string, legal = false, integration?: string): PublisherRequirements => ({ brandAssets: ["logo", "favicon", "share-image"], contentRefs: [{ slot: "lead", purpose: `${purpose} heading and purpose`, length: "short", requiredFacts: ["audience", "subject"] }, { slot: "body", purpose, length: legal ? "long" : "medium", requiredFacts: legal ? ["applicable terms", "responsible contact"] : ["offering or topic", "next action"] }], integrations: integration ? [integration] : [] });
const laneConfig = (lane: PublisherPlanLane): string => lane === "Landing" ? "stack.landing" : lane === "Showcase" || lane === "Collection" ? "stack.index" : lane === "Contact" ? "split.default" : lane === "Status" || lane === "Auth" || lane === "Settings" || lane === "Studio" ? "stack.focus" : lane === "Dashboard" ? "bento.default" : lane === "Record" ? "sidebar-content.record" : "stack.document";
const page = (id: string, label: string, lane: PublisherPlanLane): PublisherMenuItem => ({ id, label, milestone: "M1", pack: "pack.standard-website", lanes: [lane], status: "built", kind: "page", needs: web, recommendations: [{ lane, configuration: webConfiguration(laneConfig(lane)) }], requirements: requirements(label, id === "website.terms" || id === "website.privacy", lane === "Contact" ? "contact-inbox" : undefined) });
const recommendedDeliveries = (format?: FormatId): readonly PublisherDeliveryChoice[] => format === "email.html" ? [{ id: "html" }, { id: "text" }] : format === "image.og" ? [{ id: "png" }] : format === "document.pdf-a4" || format === "deck.16x9" ? [{ id: "pdf" }] : format === "video.16x9" ? [{ id: "mp4" }] : [];
const concept = (id: string, label: string, milestone: MilestoneId, pack: PublisherPlanPackId, lane: PublisherPlanLane, format?: FormatId): PublisherMenuItem => ({ id, label, milestone, pack, lanes: [lane], status: "concept-only", kind: "concept", needs: { sections: ["Registered sections for this item"], frames: format === "web.page.responsive" ? ["frames.site-shell"] : ["Registered frame for this medium"], formats: format ? [format] : ["Registered format for this item"] }, recommendations: [{ lane, configuration: format === "web.page.responsive" ? webConfiguration(laneConfig(lane)) : { kind: "concept-only", ...(format ? { format } : {}), deliveries: recommendedDeliveries(format) } }], requirements: requirements(label, false, lane === "Email" ? "email-delivery-provider" : lane === "Demo" ? "demo-destination" : lane === "Commerce" ? "payment-or-contract" : undefined) });
const asset = (id: string, label: string): PublisherMenuItem => ({ id, label, milestone: "M1", pack: "pack.brand-assets", lanes: ["Assets"], status: "built", kind: "asset", needs: { sections: [], frames: [], formats: [] }, recommendations: [{ lane: "Assets", configuration: { kind: "asset-reference", deliveries: [] } }], requirements: { brandAssets: id === "assets.brand" ? ["logo", "favicon", "app-icons"] : ["share-image"], contentRefs: [], integrations: [] } });
/** Closed offers. No executable/rendering field exists on a menu entry. */
export const PUBLISHER_MENU: readonly PublisherMenuItem[] = freeze([
  page("website.home", "Home", "Landing"), page("website.showcase", "Showcase", "Showcase"),
  page("website.about", "About", "Document"), page("website.terms", "Terms", "Document"), page("website.privacy", "Privacy", "Document"),
  page("website.contact", "Contact", "Contact"), page("website.not-found", "Not found", "Status"), page("website.error", "Error", "Status"),
  asset("assets.brand", "Brand assets: logo, favicon and app icons"),
  asset("assets.share", "Static default share image"),
  concept("conversation.email", "Contact acknowledgement email", "M2", "pack.conversation", "Email", "email.html"),
  concept("conversation.og", "Generated share image", "M2", "pack.conversation", "Image", "image.og"),
  concept("conversation.pdf", "One-pager PDF", "M2", "pack.conversation", "Document media", "document.pdf-a4"),
  concept("conversation.deck", "Deck", "M2", "pack.conversation", "Deck", "deck.16x9"),
  concept("conversation.demo", "Request a demo", "M2", "pack.conversation", "Demo"),
  concept("customer.auth", "Sign-in and account", "M3", "pack.customer", "Auth", "web.page.responsive"),
  concept("customer.sale", "Payments or contract flow", "M3", "pack.customer", "Commerce"),
  concept("customer.receipt", "Receipts email", "M3", "pack.customer", "Email", "email.html"),
  concept("customer.portal", "Customer portal", "M3", "pack.customer", "Portal", "web.page.responsive"),
  { id: "app.ops", label: "App operations inventory", milestone: "M3", pack: "pack.app", lanes: ["Dashboard", "Collection", "Record", "Settings", "Studio", "Status"], status: "built", kind: "app-route", needs: { sections: ["Consumer App sections"], frames: ["frames.app-shell"], formats: ["web.page.responsive"] }, recommendations: (["Dashboard", "Collection", "Record", "Settings", "Studio", "Status"] as const).map(lane => ({ lane, configuration: webConfiguration(laneConfig(lane), true) })), requirements: requirements("App page and scoped state content") },
  concept("proof.cases", "Case studies", "M4", "pack.proof", "Document", "web.page.responsive"),
  concept("proof.help", "Docs and help", "M4", "pack.proof", "Document", "web.page.responsive"),
  concept("proof.status", "Status page", "M4", "pack.proof", "Status", "web.page.responsive"),
  concept("proof.video", "Video", "M4", "pack.proof", "Video", "video.16x9"),
]);
export const PUBLISHER_MILESTONES = freeze([
  { id: "M1", label: "First impression", status: "built" },
  { id: "M2", label: "First conversation", status: "concept-only" },
  { id: "M3", label: "First customer / sale", status: "concept-only" },
  { id: "M4", label: "Proof and depth", status: "concept-only" },
] as const);
