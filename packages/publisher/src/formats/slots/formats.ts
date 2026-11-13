import type { FormatLeaf } from "../contract.js";

export const formatLeaves = [
  {
    id: "web.page.responsive", medium: "screen", family: "web-page", label: "Responsive web page", status: "built", outputType: "html",
    deliveries: [{ id: "static-site-bundle", label: "Static site bundle", status: "concept-only" }],
    size: { kind: "responsive", breakpoints: ["sm", "md", "lg", "xl", "2xl"] },
    arrangement: "page", allowedCompositions: ["layouts.stack", "layouts.split", "layouts.sidebar-content", "layouts.bento"],
    heldCompositions: ["layouts.staggered-grid"], frames: ["frames.site-shell", "frames.app-shell"], usedByPacks: [],
  },
  {
    id: "email.html", medium: "email", family: "message", label: "HTML email", status: "concept", outputType: "html",
    deliveries: [{ id: "html", label: "HTML", status: "concept-only" }, { id: "text", label: "Plain text", status: "concept-only" }],
    size: { kind: "fixed", unit: "px", width: 600 }, arrangement: "page", allowedCompositions: [], heldCompositions: [], frames: [], usedByPacks: [],
  },
  {
    id: "image.og", medium: "image", family: "social-card", label: "Open Graph image", status: "concept", outputType: "png",
    deliveries: [{ id: "png", label: "PNG", status: "concept-only" }, { id: "jpg", label: "JPG", status: "concept-only" }, { id: "webp", label: "WebP", status: "concept-only" }, { id: "svg", label: "SVG", status: "concept-only" }],
    size: { kind: "fixed", unit: "px", width: 1200, height: 630 }, arrangement: "canvas", allowedCompositions: [], heldCompositions: [], frames: [], usedByPacks: [],
  },
  {
    id: "document.pdf-a4", medium: "document", family: "pdf", label: "A4 PDF", status: "concept", outputType: "pdf",
    deliveries: [{ id: "pdf", label: "PDF", status: "concept-only" }, { id: "docx", label: "Word document", status: "concept-only" }],
    size: { kind: "paper", unit: "mm", width: 210, height: 297 }, arrangement: "paged", allowedCompositions: [], heldCompositions: [], frames: [], usedByPacks: [],
  },
  {
    id: "video.16x9", medium: "video", family: "widescreen", label: "16:9 video", status: "concept", outputType: "mp4",
    deliveries: [{ id: "mp4", label: "MP4", status: "concept-only" }, { id: "gif", label: "GIF", status: "concept-only" }],
    size: { kind: "fixed", unit: "px", width: 1920, height: 1080 }, fps: 30, arrangement: "canvas", allowedCompositions: [], heldCompositions: [], frames: [], usedByPacks: [],
  },
  {
    id: "deck.16x9", medium: "deck", family: "slide-deck", label: "16:9 deck", status: "concept", outputType: "slides",
    deliveries: [{ id: "pdf", label: "PDF", status: "concept-only" }, { id: "pptx", label: "PowerPoint", status: "concept-only", fidelityChoices: ["editable", "flat"] }, { id: "google-slides", label: "Google Slides", status: "concept-only", fidelityChoices: ["editable", "flat"] }, { id: "link", label: "Shareable link", status: "concept-only" }],
    size: { kind: "aspect-ratio", width: 16, height: 9 }, arrangement: "paged", allowedCompositions: [], heldCompositions: [], frames: [], usedByPacks: [],
  },
] as const satisfies readonly FormatLeaf[];
