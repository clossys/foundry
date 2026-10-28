/** The host owns Writer registry, approval, locale and message formatting. */
export interface PublisherCopyRef { readonly id: string; readonly locale?: string; readonly values?: Readonly<Record<string, string | number | boolean>> }
export type PublisherCopyResolver = (ref: PublisherCopyRef) => { readonly ref: PublisherCopyRef; readonly text: string } | undefined;
/** References only: no catalog records are imported, approved or activated. */
export const PUBLISHER_COPY_REFS = {
  "projectionFailure": {
    "id": "st.rj9yqfds7j"
  },
  "applyFailure": {
    "id": "st.kxgbwzxkgr"
  },
  "title": {
    "id": "st.q5mh8a135f"
  },
  "channels": {
    "id": "st.2wnzrnm0nf"
  },
  "apply": {
    "id": "st.mw6mn99de1"
  },
  "applying": {
    "id": "st.hd56mn615e"
  },
  "applyCompact": {
    "id": "st.ekdqem8w87"
  },
  "workspace": {
    "id": "st.r44ht9h8rb"
  },
  "routeFindings": {
    "id": "st.vgqpv4p2jk"
  },
  "emptyTitle": {
    "id": "st.f8mr19pj7r"
  },
  "emptyDescription": {
    "id": "st.pee5f35tpk"
  },
  "alignedVersion": {
    "id": "st.swhnzmbaxw"
  },
  "proposedDescription": {
    "id": "st.fwmfdckk20"
  },
  "commerce": {
    "id": "st.htywy6hbk2"
  },
  "needsInput": {
    "id": "st.v2qavnr3r2"
  },
  "closeDetails": {
    "id": "st.fck5fxw34e"
  },
  "configure": {
    "id": "st.byav18dham"
  },
  "plannedDescription": {
    "id": "st.hwtsvpxxnz"
  },
  "alignBeforeConfigure": {
    "id": "st.gcs82nsqdt"
  },
  "outputFormat": {
    "id": "st.4b1m5gh2fx"
  },
  "assetRequirements": {
    "id": "st.q7z53xdq7t"
  },
  "assetPending": {
    "id": "st.0ymcxw83pp"
  },
  "assetMissing": {
    "id": "st.6j38cw96pp"
  },
  "inspectFormat": {
    "id": "st.0xv50r43am"
  },
  "evidence": {
    "id": "st.xfj92exnr7"
  },
  "routeEvidence": {
    "id": "st.0jhtb2yw9k"
  },
  "appEvidence": {
    "id": "st.njn9gks177"
  },
  "toDo": {
    "id": "st.hf1nerhh0n"
  },
  "waiting": {
    "id": "st.74p81v194s"
  },
  "publishEvidence": {
    "id": "st.z9zp4r228j"
  },
  "unconfiguredDescription": {
    "id": "st.4kht66qmws"
  },
  "sourceFindings": {
    "id": "st.fthc7d02hd"
  }
} as const;
/** Existing admin metadata record; separate from the 32 voice-packet references. */
export const PUBLISHER_PAGE_DESCRIPTION_REF: PublisherCopyRef = { id: "st.2tw3ay17tc" };

export function publisherCopy(resolver: PublisherCopyResolver | undefined, reference: PublisherCopyRef): string {
  if (!resolver) throw new TypeError("Publisher copy requires a host resolver");
  const request = { ...reference, ...(reference.values === undefined ? {} : { values: { ...reference.values } }) };
  const result = resolver(request);
  if (!result || result.ref?.id !== request.id || result.ref.locale !== request.locale || typeof result.text !== "string" || !result.text.trim()) throw new TypeError(`Publisher copy unresolved: ${reference.id}`);
  return result.text;
}
