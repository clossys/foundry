/**
 * Text the Producer server itself sends to a person (a plain-text failure page, a frame title):
 * always a Writer key, resolved from the consumer's pinned Writer copy. Without a pinned Writer
 * copy the text is empty, never a literal: no server string reaches a browser that is not Writer
 * copy. JSON bodies for Studio's own fetches are not text a person reads: Studio's loaders never
 * read their `error` or `message` (`check:copy-source`, rule ui-message).
 */
import type { ServerResponse } from "node:http";
import { writerCopy } from "../records/writer-copy.js";

type Values = Readonly<Record<string, string | number | boolean>>;

/** One Writer key's text from `consumer` (`<root>/clossys`); empty when the consumer pins no Writer copy for it. */
export function writerText(consumer: string, id: string, values?: Values): string {
  try { return writerCopy(consumer).text(id, values); } catch { return ""; }
}

/** A plain-text response whose body is one Writer key's text. */
export function sendWriterText(response: ServerResponse, status: number, consumer: string, id: string, headers: Readonly<Record<string, string>> = {}): void {
  response.writeHead(status, { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers, "Content-Type": "text/plain; charset=utf-8" });
  response.end(writerText(consumer, id));
}
