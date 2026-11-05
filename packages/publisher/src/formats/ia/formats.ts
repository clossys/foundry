import type { FormatIA } from "../contract.js";

export const formatIA = { nodes: [
  { id: "screen", label: "Screen", children: [{ id: "web-page", label: "Web page", leaves: ["web.page.responsive"] }] },
  { id: "email", label: "Email", children: [{ id: "message", label: "Message", leaves: ["email.html"] }] },
  { id: "image", label: "Image", children: [{ id: "social-card", label: "Social card", leaves: ["image.og"] }] },
  { id: "document", label: "Document", children: [{ id: "pdf", label: "PDF", leaves: ["document.pdf-a4"] }] },
  { id: "video", label: "Video", children: [{ id: "widescreen", label: "Widescreen", leaves: ["video.16x9"] }] },
  { id: "deck", label: "Deck", children: [{ id: "slide-deck", label: "Slide deck", leaves: ["deck.16x9"] }] },
] } as const satisfies FormatIA;
