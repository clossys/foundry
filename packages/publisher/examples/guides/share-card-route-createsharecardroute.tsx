import { createShareCardRoute } from "@clossys/publisher/web";
import type { ShareCardRouteInput } from "@clossys/publisher/web";

const ImageResponse: ShareCardRouteInput["ImageResponse"] = class extends Response { constructor(_element: React.ReactElement, _init: { width: number; height: number }) { super("fixture image response"); } }; // your framework's image-response class
const markDataUrl: string = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Cpath%20d='M0%200h24v24H0z'/%3E%3C/svg%3E"; // inline data URL

const route = createShareCardRoute({
  ImageResponse,
  card: { markSrc: markDataUrl, wordmark: "Example Studio", headline: "Made well, made to last" },
});

export const alt = route.alt;
export const size = route.size;
export const contentType = route.contentType;
export default route.Image;

export const smokeSkip = "This framework image route returns a Response rather than a React tree.";
