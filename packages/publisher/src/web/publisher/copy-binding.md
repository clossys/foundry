# Host Writer bindings

Supply `copyResolver` to `PublisherPage` or `PublisherRoutePage`. Use the host's
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
