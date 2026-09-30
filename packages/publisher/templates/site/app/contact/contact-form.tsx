"use client";

import { useMemo } from "react";
import type { SiteFooterLegalProps } from "@clossys/designer/shell/server";
import { ContactView } from "@clossys/publisher/web";
import type { ContactResult, ContactViewValues } from "@clossys/publisher/web";
import { contactViewCopy, contactViewTopics, createMapResolver } from "../site-copy";
import type { ContactTopic, SiteCopyMap } from "../site-copy";

export interface ContactFormProps {
  brand: string;
  legal: SiteFooterLegalProps;
  /** Resolved on the server: this module reads it, and reads nothing else for its words. */
  copy: SiteCopyMap;
  /** The topic to preselect, already checked against the topic list on the server. */
  initialTopic?: ContactTopic;
  /** The page's server action. */
  onSubmit: (values: ContactViewValues) => Promise<ContactResult>;
}

/**
 * Renders `ContactView` from a client module: the view is interactive, and its
 * server-side export is a stub that throws when rendered, so the page imports
 * this instead of the view.
 */
export function ContactForm({ brand, legal, copy, initialTopic, onSubmit }: ContactFormProps) {
  const resolveCopyId = useMemo(() => createMapResolver(copy), [copy]);
  const viewCopy = useMemo(() => contactViewCopy(), []);
  const topics = useMemo(() => contactViewTopics(), []);
  return (
    <ContactView
      brand={brand}
      legal={legal}
      resolveCopyId={resolveCopyId}
      copy={viewCopy}
      topics={topics}
      initialTopic={initialTopic}
      onSubmit={onSubmit}
    />
  );
}
