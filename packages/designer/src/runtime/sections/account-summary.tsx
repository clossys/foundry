import { DetailView, type DetailViewField } from "../../blocks/DetailView.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";

import type { SurfaceRendererEntry } from "../contract.js";
import { object, optionalText, readSectionContent, required, SectionContentError, text, type JsonObject, type SectionContent } from "./group-a-content.js";
import { componentLeaf } from "../component-leaf.js";

type StockAvatar = typeof import("../../components/preview-runtime/components/avatar/avatar.js");
const Avatar = componentLeaf<StockAvatar["Avatar"]>("components.avatar");
const AvatarImage = componentLeaf<StockAvatar["AvatarImage"]>("components.avatar", "AvatarImage");
const AvatarFallback = componentLeaf<StockAvatar["AvatarFallback"]>("components.avatar", "AvatarFallback");
const Link = componentLeaf<typeof import("../../components/Link.js").Link>("components.link");
const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

const LEAF = "sections.account-summary";
export const accountSummaryInputs = { slots: ["heading", "identity", "rows", "actions"], members: [] } as const;

function closed(content: SectionContent, value: JsonObject, keys: readonly string[], path: string) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new SectionContentError(content.leaf, `${path}.${key} is not supported`);
}
function records(content: SectionContent, slot: string): readonly JsonObject[] {
  const value = content.values[slot];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new SectionContentError(LEAF, `${slot} must be a list`);
  return value.map((row, index) => object(content, row, `${slot}.${index}`));
}
function destination(content: SectionContent, value: unknown, path: string): string {
  const href = text(content, value as string, path);
  if (href !== href.trim() || /[\u0000-\u0020\u007f\\]/.test(href) || !(/^(?:\/(?!\/)|#|https?:\/\/)/i.test(href))) throw new SectionContentError(LEAF, `${path} must be a local path, fragment or HTTP(S) URL`);
  return href;
}
/** Initials for the avatar fallback: the first letter of the first and last words of the name. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  return [words[0], words.length > 1 ? words[words.length - 1] : undefined].map(word => word ? Array.from(word)[0]!.toLocaleUpperCase() : "").join("");
}
/**
 * The stock Avatar anatomy: a host image names the member through its own alt text with the initials as the
 * fallback; without one, the root is the named image and the initials are decorative.
 */
function avatarOf(name: string, src: string | undefined) {
  if (src !== undefined) return <Avatar><AvatarImage src={src} alt={name} /><AvatarFallback aria-hidden="true">{initials(name)}</AvatarFallback></Avatar>;
  return <Avatar role="img" aria-label={name}><AvatarFallback aria-hidden="true">{initials(name)}</AvatarFallback></Avatar>;
}
const copy = (value: string) => <SemanticContent as="span" dir="auto">{value}</SemanticContent>;

/** Display-only consumer data and navigation. The host owns identity, destinations and authentication. */
export const accountSummaryRenderer: SurfaceRendererEntry = {
  leaf: LEAF,
  sample: dataset => ({
    heading: "Account",
    identity: { name: dataset.avatar.alt, "name-label": "Name", email: "member@example.com", "email-label": "Email" },
    rows: [{ label: "Workspace", value: dataset.assets.mark.name }],
    actions: [{ label: "Account settings", href: "/account/settings" }],
  }),
  render(input) {
    const content = readSectionContent(input, LEAF, accountSummaryInputs);
    const heading = text(content, required(content, "heading"), "heading");
    const identity = object(content, required(content, "identity"), "identity");
    closed(content, identity, ["name", "name-label", "email", "email-label", "avatar"], "identity");
    const name = text(content, identity.name, "identity.name");
    const avatar = optionalText(content, identity.avatar, "identity.avatar");
    const fields: DetailViewField[] = [
      { label: copy(text(content, identity["name-label"], "identity.name-label")), value: <SemanticContent as="div" className="flex items-center gap-sm">{avatarOf(name, avatar === undefined ? undefined : destination(content, avatar, "identity.avatar"))}{copy(name)}</SemanticContent> },
      { label: copy(text(content, identity["email-label"], "identity.email-label")), value: copy(text(content, identity.email, "identity.email")) },
      ...records(content, "rows").map((row, index) => {
        closed(content, row, ["label", "value"], `rows.${index}`);
        return { label: copy(text(content, row.label, `rows.${index}.label`)), value: copy(text(content, row.value, `rows.${index}.value`)) };
      }),
    ];
    const actions = records(content, "actions").map((action, index) => {
      closed(content, action, ["label", "href"], `actions.${index}`);
      return <Link key={index} href={destination(content, action.href, `actions.${index}.href`)}>{copy(text(content, action.label, `actions.${index}.label`))}</Link>;
    });
    return <DetailView {...dsAttrs("sections", LEAF, `foundry/${LEAF}`)} data-designer-requires-section-frame="" title={copy(heading)} fields={fields} {...(actions.length ? { actions: <>{actions}</> } : {})} />;
  },
};
