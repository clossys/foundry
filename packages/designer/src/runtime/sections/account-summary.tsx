import { DetailView, type DetailViewField } from "../../blocks/DetailView.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import { Avatar } from "../../selected-components/Avatar.js";
import { Link } from "../../selected-components/Link.js";
import { SemanticContent } from "../../selected-components/SemanticContent.js";
import type { SurfaceRendererEntry } from "../contract.js";
import { object, optionalText, readSectionContent, required, SectionContentError, text, type JsonObject, type SectionContent } from "./group-a-content.js";

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
const copy = (value: string) => <SemanticContent as="span" dir="auto">{value}</SemanticContent>;

/** Display-only consumer data and navigation. The host owns identity, destinations and authentication. */
export const accountSummaryRenderer: SurfaceRendererEntry = {
  leaf: LEAF,
  sample: dataset => ({
    heading: "Account",
    identity: { name: dataset.avatar.alt, nameLabel: "Name", email: "member@example.com", emailLabel: "Email" },
    rows: [{ label: "Workspace", value: dataset.assets.mark.name }],
    actions: [{ label: "Account settings", href: "/account/settings" }],
  }),
  render(input) {
    const content = readSectionContent(input, LEAF, accountSummaryInputs);
    const heading = text(content, required(content, "heading"), "heading");
    const identity = object(content, required(content, "identity"), "identity");
    closed(content, identity, ["name", "nameLabel", "email", "emailLabel", "avatar"], "identity");
    const name = text(content, identity.name, "identity.name");
    const avatar = optionalText(content, identity.avatar, "identity.avatar");
    const fields: DetailViewField[] = [
      { label: copy(text(content, identity.nameLabel, "identity.nameLabel")), value: <SemanticContent as="div" className="flex items-center gap-sm"><Avatar alt={name} {...(avatar === undefined ? {} : { src: destination(content, avatar, "identity.avatar") })} />{copy(name)}</SemanticContent> },
      { label: copy(text(content, identity.emailLabel, "identity.emailLabel")), value: copy(text(content, identity.email, "identity.email")) },
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
