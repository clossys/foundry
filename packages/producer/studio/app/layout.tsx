// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
import { createElement, type ReactNode } from "react";
import { PublishedDocument, publishedMetadata } from "../components/StudioInstalledPage";

export const metadata = publishedMetadata;
export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: ReactNode }) {
  return createElement(PublishedDocument, { children });
}
