/**
 * Email signature template (#1207): "a signature per person (name, role,
 * company, links, logo; HTML and plain text)." A signature is small,
 * structured personal data, not long-form audience-facing prose — unlike
 * `@clossys/publisher/email`'s `renderEmailDocument`, which resolves
 * `CopyRef`s through a registry, a signature's fields are supplied
 * directly by the person it names. `buildEmailSignatureHtml`/`Text` are
 * deterministic string builders: the same input always produces the same
 * output, and both emit the identical field order.
 */

export interface EmailSignatureLink {
  label: string;
  href: string;
}

export interface EmailSignaturePerson {
  name: string;
  role: string;
  company: string;
  links: readonly EmailSignatureLink[];
  /** Absolute URL to the company or personal logo, or omitted for a text-only signature. */
  logoUrl?: string;
  logoAlt?: string;
}

const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(value: string): string {
  return value.replace(ESCAPE_RE, (character) => ESCAPE_MAP[character] ?? character);
}

/** A table-based HTML signature (the same "email HTML is hand-built, table-based" discipline `@clossys/publisher/email` documents — see its own README section). */
export function buildEmailSignatureHtml(person: EmailSignaturePerson): string {
  const logo = person.logoUrl
    ? `<td style="padding-right:16px;vertical-align:top;"><img src="${escapeHtml(person.logoUrl)}" alt="${escapeHtml(person.logoAlt ?? person.company)}" width="64" height="64" style="display:block;border:0;"></td>`
    : "";
  const links = person.links
    .map((link) => `<a href="${escapeHtml(link.href)}" style="color:inherit;text-decoration:underline;">${escapeHtml(link.label)}</a>`)
    .join(' <span style="color:#999;">&middot;</span> ');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="font-family:sans-serif;font-size:13px;color:#333;">
<tr>
${logo}
<td style="vertical-align:top;">
<div style="font-weight:600;">${escapeHtml(person.name)}</div>
<div>${escapeHtml(person.role)} &middot; ${escapeHtml(person.company)}</div>
${links ? `<div style="margin-top:4px;">${links}</div>` : ""}
</td>
</tr>
</table>`;
}

/** The plain-text alternative — same field order as the HTML build, no markup. */
export function buildEmailSignatureText(person: EmailSignaturePerson): string {
  const lines = [person.name, `${person.role} · ${person.company}`];
  if (person.links.length > 0) lines.push(person.links.map((link) => `${link.label}: ${link.href}`).join(" | "));
  return lines.join("\n");
}
