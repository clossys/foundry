import { ConsentBanner } from "../../blocks/ConsentBanner.js";
import { Link } from "../../components/Link.js";
import { actionsOf, noop, refuseUnmapped, requireSlot, stringField, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.consent";

/** copy -> title and body; actions -> accept and reject labels (in that order); policy -> privacyLink. */
export const consentInputs: SectionInputs = { slots: ["copy", "actions", "policy"], members: [] };

export const renderConsent: SectionRenderer = input => {
  refuseUnmapped(input, consentInputs);
  const copy = requireSlot(input, LEAF, "copy");
  const title = stringField(copy, "title"), body = stringField(copy, "body");
  if (!title || !body) throw new TypeError(`${LEAF}: copy needs a title and a body`);
  const choices = actionsOf(LEAF, "actions", requireSlot(input, LEAF, "actions"), 2);
  if (choices.length !== 2) throw new TypeError(`${LEAF}: actions needs exactly an accept and a reject action`);
  const [policy] = actionsOf(LEAF, "policy", requireSlot(input, LEAF, "policy"), 1);
  if (!policy?.href) throw new TypeError(`${LEAF}: policy needs a label and an href`);
  return (
    <ConsentBanner
      title={title}
      body={body}
      acceptLabel={choices[0]!.label}
      rejectLabel={choices[1]!.label}
      onAccept={noop}
      onReject={noop}
      privacyLink={<Link href={policy.href}>{policy.label}</Link>}
    />
  );
};
