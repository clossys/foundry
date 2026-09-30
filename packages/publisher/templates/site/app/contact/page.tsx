import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ContactResult, ContactViewValues } from "@clossys/publisher/web";
import { submitContact } from "../site-contact";
import {
  CONTACT_HEADING_ID,
  allContactPageCopyIds,
  requireCopy,
  resolveInitialTopic,
  siteFooterLegal,
  siteText,
} from "../site-copy";
import { createSiteCopyResolver, loadBrandFacts, siteTarget } from "../site-records";
import { ContactForm } from "./contact-form";

// The submit path. The action runs on the server; the client sends the form
// values and gets a `ContactResult` back. The limiter is keyed on the
// forwarded-for header, and the handler decides everything else. It never
// throws: a failure to build the handler is an `unavailable` result.
async function submit(values: ContactViewValues): Promise<ContactResult> {
  "use server";
  return submitContact(values, (await headers()).get("x-forwarded-for"));
}

function loadCopy() {
  return requireCopy(createSiteCopyResolver(siteTarget()), allContactPageCopyIds());
}

export function generateMetadata(): Metadata {
  return { title: siteText(loadCopy(), CONTACT_HEADING_ID) };
}

interface ContactPageProps {
  /** A Promise in this Next major. Reading it makes the route render per request. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ContactPage({ searchParams }: ContactPageProps) {
  // `?topic=<id>` preselects that topic; a repeated or unlisted value selects
  // nothing. The value is only compared, never rendered or logged.
  const initialTopic = resolveInitialTopic((await searchParams).topic);
  const facts = loadBrandFacts();
  const copy = loadCopy();
  return (
    <ContactForm
      brand={facts.brandLabel}
      legal={siteFooterLegal(copy, facts.entity)}
      copy={copy}
      initialTopic={initialTopic}
      onSubmit={submit}
    />
  );
}
