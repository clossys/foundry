import { AppFrame, type AppFrameProps } from "@clossys/designer/frames";
import { PAGE_META_KEY, resolveCopy, validateCopyFields, type CopyField } from "../../content/composition.js";
import { ContentPreviewRefusal } from "./selection.js";

export interface FramedContentPreviewProps {
  readonly chrome: Omit<AppFrameProps, "children">;
  readonly rawUrl: string;
  readonly locale: string;
  readonly frameCopy: readonly CopyField[];
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requireChrome(chrome: FramedContentPreviewProps["chrome"]): void {
  if (!chrome || typeof chrome !== "object" || !chrome.brand || !hasText(chrome.brand.markSrc)
    || !chrome.navigation || !Array.isArray(chrome.navigation.tree)
    || !chrome.account || !Array.isArray(chrome.account.sections)
    || !chrome.commands || !Array.isArray(chrome.commands.groups)) {
    throw new ContentPreviewRefusal("designer-chrome-required", "Preview requires host Designer AppFrame chrome.");
  }
  const labels: unknown[] = [chrome.skipLabel, chrome.navigation.label, chrome.navigation.openLabel,
    chrome.navigation.closeLabel, chrome.account.signedOutLabel, chrome.commands.triggerLabel,
    chrome.commands.heading, chrome.commands.searchLabel, chrome.commands.closeLabel, chrome.commands.emptyMessage];
  if (!chrome.navigation.tree.length) labels.push(chrome.navigation.emptyMessage);
  if (chrome.page || chrome.root) labels.push(chrome.breadcrumbLabel, chrome.collapsedBreadcrumbLabel,
    chrome.pageInfoLabel, chrome.pageActionsLabel);
  if (chrome.rightPanel) labels.push(chrome.rightPanel.label, chrome.rightPanel.handleLabel,
    chrome.rightPanel.openLabel, chrome.rightPanel.closeLabel);
  if (labels.some(label => !hasText(label))) {
    throw new ContentPreviewRefusal("writer-copy-required", "Preview chrome requires complete host labels.");
  }
  if (chrome.themeControl === undefined) {
    throw new ContentPreviewRefusal("writer-copy-required", "Preview requires an explicit host theme control or null.");
  }
}

function requireRawUrl(rawUrl: string): void {
  try {
    if (!hasText(rawUrl) || rawUrl.trim() !== rawUrl || /[\u0000-\u0020\u007f]/u.test(rawUrl)) throw new TypeError();
    const parsed = new URL(rawUrl, "https://preview.invalid/");
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new TypeError();
  } catch {
    throw new ContentPreviewRefusal("invalid-raw-url", "Preview requires a relative or HTTP(S) raw URL.");
  }
}

/** Designer owns administrative chrome; the raw route owns the complete visitor document. */
export function FramedContentPreview({ chrome, rawUrl, locale, frameCopy }: FramedContentPreviewProps) {
  requireChrome(chrome);
  requireRawUrl(rawUrl);
  if (validateCopyFields(frameCopy, "frameCopy", ["title"]).length) {
    throw new ContentPreviewRefusal("writer-copy-required", "Preview requires Writer title copy.");
  }
  let title: string | undefined;
  try {
    title = resolveCopy({ pageMeta: frameCopy }, locale)[PAGE_META_KEY]?.title;
  } catch {
    throw new ContentPreviewRefusal("writer-copy-required", "Preview requires Writer title copy for its locale.");
  }
  if (!hasText(title)) throw new ContentPreviewRefusal("writer-copy-required", "Preview requires Writer title copy for its locale.");
  return <AppFrame {...chrome}><iframe src={rawUrl} title={title} /></AppFrame>;
}
