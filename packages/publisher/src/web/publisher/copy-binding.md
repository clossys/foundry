# Host Writer bindings

The internal Publisher workspace accepts the host's `copyResolver`. Use its
configured Writer `createCopyResolver` callback. The callback owns locale,
formatting and approval policy; the page forwards CopyRefs for its 32 existing
voice-packet records. Missing, mismatched or blank resolutions fail closed.
Existing explicit message overrides retain precedence.

The packet remains draft. These bindings neither approve records nor activate
an admin route. The callback is a live host prop, outside serialized route data.

The board and inspector model inputs also accept `copyResolver`. Their label
readers accept ref-only `CopyField` data, supply the requested locale and a fresh
values snapshot, validate the returned identity and locale trace, and report
unavailable labels as Writer Needs. Inspector body-copy resolution receives that
same callback for each declared locale. Existing deprecated Writer `value`
projections remain readable during migration.

Integration Needs remain for host-owned board/inspector records, readable
diagnostic/field labels, raw technical metadata presentation and complete legacy
count/version templates. Those have no matching records in the packet. Other
legacy child views and loading/refusal copy likewise need their actual Writer
records before admin activation. Their record IDs and wording must come from the
owning Writer/host lane. Source bindings do not establish active-route coverage.

The page also binds its heading to the existing title reference and its body
summary to the existing `admin.publisher.description` metadata reference
(`st.2tw3ay17tc`). That summary is separate from the 32 voice-packet records.
A missing summary resolution fails closed, just like a missing title.

Publisher-owned resolved text nodes carry `data-copy-ref` on their direct span
parent. Status copy is a status badge; the next stage is a button that opens the
same item inspector. Resource titles are not reused as trailing action text.
Single-channel pages omit channel navigation.

Integration Needs: the current Designer copy-binding source declares no CopyRef
DOM attribute convention, so `data-copy-ref` is the bounded Publisher convention
pending alignment. Frame-owned header titles and navigation labels accept only
strings; their DOM provenance still needs a frame-owned binding seam. Explicit
host message overrides and numeric or technical data do not claim Writer origin.
